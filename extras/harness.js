import * as Maze from "../boss-maze/scripts/maze.js";

const CELL_SIZE = 50;

const ASSETS = {
  column: "./boss-maze/assets/Column1.png",
  low: "./boss-maze/assets/ShortWall1.png",
  high: "./boss-maze/assets/TallWall1.png"
};

const arenaEl = document.getElementById("arena");
const presetSelectEl = document.getElementById("preset-select");
const buildBtn = document.getElementById("build");
const shuffleBtn = document.getElementById("shuffle");
const clearBtn = document.getElementById("clear");
const exportBtn = document.getElementById("export");
const clickLayerToggleEl = document.getElementById("toggle-click-layer");
const outputEl = document.getElementById("output");

// Optional controls: if present in index.html, they will work.
// If absent, harness still runs safely.
const turnValueEl = document.getElementById("turn-value");
const turnPrevBtn = document.getElementById("turn-prev");
const turnNextBtn = document.getElementById("turn-next");
const turnResetBtn = document.getElementById("turn-reset");

const DEFAULT_TEST_PRESET = "StartSetup";

let currentTurn = 0;
let lastBuiltStrategyName = null;

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load ${path}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function keyToXY(key) {
  return key.split(",").map(Number);
}

function placeSprite(img, x, y) {
  img.style.left = `${x * CELL_SIZE}px`;

  const applyTop = () => {
    const h = img.naturalHeight || img.height || CELL_SIZE;
    img.style.top = `${y * CELL_SIZE + (CELL_SIZE - h)}px`;
  };

  if (img.complete) {
    applyTop();
  } else {
    img.onload = applyTop;
  }
}

function createImg(src) {
  const img = new Image();
  img.src = src;
  img.classList.add("tile");
  return img;
}

function updateTurnDisplay() {
  if (turnValueEl) {
    turnValueEl.textContent = String(currentTurn);
  }
}

function updateOutput() {
  const payload = {
    turn: currentTurn,
    selectedStrategy: presetSelectEl?.value ?? null,
    state: Maze.serializeState(currentState)
  };

  outputEl.textContent = JSON.stringify(payload, null, 2);
}

function clearRenderedTiles() {
  arenaEl.querySelectorAll("img.tile").forEach((el) => el.remove());
}

function render() {
  clearRenderedTiles();

  for (const cellKey of arena.allowedCells) {
    const [x, y] = keyToXY(cellKey);

    if (arena.columnCells.has(cellKey)) {
      const img = createImg(ASSETS.column);
      placeSprite(img, x, y);
      arenaEl.appendChild(img);
      continue;
    }

    const value = currentState.stateByCell[cellKey];

    if (value === Maze.CELL_STATES.WALL_LOW) {
      const img = createImg(ASSETS.low);
      placeSprite(img, x, y);
      arenaEl.appendChild(img);
    } else if (value === Maze.CELL_STATES.WALL_HIGH) {
      const img = createImg(ASSETS.high);
      placeSprite(img, x, y);
      arenaEl.appendChild(img);
    }
  }

  updateTurnDisplay();
  updateOutput();
}

function buildClickLayer() {
  arenaEl.querySelectorAll(".cell").forEach((el) => el.remove());

  for (const cellKey of arena.allowedCells) {
    const [x, y] = keyToXY(cellKey);

    const cell = document.createElement("div");
    cell.classList.add("cell");
    cell.style.left = `${x * CELL_SIZE}px`;
    cell.style.top = `${y * CELL_SIZE}px`;
    cell.title = cellKey;

    if (arena.columnCells.has(cellKey)) {
      cell.classList.add("column-cell");
    } else {
      cell.addEventListener("click", () => {
        currentState = Maze.cycleCell(arena, currentState, x, y);
        render();
      });
    }

    arenaEl.appendChild(cell);
  }
}

function populatePresetSelect() {
  const names = Object.keys(strategies);
  presetSelectEl.innerHTML = "";

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    presetSelectEl.appendChild(option);
  }

  if (names.includes(DEFAULT_TEST_PRESET)) {
    presetSelectEl.value = DEFAULT_TEST_PRESET;
  } else if (names.length > 0) {
    presetSelectEl.selectedIndex = 0;
  }
}

function buildSelectedStrategy() {
  const selected = presetSelectEl.value;
  if (!selected) return;

  currentState = Maze.build(
    { arena, currentState, presets, strategies, turn: currentTurn },
    selected
  );

  lastBuiltStrategyName = selected;
  render();
}

function rebuildLastStrategyIfAny() {
  if (!lastBuiltStrategyName) return;

  currentState = Maze.build(
    { arena, currentState, presets, strategies, turn: currentTurn },
    lastBuiltStrategyName
  );

  render();
}

const rawArena = await loadJSON("./boss-maze/data/Arena_Setup.json");
const rawPresets = await loadJSON("./boss-maze/data/presets.json");

console.log(rawPresets);
console.log(Maze.createPresets(rawPresets));

const arena = Maze.createArena(rawArena);
const presets = Maze.createPresets(rawPresets);
const strategies = Maze.createStrategies(presets);

console.log(presets);
console.log(strategies);

let currentState = Maze.createState();

populatePresetSelect();
buildClickLayer();
updateTurnDisplay();

clickLayerToggleEl.addEventListener("change", () => {
  arenaEl.classList.toggle("show-click-layer", clickLayerToggleEl.checked);
});

presetSelectEl.addEventListener("change", () => {
  // Do not auto-build on dropdown change unless you want immediate behavior.
  // Keeping it manual keeps parity with your existing flow.
  updateOutput();
});

buildBtn.addEventListener("click", () => {
  buildSelectedStrategy();
});

shuffleBtn.addEventListener("click", () => {
  currentState = Maze.shuffle(arena, currentState);
  lastBuiltStrategyName = null; // shuffle breaks deterministic turn linkage
  render();
});

clearBtn.addEventListener("click", () => {
  currentState = Maze.clearState();
  lastBuiltStrategyName = null;
  render();
});

exportBtn.addEventListener("click", () => {
  const serialized = {
    turn: currentTurn,
    selectedStrategy: presetSelectEl?.value ?? null,
    state: Maze.serializeState(currentState)
  };

  console.log(JSON.stringify(serialized, null, 2));
  updateOutput();
});

// Optional turn controls
if (turnPrevBtn) {
  turnPrevBtn.addEventListener("click", () => {
    currentTurn -= 1;
    rebuildLastStrategyIfAny();
    updateTurnDisplay();
    updateOutput();
  });
}

if (turnNextBtn) {
  turnNextBtn.addEventListener("click", () => {
    currentTurn += 1;
    rebuildLastStrategyIfAny();
    updateTurnDisplay();
    updateOutput();
  });
}

if (turnResetBtn) {
  turnResetBtn.addEventListener("click", () => {
    currentTurn = 0;
    rebuildLastStrategyIfAny();
    updateTurnDisplay();
    updateOutput();
  });
}

if (presetSelectEl.options.length > 0) {
  buildSelectedStrategy();
} else {
  render();
}