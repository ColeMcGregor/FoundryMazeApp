const MODULE_ID = "boss-maze";

const PATHS = {
  arena: `modules/${MODULE_ID}/data/Arena_Setup.json`,
  presets: `modules/${MODULE_ID}/data/presets.json`
};

const runtime = {
  initialized: false,
  mazeApi: null,
  rawArena: null,
  rawPresets: null,
  arena: null,
  presets: null,
  strategies: null,
  currentState: null,
  currentTurn: 0
};

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function requireInitialized() {
  if (!runtime.initialized || !runtime.mazeApi) {
    throw new Error("Boss Maze runtime is not initialized.");
  }
}

function cloneSerializable(value) {
  return foundry.utils.deepClone(value);
}

export async function initialize(mazeApi) {
  if (runtime.initialized) return getRuntime();

  runtime.mazeApi = mazeApi;

  runtime.rawArena = await loadJSON(PATHS.arena);
  runtime.rawPresets = await loadJSON(PATHS.presets);

  runtime.arena = mazeApi.createArena(runtime.rawArena);
  runtime.presets = mazeApi.createPresets(runtime.rawPresets);
  runtime.strategies = mazeApi.createStrategies(runtime.presets);
  runtime.currentState = mazeApi.createState();
  runtime.currentTurn = 0;
  runtime.initialized = true;

  return getRuntime();
}

export function getRuntime() {
  requireInitialized();

  return {
    initialized: runtime.initialized,
    currentTurn: runtime.currentTurn,
    rawArena: cloneSerializable(runtime.rawArena),
    rawPresets: cloneSerializable(runtime.rawPresets),
    arena: {
      allowedCells: [...runtime.arena.allowedCells],
      columnCells: [...runtime.arena.columnCells],
      ...(Number.isInteger(runtime.arena.width) ? { width: runtime.arena.width } : {}),
      ...(Number.isInteger(runtime.arena.height) ? { height: runtime.arena.height } : {})
    },
    presets: cloneSerializable(runtime.presets),
    strategyNames: runtime.mazeApi.getStrategyNames(runtime.strategies),
    currentState: runtime.mazeApi.serializeState(runtime.currentState)
  };
}

export function getStrategyNames() {
  requireInitialized();
  return runtime.mazeApi.getStrategyNames(runtime.strategies);
}

export function getCurrentTurn() {
  requireInitialized();
  return runtime.currentTurn;
}

export function setTurn(turn) {
  requireInitialized();

  if (!Number.isInteger(turn)) {
    throw new Error("Turn must be an integer.");
  }

  runtime.currentTurn = turn;
  return runtime.currentTurn;
}

export function stepTurn(delta = 1) {
  requireInitialized();

  if (!Number.isInteger(delta)) {
    throw new Error("Turn delta must be an integer.");
  }

  runtime.currentTurn += delta;
  return runtime.currentTurn;
}

export function resetTurn() {
  requireInitialized();
  runtime.currentTurn = 0;
  return runtime.currentTurn;
}

export function getState() {
  requireInitialized();
  return runtime.mazeApi.serializeState(runtime.currentState);
}

export function clearState() {
  requireInitialized();
  runtime.currentState = runtime.mazeApi.clearState();
  return getState();
}

export function build(strategyName) {
  requireInitialized();

  runtime.currentState = runtime.mazeApi.build(
    {
      arena: runtime.arena,
      currentState: runtime.currentState,
      presets: runtime.presets,
      strategies: runtime.strategies,
      turn: runtime.currentTurn
    },
    strategyName
  );

  return getState();
}

export function shuffle() {
  requireInitialized();

  runtime.currentState = runtime.mazeApi.shuffle(
    runtime.arena,
    runtime.currentState
  );

  return getState();
}

export function cycleCell(x, y) {
  requireInitialized();

  runtime.currentState = runtime.mazeApi.cycleCell(
    runtime.arena,
    runtime.currentState,
    x,
    y
  );

  return getState();
}

export function setCell(x, y, value) {
  requireInitialized();

  runtime.currentState = runtime.mazeApi.setCell(
    runtime.arena,
    runtime.currentState,
    x,
    y,
    value
  );

  return getState();
}

export function registerStrategy(name, strategy, options = {}) {
  requireInitialized();
  return runtime.mazeApi.registerStrategy(runtime.strategies, name, strategy, options);
}

export function getPaths() {
  return { ...PATHS };
}