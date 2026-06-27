# Milestone 1 — The Local Grid Blueprint Phase

SiegeTheThread is a collaborative subreddit dungeon-building and raiding game.
Milestone 1 delivers the **Defender Phase**: a fully local, client-side grid
blueprint editor where a subreddit member taps tiles to dig pathways out of a
mountain of rock, building the daily maze layout. No server persistence, no
external textures, and no network round-trips are required for this phase.

---

## 1. Layout Architecture Summary

### 1.1 Architectural Constraints

| # | Constraint | How it is satisfied |
|---|------------|---------------------|
| 1 | No external textures / assets | Every tile is a Phaser primitive `rectangle` tinted with a solid color. No `.png` / `.json` sprite or atlas files are loaded. The previous asset-loading scenes (`Preloader`, `MainMenu`, `GameOver`) were removed. |
| 2 | Strict mobile aspect ratio | The Phaser game uses a fixed internal resolution of `576 × 1024` (a **9:16** portrait ratio) with `Phaser.Scale.FIT` + `Phaser.Scale.CENTER_BOTH`, so the canvas scales to fit any reddit.com inline / expanded mobile frame without clipping or scrolling. |
| 3 | Modular arrays | Grid state lives in a pure, dependency-free 16×16 multi-dimensional array (`src/shared/grid.ts`). |

### 1.2 File Map

```
src/
├── shared/
│   └── grid.ts                 # Pure grid model (no Phaser/DOM) — unit-testable
├── client/
│   ├── game.ts                 # Phaser GameConfig (9:16 FIT) + DOMContentLoaded boot
│   ├── game.html               # Expanded-view shell embedding #game-container
│   ├── game.css                # Centers + clamps the canvas to a mobile frame
│   ├── splash.html             # Inline landing view (onboarding + "Enter Build Mode")
│   ├── splash.css              # Mobile-first, thumb-friendly landing styling
│   ├── splash.ts               # Wires Start button → requestExpandedMode('game')
│   └── scenes/
│       ├── Boot.ts             # Asset-free boot → starts 'GameScene'
│       └── GameScene.ts        # 16×16 blueprint grid + pointer interaction + overlay
tests/
│   └── milestone1.test.ts      # Vitest unit tests for the pure grid model
vitest.config.ts                # Test runner config (node env)
docs/
│   └── MILESTONE_1.md          # This document
```

### 1.3 Scene Lifecycle

```
Boot (no preload) ──▶ GameScene
                         │
                         ├─ init()    → createGrid() seeds a 16×16 matrix of 0s
                         ├─ create()  → renders 256 rectangles + text overlay
                         └─ pointerdown per tile → toggleTile() + color tween + counter
```

### 1.4 Design Parameters

| Parameter | Value | Location |
|-----------|-------|----------|
| Grid dimensions | 16 × 16 (256 cells) | `GRID_SIZE` in `grid.ts` |
| Tile pixel size | 32 × 32 | `TILE_SIZE` in `GameScene.ts` |
| Grid pixel footprint | 512 × 512 | `GRID_PIXELS` |
| Game internal resolution | 576 × 1024 (9:16) | `game.ts` |
| Wall state (`0`) color | `0x222222` (dark rock) | `WALL_COLOR` |
| Path state (`1`) color | `0x555555` (dark pathway) | `PATH_COLOR` |
| Scale mode | `Phaser.Scale.FIT` + `CENTER_BOTH` | `game.ts` |

---

## 2. Coordinate System Schema

The grid uses a **row-major** coordinate system: `grid[row][col]`, where `row`
is the vertical index (0 = top) and `col` is the horizontal index (0 = left).

### 2.1 Grid → Canvas Pixel Mapping

Each tile's center is computed in `GameScene.buildGrid()`:

```
originX = round((gameWidth  - GRID_PIXELS) / 2)   // horizontal centering offset
originY = round((gameHeight - GRID_PIXELS) / 2)   // vertical centering offset

centerX(gridCol) = originX + col * TILE_SIZE + TILE_SIZE / 2
centerY(gridRow) = originY + row * TILE_SIZE + TILE_SIZE / 2
```

With the default 576 × 1024 internal resolution:

```
originX = round((576 - 512) / 2) = 32
originY = round((1024 - 512) / 2) = 256
```

So the 512×512 grid is centered horizontally (32px gutters) and vertically
(256px gutters top/bottom), leaving room for the **mode label** above
(`originY - 40`) and the **counter label** below (`originY + GRID_PIXELS + 40`).

### 2.2 Concrete Example

| Cell `(row, col)` | State | Center pixel `(x, y)` |
|-------------------|-------|------------------------|
| `(0, 0)`          | wall  | `(48, 272)`  |
| `(4, 5)`          | path  | `(208, 432)` |
| `(15, 15)`        | path  | `(528, 752)` |

### 2.3 Canvas → Cell (pointer resolution)

Tiles are individually interactive GameObjects. A `pointerdown` on a tile
rectangle invokes `handleTileClick(row, col)` with that tile's pre-bound indices,
so no hit-test math is required at event time — the mapping is established once
during `buildGrid()`.

### 2.4 Boundary Contract

`isInRange(grid, row, col)` rejects negative indices and indices `>= GRID_SIZE`.
`getTile` returns `null` for out-of-range cells, and `toggleTile` returns the
grid unchanged (never throws) for out-of-range input. This is verified by the
boundary tests in `tests/milestone1.test.ts`.

---

## 3. State Model (`src/shared/grid.ts`)

The grid model is intentionally decoupled from Phaser so it can be unit tested
in a plain Node environment.

| Export | Signature | Purpose |
|--------|-----------|---------|
| `GRID_SIZE` | `16` | Matrix side length. |
| `TILE_WALL` | `0` | Unexcavated rock indicator. |
| `TILE_PATH` | `1` | Excavated pathway indicator. |
| `TOTAL_TILES` | `256` | Convenience constant. |
| `Grid` | `number[][]` | Row-major state matrix. |
| `createGrid(size?)` | `→ Grid` | Seeds a square matrix filled with `0`. |
| `gridSize(grid)` | `→ number` | Row count. |
| `isInRange(grid, row, col)` | `→ boolean` | Bounds check (never throws). |
| `getTile(grid, row, col)` | `→ number \| null` | Safe accessor. |
| `toggleTile(grid, row, col)` | `→ Grid` | Returns a **new** grid with the cell flipped (immutable); out-of-range returns the same grid. |
| `countPaths(grid)` | `→ number` | Counts cells equal to `TILE_PATH`. |

`GameScene` treats the model as immutable: `this.grid = toggleTile(this.grid, row, col)`.

---

## 4. Interaction Model

1. `init()` calls `createGrid()` → 256 cells of `0`.
2. `create()` renders 256 `rectangle` GameObjects (31×31 with a 1px stroke) and
   registers a `pointerdown` listener on each.
3. On tap, `handleTileClick(row, col)`:
   - Guards with `isInRange`.
   - Replaces `this.grid` via `toggleTile` (immutable).
   - `refreshTile()` sets the new fill color (`0x222222` ↔ `0x555555`) and fires
     a short scale-pop tween (`1.0 → 1.18 → 1.0`, 90ms yoyo) for tactile feedback.
   - `updateCounter()` refreshes the live `Total Paths Dug: X / 256` label.
4. Tapping an active path toggles it back to rock.

### Overlay UI

- **Mode label** (top): `Build Mode: Tap to Dig`
- **Counter label** (bottom): `Total Paths Dug: X / 256`, updated in real time.

---

## 5. Validation Guide

### 5.1 Automated checks

Run from the project root:

```bash
# Unit tests (pure grid model, no WebGL required)
npm run test
# or a single file:
npm run test -- milestone1

# TypeScript type checking
npm run type-check

# ESLint
npm run lint

# Production bundle
npm run build
```

Expected: **10/10 tests pass**, type-check clean, lint clean, build succeeds.

### 5.2 Local playtest via `npx devvit playtest`

`devvit playtest` boots the app against a local subreddit playground and
hot-reloads on source changes. To verify hot-reloading stability for Milestone 1:

1. **Authenticate** (one-time):
   ```bash
   npx devvit login
   ```

2. **Start the playtest session**:
   ```bash
   npm run dev
   # equivalent to: devvit playtest
   ```
   This opens a browser to a local playground subreddit and installs the app.
   The inline view renders `splash.html`; expanding opens `game.html`.

3. **Verify the inline landing (`splash.html`)**:
   - The 🛡️ emblem, title, and the Defender Phase onboarding panel render.
   - The instructions read: *"🛡️ Tap tiles to dig pathways out of the mountain
     to build your subreddit's daily maze layout."*
   - The **Enter Build Mode** button is large and thumb-friendly.

4. **Enter Build Mode**: tap **Enter Build Mode** → `requestExpandedMode` opens
   the expanded `game.html` view containing the Phaser canvas.

5. **Verify the grid blueprint (`GameScene`)**:
   - A centered 16×16 grid of dark rock (`0x222222`) tiles appears.
   - The top label reads `Build Mode: Tap to Dig`.
   - The bottom label reads `Total Paths Dug: 0 / 256`.
   - Tap a rock tile → it flips to pathway (`0x555555`) with a scale-pop tween
     and the counter increments (`1 / 256`).
   - Tap a pathway tile → it flips back to rock and the counter decrements.
   - The canvas scales to fit the mobile frame with no clipping or scrollbars.

6. **Verify hot-reload stability**:
   - With the playtest session running, edit a trivial value in
     `src/client/scenes/GameScene.ts` (e.g., change `MODE_LABEL` text) and save.
   - Vite rebuilds (`devvit.json` `scripts.dev = vite build --watch`) and the
     playground reloads the updated bundle without crashing.
   - Edit `src/shared/grid.ts` (e.g., temporarily change `TILE_WALL` to confirm
     it propagates) and confirm the grid re-seeds correctly on reload.
   - Confirm no state leakage: after a reload, the grid starts again at all-rock
     (0/256), since Milestone 1 state is local only.

7. **Verify mobile aspect ratio**: resize the browser window or use device
   emulation to a narrow portrait viewport. The 9:16 canvas must remain fully
   visible, centered, and non-scrolling at all sizes.

8. **Stop the session**: `Ctrl+C` in the terminal terminates the playtest.

> Note: Milestone 1 is intentionally local-only. There are no server endpoints
> required for the blueprint phase; the existing `/api/*` routes remain available
> for later milestones but are not exercised by the grid editor.
