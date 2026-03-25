// maze.js
// Plain ES module for building, formatting, cloning, and shuffling maze state.

export const ShapeType = Object.freeze({
  RECTANGLE: "rectangle",
  ELLIPSE: "ellipse",
});

export const CellState = Object.freeze({
  OPEN: 0,
  WALL_LOW: 1,
  WALL_HIGH: 2,
});

function key(x, y) {
  return `${x},${y}`;
}

function unkey(cellKey) {
  const [x, y] = cellKey.split(",").map(Number);
  return { x, y };
}

function randomInt(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickRandom(items, rng) {
  if (items.length === 0) return null;
  return items[Math.floor(rng() * items.length)];
}

function neighbors4(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

function buildActiveCells(shape, width, height) {
  const activeCells = new Set();

  if (shape === ShapeType.RECTANGLE) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        activeCells.add(key(x, y));
      }
    }
    return activeCells;
  }

  if (shape === ShapeType.ELLIPSE) {
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const rx = Math.max(width / 2, 1);
    const ry = Math.max(height / 2, 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          activeCells.add(key(x, y));
        }
      }
    }

    return activeCells;
  }

  throw new Error(`Unsupported shape: ${shape}`);
}

function canPlaceWallAt(stateByCell, activeCells, x, y, pendingChainKeys = new Set()) {
  const cellKey = key(x, y);

  if (!activeCells.has(cellKey)) return false;
  if (pendingChainKeys.has(cellKey)) return false;
  if (stateByCell.get(cellKey) !== CellState.OPEN) return false;

  for (const neighbor of neighbors4(x, y)) {
    const neighborKey = key(neighbor.x, neighbor.y);
    if (pendingChainKeys.has(neighborKey)) continue;

    const neighborState = stateByCell.get(neighborKey);
    if (neighborState === CellState.WALL_LOW || neighborState === CellState.WALL_HIGH) {
      return false;
    }
  }

  return true;
}

function countOpenNeighbors(activeCells, stateByCell, x, y, pendingChainKeys = new Set()) {
  let count = 0;

  for (const neighbor of neighbors4(x, y)) {
    const neighborKey = key(neighbor.x, neighbor.y);
    if (!activeCells.has(neighborKey)) continue;
    if (pendingChainKeys.has(neighborKey)) continue;
    if (stateByCell.get(neighborKey) !== CellState.OPEN) continue;
    count++;
  }

  return count;
}

function chooseSeedCell(activeCells, stateByCell, rng) {
  const candidates = [];

  for (const cellKey of activeCells) {
    if (stateByCell.get(cellKey) !== CellState.OPEN) continue;

    const { x, y } = unkey(cellKey);
    if (countOpenNeighbors(activeCells, stateByCell, x, y) >= 1) {
      candidates.push(cellKey);
    }
  }

  return pickRandom(candidates, rng);
}

function weightedNextStepOptions(chain, activeCells, stateByCell, straightBias) {
  const options = [];
  const last = chain[chain.length - 1];
  const pendingChainKeys = new Set(chain.map(({ x, y }) => key(x, y)));

  let lastDir = null;
  if (chain.length >= 2) {
    const prev = chain[chain.length - 2];
    lastDir = { dx: last.x - prev.x, dy: last.y - prev.y };
  }

  for (const neighbor of neighbors4(last.x, last.y)) {
    if (!canPlaceWallAt(stateByCell, activeCells, neighbor.x, neighbor.y, pendingChainKeys)) {
      continue;
    }

    let weight = 1;
    if (lastDir) {
      const dx = neighbor.x - last.x;
      const dy = neighbor.y - last.y;
      const sameDirection = dx === lastDir.dx && dy === lastDir.dy;
      weight = sameDirection ? 1 + straightBias * 3 : 1;
    }

    options.push({
      x: neighbor.x,
      y: neighbor.y,
      weight,
    });
  }

  return options;
}

function pickWeighted(options, rng) {
  if (options.length === 0) return null;

  const total = options.reduce((sum, option) => sum + option.weight, 0);
  let roll = rng() * total;

  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option;
  }

  return options[options.length - 1];
}

function tryBuildChain({
  activeCells,
  stateByCell,
  minChainLength,
  maxChainLength,
  straightBias,
  rng,
}) {
  const seedKey = chooseSeedCell(activeCells, stateByCell, rng);
  if (!seedKey) return null;

  const seed = unkey(seedKey);
  const targetLength = randomInt(minChainLength, maxChainLength, rng);
  const chain = [{ x: seed.x, y: seed.y }];

  while (chain.length < targetLength) {
    const options = weightedNextStepOptions(chain, activeCells, stateByCell, straightBias);
    const next = pickWeighted(options, rng);
    if (!next) break;
    chain.push({ x: next.x, y: next.y });
  }

  if (chain.length < minChainLength) {
    return null;
  }

  return chain;
}

function applyChainToState(stateByCell, chain, wallState) {
  for (const cell of chain) {
    stateByCell.set(key(cell.x, cell.y), wallState);
  }
}

function initializeState(activeCells) {
  const stateByCell = new Map();

  for (const cellKey of activeCells) {
    stateByCell.set(cellKey, CellState.OPEN);
  }

  return stateByCell;
}

function createRng(seed) {
  if (typeof seed !== "number") {
    return Math.random;
  }

  let t = seed >>> 0;

  return function seededRandom() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function getAlternateStates(currentState) {
  return [CellState.OPEN, CellState.WALL_LOW, CellState.WALL_HIGH].filter(
    (state) => state !== currentState
  );
}

export function buildMazeFromSpec(spec = {}) {
  const {
    shape = ShapeType.ELLIPSE,
    width = 18,
    height = 18,
    chainCount = 6,
    minChainLength = 2,
    maxChainLength = 4,
    straightBias = 0.65,
    seed,
    maxPlacementAttempts = 200,
  } = spec;

  if (!Object.values(ShapeType).includes(shape)) {
    throw new Error(`Invalid shape: ${shape}`);
  }

  if (width < 1 || height < 1) {
    throw new Error("width and height must be >= 1");
  }

  if (minChainLength < 1 || maxChainLength < minChainLength) {
    throw new Error("Invalid chain length settings");
  }

  const rng = createRng(seed);
  const activeCells = buildActiveCells(shape, width, height);
  const stateByCell = initializeState(activeCells);

  let builtChains = 0;
  let attempts = 0;

  while (builtChains < chainCount && attempts < maxPlacementAttempts) {
    attempts++;

    const chain = tryBuildChain({
      activeCells,
      stateByCell,
      minChainLength,
      maxChainLength,
      straightBias,
      rng,
    });

    if (!chain) continue;

    const chainState = rng() < 0.5 ? CellState.WALL_LOW : CellState.WALL_HIGH;
    applyChainToState(stateByCell, chain, chainState);
    builtChains++;
  }

  return {
    shape,
    width,
    height,
    activeCells,
    stateByCell,
    meta: {
      chainCountRequested: chainCount,
      chainCountBuilt: builtChains,
      minChainLength,
      maxChainLength,
      straightBias,
      seed: typeof seed === "number" ? seed : null,
      maxPlacementAttempts,
    },
  };
}

export function formatMazeAscii(maze, options = {}) {
  const {
    openChar = " ",
    wallLowChar = "▣",
    wallHighChar = "□",
    voidChar = "█",
  } = options;

  const lines = [];

  for (let y = 0; y < maze.height; y++) {
    let line = "";

    for (let x = 0; x < maze.width; x++) {
      const cellKey = key(x, y);

      if (!maze.activeCells.has(cellKey)) {
        line += voidChar;
        continue;
      }

      const state = maze.stateByCell.get(cellKey);

      if (state === CellState.WALL_LOW) {
        line += wallLowChar;
      } else if (state === CellState.WALL_HIGH) {
        line += wallHighChar;
      } else {
        line += openChar;
      }
    }

    lines.push(line);
  }

  return lines.join("\n");
}

export function printMazeAscii(maze, options = {}) {
  console.log(formatMazeAscii(maze, options));
}

export function cloneMaze(maze) {
  return {
    shape: maze.shape,
    width: maze.width,
    height: maze.height,
    activeCells: new Set(maze.activeCells),
    stateByCell: new Map(maze.stateByCell),
    meta: { ...maze.meta },
  };
}

export function shuffleMazeCells(maze, options = {}) {
  const {
    seed,
    minChangeChance = 0,
    maxChangeChance = 25,
  } = options;

  if (minChangeChance < 0 || minChangeChance > 100 || maxChangeChance < 0 || maxChangeChance > 100) {
    throw new Error("Change chances must be between 0 and 100");
  }

  if (maxChangeChance < minChangeChance) {
    throw new Error("maxChangeChance must be >= minChangeChance");
  }

  const rng = createRng(seed);
  const shuffled = cloneMaze(maze);
  const changeChance = randomInt(minChangeChance, maxChangeChance, rng);

  for (const cellKey of shuffled.activeCells) {
    const currentState = shuffled.stateByCell.get(cellKey);
    const roll = rng() * 100;

    if (roll >= changeChance) continue;

    const alternateStates = getAlternateStates(currentState);
    const nextState = pickRandom(alternateStates, rng);
    shuffled.stateByCell.set(cellKey, nextState);
  }

  shuffled.meta = {
    ...shuffled.meta,
    lastShuffleChance: changeChance,
    lastShuffleSeed: typeof seed === "number" ? seed : null,
    minChangeChance,
    maxChangeChance,
  };

  return shuffled;
}

export function shuffleMazeFromSpec(spec = {}) {
  return buildMazeFromSpec(spec);
}