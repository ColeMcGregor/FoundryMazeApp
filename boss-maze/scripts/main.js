import * as Maze from "./maze.js";
import * as FoundryMaze from "./foundry.js";

Hooks.once("init", () => {
  game.bossMaze = {
    version: "1.0.0",
    maze: Maze,
    foundry: FoundryMaze
  };

  console.log("boss-maze | init");
});

Hooks.once("ready", async () => {
  try {
    await FoundryMaze.initialize(game.bossMaze.maze);
    console.log("boss-maze | ready");
  } catch (err) {
    console.error("boss-maze | failed to initialize", err);
    ui.notifications.error("Boss Maze failed to initialize. Check console.");
  }
});