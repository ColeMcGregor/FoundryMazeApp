// Main module entry point:
// - Wires maze engine + Foundry adapter into global game namespace
// - Initializes module safely on Foundry lifecycle hooks

import * as Maze from "./maze.js";            // Core engine (pure logic)
import * as FoundryMaze from "./foundry.js"; // Foundry-facing runtime wrapper

// Runs once when Foundry initializes modules (before world is ready)
Hooks.once("init", () => {
  // Expose module API on global game object for console and other modules
  game.bossMaze = {
    version: "1.0.0",
    maze: Maze,              // Raw engine access (for advanced use/debugging)
    foundry: FoundryMaze     // Safe runtime + interaction layer
  };

  console.log("boss-maze | init");
});

// Runs once when the game world is fully ready
Hooks.once("ready", async () => {
  try {
    // Initialize runtime:
    // - loads JSON (arena + presets)
    // - builds strategies
    // - creates initial state
    await FoundryMaze.initialize(game.bossMaze.maze);

    console.log("boss-maze | ready");
  } catch (err) {
    // Fail safely: log error + notify user without crashing Foundry
    console.error("boss-maze | failed to initialize", err);
    ui.notifications.error("Boss Maze failed to initialize. Check console.");
  }
});