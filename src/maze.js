// maze.js
// Plain ES module. No Foundry-specific code.
// KISS version: shape + active cells + stateByCell + basic wall-chain generation.

export const ShapeType = Object.freeze({
  RECTANGLE: "rectangle",
  ELLIPSE: "ellipse",
});

export const CellState = Object.freeze({
  OPEN: 0,
  WALL_LOW: 1,   // X
  WALL_HIGH: 2   // H
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

function shuffle(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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
    // Ellipse inscribed in the width/height bounding box.
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const rx = Math.max(width / 2, 1);
    const ry = Math.max(height / 2, 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if ((dx * dx) + (dy * dy) <= 1) {
          activeCells.add(key(x, y));
        }
      }
    }
    return activeCells;
  }

  throw new Error(`Unsupported shape: ${shape}`);
}

function isCellActive(activeCells, x, y) {
  return activeCells.has(key(x, y));
}

function hasWall(stateByCell, x, y) {
  return stateByCell.get(key(x, y)) === CellState.WALL;
}

function canPlaceWallAt(stateByCell, activeCells, x, y, pendingChainKeys = new Set()) {
  const cellKey = key(x, y);

  if (!activeCells.has(cellKey)) return false;
  if (pendingChainKeys.has(cellKey)) return false;
  if (stateByCell.get(cellKey) !== CellState.OPEN) return false;

  // No cardinal touching with any existing wall outside the pending chain.
  for (const neighbor of neighbors4(x, y)) {
    const neighborKey = key(neighbor.x, neighbor.y);
    if (pendingChainKeys.has(neighborKey)) continue;
    if (stateByCell.get(neighborKey) === CellState.WALL) {
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

    // Prefer seeds with room around them.
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
      weight = sameDirection ? (1 + straightBias * 3) : 1;
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

  // Small seeded RNG, enough for this use case.
  let t = seed >>> 0;
  return function seededRandom() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
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
    wallState = CellState.WALL,
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

    const chainState = rng() < 0.5
        ? CellState.WALL_LOW
        : CellState.WALL_HIGH;
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
    },
  };
}

export function formatMazeAscii(maze, options = {}) {
  const {
    openChar = " ",
    wallChar = "▣",
    altWallChar = "□",
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
        line += wallChar;
        } else if (state === CellState.WALL_HIGH) {
        line += altWallChar;
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

export function shuffleMazeFromSpec(spec = {}) {
  // For now, KISS: reshuffle = rebuild from the same kind of spec.
  return buildMazeFromSpec(spec);
}