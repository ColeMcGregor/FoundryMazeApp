# Boss Maze (Foundry VTT Module)

A dynamic, deterministic boss arena system for Foundry VTT.

This module provides an interactive maze editor and runtime system that supports:
- preset layouts
- procedural “math-driven” patterns
- turn-based transformations
- manual editing
- commit-to-scene for multiplayer visibility

---

## Features

- **Interactive Editor (GM)**
  - Click-to-cycle cells (Open → Low → High)
  - Toggleable click layer
  - Draggable control panel

- **Strategies**
  - Presets (from JSON)
  - Procedural patterns:
    - Rotating Sunburst
    - Expanding Ripple
  - Deterministic per turn (same input = same output)

- **Turn System**
  - Step forward/backward
  - Reset
  - Patterns update predictably

- **Scene Commit**
  - Converts current maze state into Foundry Tiles
  - Visible to all players
  - Safe replacement (only removes module-created tiles)

---

## Installation

1. Place the module in:


Data/modules/boss-maze/


2. Restart Foundry

3. Enable the module:

Game Settings → Manage Modules → Boss Maze


---

## Usage

Open the editor:

game.bossMaze.foundry.openEditor()


Controls
Strategy Dropdown — select preset or procedural pattern
Build — apply selected strategy
Shuffle — bounded random mutation
Clear — remove all walls
Turn +/- — advance procedural patterns
Reset — return to turn 0
Click Cells — cycle wall states
Commit — apply current layout to scene
Data Structure
Arena
{
  "allowedCells": ["x,y", ...],
  "columnCells": ["x,y", ...]
}
Presets
{
  "PresetName": {
    "stateByCell": {
      "x,y": 1 | 2
    }
  }
}
1 = Low wall
2 = High wall
absence = Open
Architecture
maze.js      → core logic (pure, deterministic)
foundry.js   → runtime + UI + rendering
main.js      → bootstrap + lifecycle hooks
Rendering Model
Editor: client-side PIXI overlay (fast, non-persistent)
Commit: Foundry Tile documents (persistent, multiplayer)
Development Notes
State is sparse (only non-open cells stored)
Procedural strategies are deterministic per (x, y, turn)

Tiles are tagged via flags:

flags.boss-maze.isMazeTile = true
Commit replaces only module-owned tiles


<img width="1390" height="903" alt="image" src="https://github.com/user-attachments/assets/4d7548c6-06d2-461c-8ade-8f93e85e33c3" />
