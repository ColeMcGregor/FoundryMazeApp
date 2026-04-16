// Core maze engine:
// - Defines arena structure (allowed + column cells)
// - Manages sparse cell state (only non-open cells stored)
// - Provides deterministic math strategies (sunburst, ripple)
// - Provides preset strategies and bounded shuffle

export const CELL_STATES = Object.freeze({
  OPEN: 0,
  WALL_LOW: 1,
  WALL_HIGH: 2,
  PIT: 3
});

const STORED_STATES = new Set([
  CELL_STATES.WALL_LOW,
  CELL_STATES.WALL_HIGH,
  CELL_STATES.PIT
]);

const TAU = Math.PI * 2;

// ---------- BASIC HELPERS ----------
// Utility functions for cloning, key parsing, sorting, math, and deterministic hashing

function cloneStateByCell(stateByCell = {}) {
  return { ...stateByCell };
}

function keyFromXY(x, y) {
  return `${x},${y}`;
}

function parseKey(key) {
  const [x, y] = String(key).split(",").map(Number);
  return { x, y };
}

function sortEntriesByRowThenCol(entries) {
  return [...entries].sort((a, b) => {
    const aPos = parseKey(a[0]);
    const bPos = parseKey(b[0]);
    return aPos.y - bPos.y || aPos.x - bPos.x;
  });
}

// Normalizes angle to [0, 2π)
function normalizeAngle(angle) {
  let out = angle % TAU;
  if (out < 0) out += TAU;
  return out;
}

// Smallest angular distance between two angles
function angularDistance(a, b) {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, TAU - diff);
}

// Safe modulo for negative numbers
function mod(n, m) {
  return ((n % m) + m) % m;
}

// Stable hash → [0,1) for deterministic pseudo-random behavior
function hashToUnitInterval(input) {
  let hash = 2166136261;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

// Assigns low/high wall deterministically per cell + turn
function deterministicWallHeight(patternName, x, y, turn) {
  const roll = hashToUnitInterval(`${patternName}|${x}|${y}|${turn}`);
  return roll < 0.5 ? CELL_STATES.WALL_LOW : CELL_STATES.WALL_HIGH;
}

// Converts cell index to center point
function getCellCenter(x, y) {
  return {
    px: x + 0.5,
    py: y + 0.5
  };
}

// Computes polar coordinates relative to arena center
// Uses standard mathematical orientation:
// +x right, +y up, angle increases counterclockwise
function getPolarFromArenaCenter(x, y, cx = 9.5, cy = 9.5) {
  const { px, py } = getCellCenter(x, y);
  const dx = px - cx;
  const dy = cy - py; // flip screen Y so radians behave normally
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = normalizeAngle(Math.atan2(dy, dx));
  return { dx, dy, dist, angle };
}

// ---------- NORMALIZATION ----------
// Sanitizes raw input data into valid arena/preset/state structures

// Filters allowed + column cells
function normalizeArena(rawArena = {}) {
  const allowedCells = new Set(Array.isArray(rawArena.allowedCells) ? rawArena.allowedCells : []);
  const rawColumnCells = Array.isArray(rawArena.columnCells) ? rawArena.columnCells : [];

  const columnCells = new Set(
    rawColumnCells.filter((cellKey) => allowedCells.has(cellKey))
  );

  const arena = {
    allowedCells,
    columnCells
  };

  if (Number.isInteger(rawArena.width)) arena.width = rawArena.width;
  if (Number.isInteger(rawArena.height)) arena.height = rawArena.height;

  return arena;
}

// Ensures state only contains valid, mutable cells
function normalizeStateByCell(arena, rawStateByCell = {}) {
  const next = {};

  for (const [cellKey, value] of Object.entries(rawStateByCell)) {
    if (!arena.allowedCells.has(cellKey)) continue;
    if (arena.columnCells.has(cellKey)) continue;
    if (!STORED_STATES.has(value)) continue;

    next[cellKey] = value;
  }

  return Object.fromEntries(sortEntriesByRowThenCol(Object.entries(next)));
}

// Extracts preset map from raw JSON
function normalizePresets(rawPresets = {}) {
  const maybePresets = rawPresets.presets && typeof rawPresets.presets === "object"
    ? rawPresets.presets
    : rawPresets;

  const presets = {};

  for (const [name, preset] of Object.entries(maybePresets)) {
    if (!preset || typeof preset !== "object") continue;
    const stateByCell = preset.stateByCell;
    if (!stateByCell || typeof stateByCell !== "object") continue;

    presets[name] = {
      stateByCell: cloneStateByCell(stateByCell)
    };
  }

  return presets;
}

// ---------- STATE ----------
// State creation, cloning, and safe accessors

// Creates empty sparse state
function createEmptyState() {
  return {
    stateByCell: {}
  };
}

// Deep clone of state object
function cloneState(state = {}) {
  return {
    stateByCell: cloneStateByCell(state.stateByCell)
  };
}

// Returns stored state or OPEN
function getCellState(currentState, cellKey) {
  return currentState.stateByCell[cellKey] ?? CELL_STATES.OPEN;
}

function isAllowedCell(arena, cellKey) {
  return arena.allowedCells.has(cellKey);
}

function isColumnCell(arena, cellKey) {
  return arena.columnCells.has(cellKey);
}

function isMutableCell(arena, cellKey) {
  return isAllowedCell(arena, cellKey) && !isColumnCell(arena, cellKey);
}

// Ensures strategy output is valid and normalized
function validateStrategyResult(arena, result) {
  if (!result || typeof result !== "object") {
    return createEmptyState();
  }

  return {
    stateByCell: normalizeStateByCell(arena, result.stateByCell)
  };
}

// ---------- STRATEGIES ----------
// Strategy definitions: presets and math-based generators

// Uses preset JSON to build state
function buildPresetStrategy(presetName) {
  return {
    randomEligible: false,
    run: ({ arena, presets }) => {
      const preset = presets[presetName];
      if (!preset) {
        return createEmptyState();
      }

      return {
        stateByCell: normalizeStateByCell(arena, preset.stateByCell)
      };
    }
  };
}

// Rotating angular spoke pattern, deterministic per turn
function buildRotatingSunburstStrategy({
  spokeCount = 8,
  step = Math.PI / 16,
  halfWidth = Math.PI / 25,
  centerExclusionRadius = 1.25,
  cx = 10,
  cy = 10
} = {}) {
  const baseSpokeAngles = [];
  for (let i = 0; i < spokeCount; i++) {
    baseSpokeAngles.push((TAU / spokeCount) * i);
  }

  return {
    randomEligible: true,
    run: ({ arena, turn = 0 }) => {
      const stateByCell = {};
      const phase = turn * step;

      for (const cellKey of arena.allowedCells) {
        if (arena.columnCells.has(cellKey)) continue;

        const { x, y } = parseKey(cellKey);
        const { dist, angle } = getPolarFromArenaCenter(x, y, cx, cy);

        if (dist < centerExclusionRadius) continue;

        let active = false;

        for (const baseAngle of baseSpokeAngles) {
          const spokeAngle = normalizeAngle(baseAngle + phase);
          if (angularDistance(angle, spokeAngle) <= halfWidth) {
            active = true;
            break;
          }
        }

        if (!active) continue;

        stateByCell[cellKey] = deterministicWallHeight("RotatingSunburst", x, y, turn);
      }

      return { stateByCell };
    }
  };
}

// Outward-moving ring pattern with spacing
function buildRippleStrategy({
  spacing = 3,
  centerExclusionRadius = 0,
  cx = 10,
  cy = 10
} = {}) {
  return {
    randomEligible: true,
    run: ({ arena, turn = 0 }) => {
      const stateByCell = {};

      for (const cellKey of arena.allowedCells) {
        if (arena.columnCells.has(cellKey)) continue;

        const { x, y } = parseKey(cellKey);
        const { dist } = getPolarFromArenaCenter(x, y, cx, cy);

        if (dist < centerExclusionRadius) continue;

        const band = Math.floor(dist);
        const active = mod(band - turn, spacing) === 0;

        if (!active) continue;

        stateByCell[cellKey] = deterministicWallHeight("Ripple", x, y, turn);
      }

      return { stateByCell };
    }
  };
}

// ---------- RANDOM / GENERIC HELPERS ----------
// Shared helpers for shuffle and random strategy selection

function randomChoice(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function getMutableCellKeys(arena) {
  return [...arena.allowedCells].filter((cellKey) => !arena.columnCells.has(cellKey));
}

function stateOptionsExcluding(current) {
  return [CELL_STATES.OPEN, CELL_STATES.WALL_LOW, CELL_STATES.WALL_HIGH]
    .filter((value) => value !== current);
}

function randomEligibleStrategyNames(strategies) {
  return Object.entries(strategies)
    .filter(([, strategy]) => strategy?.randomEligible === true)
    .map(([name]) => name);
}

// ---------- PUBLIC API ----------
// External interface used by harness and Foundry module

// Creates normalized arena from raw JSON
export function createArena(rawArena) {
  return normalizeArena(rawArena);
}

// Creates normalized preset map
export function createPresets(rawPresets) {
  return normalizePresets(rawPresets);
}

// Creates initial state
export function createState(rawState = {}) {
  return {
    stateByCell: cloneStateByCell(rawState.stateByCell)
  };
}

// Builds context passed into strategies
export function createContext({ arena, currentState, presets, turn = 0 }) {
  return {
    arena,
    currentState: cloneState(currentState),
    presets,
    turn
  };
}

// Registers all strategies (presets + math)
export function createStrategies(presets = {}) {
  const strategies = {};

  for (const presetName of Object.keys(presets)) {
    strategies[presetName] = buildPresetStrategy(presetName);
  }

  strategies.RotatingSunburst = buildRotatingSunburstStrategy();
  strategies.Ripple = buildRippleStrategy();

  return strategies;
}

// Adds custom strategy at runtime
export function registerStrategy(strategies, name, strategy, { overwrite = false } = {}) {
  if (!strategies || typeof strategies !== "object") return false;
  if (typeof name !== "string" || !name.trim()) return false;
  if (!strategy || typeof strategy.run !== "function") return false;
  if (!overwrite && strategies[name]) return false;

  strategies[name] = {
    randomEligible: strategy.randomEligible === true,
    run: strategy.run
  };

  return true;
}

// Returns available strategy names
export function getStrategyNames(strategies) {
  return Object.keys(strategies ?? {});
}

// Returns state at x,y
export function getCell(currentState, x, y) {
  return getCellState(currentState, keyFromXY(x, y));
}

// Sets a cell safely (respecting arena + column rules)
export function setCell(arena, currentState, x, y, newValue) {
  const cellKey = keyFromXY(x, y);
  if (!isMutableCell(arena, cellKey)) return cloneState(currentState);

  const next = cloneState(currentState);

  if (!STORED_STATES.has(newValue)) {
    delete next.stateByCell[cellKey];
  } else {
    next.stateByCell[cellKey] = newValue;
  }

  next.stateByCell = normalizeStateByCell(arena, next.stateByCell);
  return next;
}

// Cycles OPEN → LOW → HIGH → OPEN, or OPEN → LOW → HIGH → PIT → OPEN
export function cycleCell(arena, currentState, x, y, options = {}) {
  const { includePit = false } = options;

  const cellKey = keyFromXY(x, y);
  if (!isMutableCell(arena, cellKey)) return cloneState(currentState);

  const current = getCellState(currentState, cellKey);

  if (!includePit) {
    if (current === CELL_STATES.OPEN) {
      return setCell(arena, currentState, x, y, CELL_STATES.WALL_LOW);
    }
    if (current === CELL_STATES.WALL_LOW) {
      return setCell(arena, currentState, x, y, CELL_STATES.WALL_HIGH);
    }
    return setCell(arena, currentState, x, y, CELL_STATES.OPEN);
  }

  if (current === CELL_STATES.OPEN) {
    return setCell(arena, currentState, x, y, CELL_STATES.WALL_LOW);
  }
  if (current === CELL_STATES.WALL_LOW) {
    return setCell(arena, currentState, x, y, CELL_STATES.WALL_HIGH);
  }
  if (current === CELL_STATES.WALL_HIGH) {
    return setCell(arena, currentState, x, y, CELL_STATES.PIT);
  }
  return setCell(arena, currentState, x, y, CELL_STATES.OPEN);
}

// Clears all state
export function clearState() {
  return createEmptyState();
}

// Applies a strategy (or random eligible one)
export function build({ arena, currentState, presets, strategies, turn = 0 }, strategyName) {
  if (!strategies || typeof strategies !== "object") {
    return cloneState(currentState);
  }

  if (strategyName === "Random") {
    const eligibleNames = randomEligibleStrategyNames(strategies);
    const chosen = randomChoice(eligibleNames);
    if (!chosen) return cloneState(currentState);
    return build({ arena, currentState, presets, strategies, turn }, chosen);
  }

  const strategy = strategies[strategyName];
  if (!strategy || typeof strategy.run !== "function") {
    return cloneState(currentState);
  }

  const result = strategy.run(
    createContext({ arena, currentState, presets, turn })
  );

  return validateStrategyResult(arena, result);
}

// Bounded random mutation of current state
export function shuffle(arena, currentState) {
  const next = cloneState(currentState);
  const mutableCellKeys = getMutableCellKeys(arena);

  const minChangeChance = 0.08;
  const maxChangeChance = 0.18;
  const changeChance = minChangeChance + Math.random() * (maxChangeChance - minChangeChance);

  for (const cellKey of mutableCellKeys) {
    if (Math.random() >= changeChance) continue;

    const current = getCellState(next, cellKey);
    const options = stateOptionsExcluding(current);
    const chosen = randomChoice(options);

    if (chosen === CELL_STATES.OPEN) {
      delete next.stateByCell[cellKey];
    } else if (
      chosen === CELL_STATES.WALL_LOW ||
      chosen === CELL_STATES.WALL_HIGH
    ) {
      next.stateByCell[cellKey] = chosen;
    }
  }

  next.stateByCell = normalizeStateByCell(arena, next.stateByCell);
  return next;
}

// Returns stable sorted JSON representation
export function serializeState(currentState) {
  return {
    stateByCell: Object.fromEntries(
      sortEntriesByRowThenCol(Object.entries(cloneStateByCell(currentState.stateByCell)))
    )
  };
}

// Creates full engine bundle (arena + presets + strategies + state)
export function createEngine(rawArena, rawPresets = {}) {
  const arena = createArena(rawArena);
  const presets = createPresets(rawPresets);
  const strategies = createStrategies(presets);
  const currentState = createEmptyState();

  return {
    arena,
    presets,
    strategies,
    currentState
  };
}