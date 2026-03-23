import { buildMazeFromSpec, printMazeAscii, ShapeType } from "./maze.js";

const maze = buildMazeFromSpec({
  shape: ShapeType.ELLIPSE,
  width: 18,
  height: 14,
  chainCount: 25,
  minChainLength: 2,
  maxChainLength: 5,
  straightBias: 0.9,
  seed: 10001,
});

console.log(maze.meta);
printMazeAscii(maze);