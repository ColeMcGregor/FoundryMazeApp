import readline from "node:readline";
import {
  buildMazeFromSpec,
  formatMazeAscii,
  shuffleMazeCells,
  ShapeType,
} from "./maze.js";

const spec = {
  shape: ShapeType.ELLIPSE,
  width: 18,
  height: 18,
  chainCount: 20,
  minChainLength: 2,
  maxChainLength: 5,
  straightBias: 0.4,
};

let maze = buildMazeFromSpec(spec);

function renderMaze() {
  console.clear();
  console.log("S = shuffle | R = rebuild | Q = quit\n");
  console.log(maze.meta);
  console.log();
  console.log(formatMazeAscii(maze));
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

renderMaze();

rl.on("line", (input) => {
  const command = input.trim().toLowerCase();

  if (command === "q") {
    rl.close();
    return;
  }

  if (command === "r") {
    maze = buildMazeFromSpec(spec);
    renderMaze();
    return;
  }

  if (command === "s") {
    maze = shuffleMazeCells(maze);
    renderMaze();
    return;
  }

  console.log("Unknown command. Use S to shuffle, R to rebuild, or Q to quit.");
});

rl.on("close", () => {
  process.exit(0);
});