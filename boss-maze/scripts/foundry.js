// Foundry runtime + interactive canvas editor:
// - Loads arena + presets from module JSON
// - Maintains current maze state and turn
// - Renders current state onto the active canvas using module assets
// - Provides a draggable DOM control panel matching the harness workflow
// - Uses client-side overlay for editing and tile commit for player-visible state

const MODULE_ID = "boss-maze";

// Module-relative data and asset paths
const PATHS = {
  arena: `modules/${MODULE_ID}/data/Arena_Setup.json`,
  presets: `modules/${MODULE_ID}/data/presets.json`,
  assets: {
    column: `modules/${MODULE_ID}/assets/Column.png`,
    low: `modules/${MODULE_ID}/assets/ShortWall.png`,
    high: `modules/${MODULE_ID}/assets/TallWall.png`,
    pit: `modules/${MODULE_ID}/assets/BloodPit.png`
  }
};

// Central runtime state for the active client
const runtime = {
  initialized: false,
  hooksRegistered: false,

  mazeApi: null,

  rawArena: null,
  rawPresets: null,

  arena: null,
  presets: null,
  strategies: null,

  currentState: null,
  currentTurn: 0,

  selectedStrategyName: null,
  lastBuiltStrategyName: null,

  textures: {
    column: null,
    low: null,
    high: null,
    pit: null
  },

  overlayRoot: null,
  spriteLayer: null,
  clickLayer: null,

  controlsElement: null,
  clickLayerVisible: true,
  pitModeEnabled: false
};

// Loads JSON from a module path
async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// Loads a PIXI texture from a module asset path
async function loadTextureSafe(path) {
  try {
    return await loadTexture(path);
  } catch (err) {
    throw new Error(`Failed to load texture ${path}: ${err.message}`);
  }
}

// Ensures runtime is initialized before public operations
function requireInitialized() {
  if (!runtime.initialized || !runtime.mazeApi) {
    throw new Error("Boss Maze runtime is not initialized.");
  }
}

// Deep clone helper for safe returned snapshots
function cloneSerializable(value) {
  return foundry.utils.deepClone(value);
}

// Converts "x,y" key into numeric coordinates
function parseKey(key) {
  return String(key).split(",").map(Number);
}

// Current scene grid size in pixels
function getGridSize() {
  return canvas?.scene?.grid?.size || canvas?.dimensions?.size || 50;
}

// Returns ordered strategy names
function getOrderedStrategyNames() {
  requireInitialized();
  return runtime.mazeApi.getStrategyNames(runtime.strategies);
}

// Current selected strategy from UI/runtime
function getSelectedStrategyName() {
  const select = document.getElementById("boss-maze-strategy-select");
  if (select?.value) return select.value;
  return runtime.selectedStrategyName;
}

// Updates selected strategy in runtime and UI
function setSelectedStrategyName(name) {
  runtime.selectedStrategyName = name;

  const select = document.getElementById("boss-maze-strategy-select");
  if (select) {
    select.value = name ?? "";
  }
}

// Makes a fixed-position DOM element draggable by a handle
function makeElementDraggable(element, handle = element) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.style.cursor = "move";

  const onMouseMove = (event) => {
    if (!dragging) return;

    element.style.left = `${event.clientX - offsetX}px`;
    element.style.top = `${event.clientY - offsetY}px`;
    element.style.right = "auto";
  };

  const onMouseUp = () => {
    dragging = false;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };

  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;

    dragging = true;

    const rect = element.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
}

// Ensures overlay containers exist on the active canvas
function ensureOverlay() {
  if (!canvas?.ready) {
    throw new Error("Canvas is not ready.");
  }

  if (runtime.overlayRoot?.parent) {
    return runtime.overlayRoot;
  }

  runtime.overlayRoot = new PIXI.Container();
  runtime.overlayRoot.sortableChildren = true;
  runtime.overlayRoot.eventMode = "passive";
  runtime.overlayRoot.zIndex = 1000;
  runtime.overlayRoot.name = `${MODULE_ID}-overlay-root`;

  runtime.spriteLayer = new PIXI.Container();
  runtime.spriteLayer.sortableChildren = true;
  runtime.spriteLayer.eventMode = "passive";
  runtime.spriteLayer.zIndex = 1;
  runtime.spriteLayer.name = `${MODULE_ID}-sprite-layer`;

  runtime.clickLayer = new PIXI.Container();
  runtime.clickLayer.sortableChildren = true;
  runtime.clickLayer.eventMode = "passive";
  runtime.clickLayer.zIndex = 2;
  runtime.clickLayer.name = `${MODULE_ID}-click-layer`;

  runtime.overlayRoot.addChild(runtime.spriteLayer);
  runtime.overlayRoot.addChild(runtime.clickLayer);

  canvas.stage.sortableChildren = true;
  canvas.stage.addChild(runtime.overlayRoot);

  return runtime.overlayRoot;
}

// Removes overlay from canvas but leaves runtime state intact
function clearOverlay() {
  if (runtime.overlayRoot?.parent) {
    runtime.overlayRoot.parent.removeChild(runtime.overlayRoot);
  }

  runtime.overlayRoot?.destroy({ children: true });

  runtime.overlayRoot = null;
  runtime.spriteLayer = null;
  runtime.clickLayer = null;
}

// Creates a PIXI sprite bottom-aligned to the given grid cell
function createSpriteForCell(texture, x, y) {
  const gridSize = getGridSize();
  const sprite = new PIXI.Sprite(texture);

  const scale = gridSize / texture.width;
  sprite.width = gridSize;
  sprite.height = texture.height * scale;

  sprite.x = x * gridSize;
  sprite.y = y * gridSize + (gridSize - sprite.height);
  sprite.zIndex = sprite.y;

  sprite.eventMode = "none";
  return sprite;
}

// Creates one clickable cell hitbox for editing
function createClickCell(cellKey) {
  const [x, y] = parseKey(cellKey);
  const gridSize = getGridSize();

  const g = new PIXI.Graphics();
  g.x = x * gridSize;
  g.y = y * gridSize;
  g.zIndex = g.y;
  g.eventMode = "static";
  g.cursor = runtime.arena.columnCells.has(cellKey) ? "default" : "pointer";
  g.hitArea = new PIXI.Rectangle(0, 0, gridSize, gridSize);

  if (runtime.clickLayerVisible) {
    if (runtime.arena.columnCells.has(cellKey)) {
      g.lineStyle(1, 0x4da3ff, 0.35);
      g.beginFill(0x4da3ff, 0.08);
    } else {
      g.lineStyle(1, 0x55ff55, 0.18);
      g.beginFill(0x55ff55, 0.04);
    }
    g.drawRect(0, 0, gridSize, gridSize);
    g.endFill();
  } else {
    g.beginFill(0xffffff, 0.001);
    g.drawRect(0, 0, gridSize, gridSize);
    g.endFill();
  }

  if (!runtime.arena.columnCells.has(cellKey)) {
    g.on("pointertap", () => {
      const [cx, cy] = parseKey(cellKey);
      cycleCell(cx, cy);
    });
  }

  return g;
}

// Rebuilds the current state from the currently selected strategy
function rebuildSelectedStrategy() {
  const strategyName = getSelectedStrategyName();
  if (!strategyName) return getState();

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

  runtime.lastBuiltStrategyName = strategyName;
  runtime.selectedStrategyName = strategyName;

  renderOverlay();
  refreshControls();

  return getState();
}

// Rebuilds the most recently built strategy after turn changes
function rebuildLastStrategyIfAny() {
  if (!runtime.lastBuiltStrategyName) {
    refreshControls();
    return getState();
  }

  runtime.currentState = runtime.mazeApi.build(
    {
      arena: runtime.arena,
      currentState: runtime.currentState,
      presets: runtime.presets,
      strategies: runtime.strategies,
      turn: runtime.currentTurn
    },
    runtime.lastBuiltStrategyName
  );

  renderOverlay();
  refreshControls();

  return getState();
}

// Refreshes the control panel values without rebuilding the DOM
function refreshControls() {
  const turnValue = document.getElementById("boss-maze-turn-value");
  if (turnValue) turnValue.textContent = String(runtime.currentTurn);

  const select = document.getElementById("boss-maze-strategy-select");
  if (select && runtime.selectedStrategyName) {
    select.value = runtime.selectedStrategyName;
  }

  const clickToggle = document.getElementById("boss-maze-click-toggle");
  if (clickToggle) {
    clickToggle.checked = runtime.clickLayerVisible;
  }

  const pitToggle = document.getElementById("boss-maze-pit-toggle");
  if (pitToggle) {
    pitToggle.checked = runtime.pitModeEnabled;
  }
}

// Builds/updates the control panel DOM
function createControls() {
  const old = document.getElementById("boss-maze-controls");
  if (old) old.remove();

  const container = document.createElement("div");
  container.id = "boss-maze-controls";
  container.style.position = "fixed";
  container.style.top = "120px";
  container.style.left = "20px";
  container.style.right = "auto";
  container.style.zIndex = "10000";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "8px";
  container.style.minWidth = "220px";
  container.style.padding = "10px";
  container.style.background = "rgba(0,0,0,0.88)";
  container.style.border = "1px solid #666";
  container.style.borderRadius = "8px";
  container.style.color = "#eee";
  container.style.fontSize = "14px";

  const title = document.createElement("div");
  title.textContent = "Boss Maze";
  title.style.fontWeight = "700";
  title.style.marginBottom = "4px";
  title.style.paddingBottom = "4px";
  title.style.borderBottom = "1px solid #444";
  container.appendChild(title);

  const strategyRow = document.createElement("div");
  strategyRow.style.display = "flex";
  strategyRow.style.flexDirection = "column";
  strategyRow.style.gap = "4px";

  const strategyLabel = document.createElement("label");
  strategyLabel.textContent = "Strategy";
  strategyLabel.setAttribute("for", "boss-maze-strategy-select");

  const select = document.createElement("select");
  select.id = "boss-maze-strategy-select";
  select.style.padding = "6px";

  for (const name of getOrderedStrategyNames()) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }

  if (!runtime.selectedStrategyName) {
    runtime.selectedStrategyName = getOrderedStrategyNames()[0] ?? null;
  }
  if (runtime.selectedStrategyName) {
    select.value = runtime.selectedStrategyName;
  }

  select.addEventListener("change", () => {
    runtime.selectedStrategyName = select.value;
  });

  strategyRow.appendChild(strategyLabel);
  strategyRow.appendChild(select);
  container.appendChild(strategyRow);

  const turnRow = document.createElement("div");
  turnRow.style.display = "flex";
  turnRow.style.alignItems = "center";
  turnRow.style.gap = "6px";

  const turnPrev = document.createElement("button");
  turnPrev.textContent = "Turn -";
  turnPrev.addEventListener("click", () => {
    stepTurn(-1);
  });

  const turnValue = document.createElement("span");
  turnValue.innerHTML = `Turn: <span id="boss-maze-turn-value">${runtime.currentTurn}</span>`;

  const turnNext = document.createElement("button");
  turnNext.textContent = "Turn +";
  turnNext.addEventListener("click", () => {
    stepTurn(1);
  });

  const turnReset = document.createElement("button");
  turnReset.textContent = "Reset";
  turnReset.addEventListener("click", () => {
    resetTurn();
  });

  turnRow.appendChild(turnPrev);
  turnRow.appendChild(turnValue);
  turnRow.appendChild(turnNext);
  turnRow.appendChild(turnReset);
  container.appendChild(turnRow);

  const buttonRow1 = document.createElement("div");
  buttonRow1.style.display = "flex";
  buttonRow1.style.gap = "6px";
  buttonRow1.style.flexWrap = "wrap";

  const buildBtn = document.createElement("button");
  buildBtn.textContent = "Build";
  buildBtn.addEventListener("click", () => {
    build(getSelectedStrategyName());
  });

  const shuffleBtn = document.createElement("button");
  shuffleBtn.textContent = "Shuffle";
  shuffleBtn.addEventListener("click", () => {
    shuffle();
  });

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => {
    clearState();
  });

  const commitBtn = document.createElement("button");
  commitBtn.textContent = "Commit";
  commitBtn.addEventListener("click", async () => {
    await commitToScene();
  });

  buttonRow1.appendChild(buildBtn);
  buttonRow1.appendChild(shuffleBtn);
  buttonRow1.appendChild(clearBtn);
  buttonRow1.appendChild(commitBtn);
  container.appendChild(buttonRow1);

  const clickRow = document.createElement("label");
  clickRow.style.display = "flex";
  clickRow.style.alignItems = "center";
  clickRow.style.gap = "6px";

  const clickToggle = document.createElement("input");
  clickToggle.type = "checkbox";
  clickToggle.id = "boss-maze-click-toggle";
  clickToggle.checked = runtime.clickLayerVisible;
  clickToggle.addEventListener("change", () => {
    runtime.clickLayerVisible = clickToggle.checked;
    renderOverlay();
    refreshControls();
  });

  const clickText = document.createElement("span");
  clickText.textContent = "Show click layer";

  clickRow.appendChild(clickToggle);
  clickRow.appendChild(clickText);
  container.appendChild(clickRow);

  const pitRow = document.createElement("label");
  pitRow.style.display = "flex";
  pitRow.style.alignItems = "center";
  pitRow.style.gap = "6px";

  const pitToggle = document.createElement("input");
  pitToggle.type = "checkbox";
  pitToggle.id = "boss-maze-pit-toggle";
  pitToggle.checked = runtime.pitModeEnabled;
  pitToggle.addEventListener("change", () => {
    runtime.pitModeEnabled = pitToggle.checked;
    refreshControls();
  });

  const pitText = document.createElement("span");
  pitText.textContent = "Enable Blood Pits";

  pitRow.appendChild(pitToggle);
  pitRow.appendChild(pitText);
  container.appendChild(pitRow);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => {
    closeEditor();
  });
  container.appendChild(closeBtn);

  document.body.appendChild(container);
  runtime.controlsElement = container;

  makeElementDraggable(container, title);
  refreshControls();
}

// Removes the control panel DOM
function destroyControls() {
  if (runtime.controlsElement?.parentNode) {
    runtime.controlsElement.parentNode.removeChild(runtime.controlsElement);
  }
  runtime.controlsElement = null;
}

// Renders pits, columns, walls, and click layer onto the active canvas
export function renderOverlay() {
  requireInitialized();
  ensureOverlay();

  runtime.spriteLayer.removeChildren().forEach((child) => child.destroy?.());
  runtime.clickLayer.removeChildren().forEach((child) => child.destroy?.());

  // Render pits first (bottom layer)
  for (const cellKey of runtime.arena.allowedCells) {
    const value = runtime.currentState.stateByCell[cellKey];
    if (value !== runtime.mazeApi.CELL_STATES.PIT) continue;

    const [x, y] = parseKey(cellKey);
    const sprite = createSpriteForCell(runtime.textures.pit, x, y);
    sprite.zIndex = 0;
    runtime.spriteLayer.addChild(sprite);
  }

  // Render columns and wall cells above pits
  for (const cellKey of runtime.arena.allowedCells) {
    const [x, y] = parseKey(cellKey);

    if (runtime.arena.columnCells.has(cellKey)) {
      const sprite = createSpriteForCell(runtime.textures.column, x, y);
      runtime.spriteLayer.addChild(sprite);
      continue;
    }

    const value = runtime.currentState.stateByCell[cellKey];

    if (value === runtime.mazeApi.CELL_STATES.WALL_LOW) {
      const sprite = createSpriteForCell(runtime.textures.low, x, y);
      runtime.spriteLayer.addChild(sprite);
    } else if (value === runtime.mazeApi.CELL_STATES.WALL_HIGH) {
      const sprite = createSpriteForCell(runtime.textures.high, x, y);
      runtime.spriteLayer.addChild(sprite);
    }
  }

  // Build click layer so empty/open cells remain editable
  for (const cellKey of runtime.arena.allowedCells) {
    const clickCell = createClickCell(cellKey);
    runtime.clickLayer.addChild(clickCell);
  }

  return getState();
}

// Opens the interactive editor panel and renders overlay
export function openEditor() {
  requireInitialized();
  createControls();
  renderOverlay();
  return true;
}

// Closes the control panel and removes overlay
export function closeEditor() {
  destroyControls();
  clearOverlay();
  return true;
}

// Toggles the editor open/closed
export function toggleEditor() {
  if (runtime.controlsElement) return closeEditor();
  return openEditor();
}

// Initializes runtime once:
// - loads JSON
// - loads textures
// - builds arena, presets, strategies
// - creates initial empty state
export async function initialize(mazeApi) {
  if (runtime.initialized) return getRuntime();

  runtime.mazeApi = mazeApi;

  runtime.rawArena = await loadJSON(PATHS.arena);
  runtime.rawPresets = await loadJSON(PATHS.presets);

  runtime.textures.column = await loadTextureSafe(PATHS.assets.column);
  runtime.textures.low = await loadTextureSafe(PATHS.assets.low);
  runtime.textures.high = await loadTextureSafe(PATHS.assets.high);
  runtime.textures.pit = await loadTextureSafe(PATHS.assets.pit);

  runtime.arena = mazeApi.createArena(runtime.rawArena);
  runtime.presets = mazeApi.createPresets(runtime.rawPresets);
  runtime.strategies = mazeApi.createStrategies(runtime.presets);
  runtime.currentState = mazeApi.createState();
  runtime.currentTurn = 0;

  const strategyNames = runtime.mazeApi.getStrategyNames(runtime.strategies);
  runtime.selectedStrategyName = strategyNames[0] ?? null;
  runtime.lastBuiltStrategyName = null;

  if (!runtime.hooksRegistered) {
    Hooks.on("canvasReady", () => {
      if (runtime.controlsElement) {
        try {
          renderOverlay();
        } catch (err) {
          console.error(`${MODULE_ID} | failed to re-render on canvasReady`, err);
        }
      }
    });
    runtime.hooksRegistered = true;
  }

  runtime.initialized = true;
  return getRuntime();
}

// Returns a safe snapshot of runtime state
export function getRuntime() {
  requireInitialized();

  return {
    initialized: runtime.initialized,
    currentTurn: runtime.currentTurn,
    selectedStrategyName: runtime.selectedStrategyName,
    lastBuiltStrategyName: runtime.lastBuiltStrategyName,
    pitModeEnabled: runtime.pitModeEnabled,
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

// Returns available strategy names
export function getStrategyNames() {
  requireInitialized();
  return runtime.mazeApi.getStrategyNames(runtime.strategies);
}

// Returns current turn value
export function getCurrentTurn() {
  requireInitialized();
  return runtime.currentTurn;
}

// Sets turn directly and rebuilds last built strategy if present
export function setTurn(turn) {
  requireInitialized();

  if (!Number.isInteger(turn)) {
    throw new Error("Turn must be an integer.");
  }

  runtime.currentTurn = turn;
  rebuildLastStrategyIfAny();
  return runtime.currentTurn;
}

// Advances turn by delta and rebuilds last built strategy if present
export function stepTurn(delta = 1) {
  requireInitialized();

  if (!Number.isInteger(delta)) {
    throw new Error("Turn delta must be an integer.");
  }

  runtime.currentTurn += delta;
  rebuildLastStrategyIfAny();
  return runtime.currentTurn;
}

// Resets turn to 0 and rebuilds last built strategy if present
export function resetTurn() {
  requireInitialized();
  runtime.currentTurn = 0;
  rebuildLastStrategyIfAny();
  return runtime.currentTurn;
}

// Returns current serialized maze state
export function getState() {
  requireInitialized();
  return runtime.mazeApi.serializeState(runtime.currentState);
}

// Clears maze state and rerenders if editor is open
export function clearState() {
  requireInitialized();

  runtime.currentState = runtime.mazeApi.clearState();
  runtime.lastBuiltStrategyName = null;

  if (runtime.controlsElement) {
    renderOverlay();
    refreshControls();
  }

  return getState();
}

// Applies a strategy (preset or math) using the current turn
export function build(strategyName) {
  requireInitialized();

  if (strategyName) {
    runtime.selectedStrategyName = strategyName;
  }

  rebuildSelectedStrategy();
  return getState();
}

// Applies bounded random mutation and rerenders if editor is open
export function shuffle() {
  requireInitialized();

  runtime.currentState = runtime.mazeApi.shuffle(
    runtime.arena,
    runtime.currentState
  );

  runtime.lastBuiltStrategyName = null;

  if (runtime.controlsElement) {
    renderOverlay();
    refreshControls();
  }

  return getState();
}

// Cycles a cell and rerenders if editor is open
export function cycleCell(x, y) {
  requireInitialized();

  runtime.currentState = runtime.mazeApi.cycleCell(
    runtime.arena,
    runtime.currentState,
    x,
    y,
    { includePit: runtime.pitModeEnabled }
  );

  if (runtime.controlsElement) {
    renderOverlay();
    refreshControls();
  }

  return getState();
}

// Sets a cell explicitly and rerenders if editor is open
export function setCell(x, y, value) {
  requireInitialized();

  runtime.currentState = runtime.mazeApi.setCell(
    runtime.arena,
    runtime.currentState,
    x,
    y,
    value
  );

  if (runtime.controlsElement) {
    renderOverlay();
    refreshControls();
  }

  return getState();
}

// Registers a custom strategy at runtime
export function registerStrategy(name, strategy, options = {}) {
  requireInitialized();
  return runtime.mazeApi.registerStrategy(runtime.strategies, name, strategy, options);
}

// Exposes module file paths for debugging or future rendering work
export function getPaths() {
  return { ...PATHS };
}

// Commits current maze state to the scene as Foundry Tile documents
export async function commitToScene() {
  requireInitialized();

  if (!canvas?.scene) {
    throw new Error("No active scene.");
  }

  const scene = canvas.scene;
  const gridSize = getGridSize();

  // Delete existing maze tiles created by this module
  const existingTiles = scene.tiles.filter(t =>
    t.flags?.["boss-maze"]?.isMazeTile
  );

  if (existingTiles.length > 0) {
    await scene.deleteEmbeddedDocuments(
      "Tile",
      existingTiles.map(t => t.id)
    );
  }

  // Build new tile documents using the same bottom-aligned math as PIXI
  const tileData = [];

  for (const cellKey of runtime.arena.allowedCells) {
    const [x, y] = parseKey(cellKey);

    let texturePath = null;
    let texture = null;
    let value = null;

    if (runtime.arena.columnCells.has(cellKey)) {
      texturePath = PATHS.assets.column;
      texture = runtime.textures.column;
    } else {
      value = runtime.currentState.stateByCell[cellKey];

      if (value === runtime.mazeApi.CELL_STATES.PIT) {
        texturePath = PATHS.assets.pit;
        texture = runtime.textures.pit;
      } else if (value === runtime.mazeApi.CELL_STATES.WALL_LOW) {
        texturePath = PATHS.assets.low;
        texture = runtime.textures.low;
      } else if (value === runtime.mazeApi.CELL_STATES.WALL_HIGH) {
        texturePath = PATHS.assets.high;
        texture = runtime.textures.high;
      }
    }

    if (!texturePath || !texture) continue;

    const scale = gridSize / texture.width;
    const scaledWidth = gridSize;
    const scaledHeight = texture.height * scale;

    tileData.push({
      texture: { src: texturePath },

      x: x * gridSize,
      y: y * gridSize + (gridSize - scaledHeight),

      width: scaledWidth,
      height: scaledHeight,

      z: value === runtime.mazeApi.CELL_STATES.PIT
        ? 0
        : Math.round(y * gridSize + (gridSize - scaledHeight)),

      flags: {
        "boss-maze": {
          isMazeTile: true
        }
      }
    });
  }

  if (tileData.length > 0) {
    await scene.createEmbeddedDocuments("Tile", tileData);
  }

  ui.notifications.info("Boss Maze committed to scene.");
}