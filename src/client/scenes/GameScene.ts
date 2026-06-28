import { GameObjects, Scene } from 'phaser';
import * as Phaser from 'phaser';
import { exitExpandedMode } from '@devvit/web/client';
import {
  countPaths,
  createGrid,
  GRID_SIZE,
  isInRange,
  TILE_PATH,
  TILE_WALL,
  TOTAL_TILES,
  type Grid,
} from '../../shared/grid';
import { trpc } from '../trpc';

const TILE_SIZE = 32;
const GRID_PIXELS = GRID_SIZE * TILE_SIZE;

const WALL_COLOR = 0x222222;
const PATH_COLOR = 0x555555;
const PENDING_COLOR = 0xffd166;
const ERROR_COLOR = 0xef233c;
const STROKE_COLOR = 0x000000;

const MODE_LABEL = 'Build Mode: Tap to Dig';

export class GameScene extends Scene {
  private grid: Grid = [];
  private tiles: GameObjects.Rectangle[][] = [];
  private modeLabel: GameObjects.Text | null = null;
  private counterLabel: GameObjects.Text | null = null;
  private statusLabel: GameObjects.Text | null = null;
  private originX = 0;
  private originY = 0;
  private pendingMutations = new Set<string>();
  /** True once the server has responded with the initial map layout */
  private isMapLoaded = false;
  private exitRequested = false;
  private lastExitEvent: MouseEvent | undefined;
  private exitButtonBg: GameObjects.Rectangle | null = null;
  private exitButtonText: GameObjects.Text | null = null;
  private canvasClickListener: ((ev: MouseEvent) => void) | null = null;

  constructor() {
    super('GameScene');
  }

  init(): void {
    this.grid = createGrid();
    this.tiles = [];
    this.modeLabel = null;
    this.counterLabel = null;
    this.statusLabel = null;
    this.pendingMutations.clear();
    this.isMapLoaded = false;
    this.exitRequested = false;
    this.lastExitEvent = undefined;
    this.exitButtonBg = null;
    this.exitButtonText = null;
    this.canvasClickListener = null;
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setBackgroundColor(0x0b0d12);

    this.originX = Math.round((width - GRID_PIXELS) / 2);
    this.originY = Math.round((height - GRID_PIXELS) / 2);

    // Build overlay labels first so the loading state is visible immediately
    this.buildOverlay(width);

    // Show a loading indicator while waiting for the server
    this.showStatus('Loading map…', 0xffd166);

    this.scale.on('resize', this.handleResize, this);

    this.canvasClickListener = (event: MouseEvent) => {
      this.lastExitEvent = event;
      if (this.exitRequested && this.pendingMutations.size === 0) {
        this.performExit();
      }
    };
    this.sys.game.canvas.addEventListener('click', this.canvasClickListener);

    // Asynchronously fetch the map — grid renders only after server responds
    this.fetchInitialMap();
  }

  // ---------------------------------------------------------------------------
  // Network: initial map fetch
  // ---------------------------------------------------------------------------

  private fetchInitialMap(): void {
    trpc.getMap
      .query()
      .then((result: { map: string }) => {
        console.log('[GameScene] FETCH_MAP_RESPONSE received, rendering grid');
        const serverGrid = this.parseMapString(result.map);
        this.grid = serverGrid;
        this.isMapLoaded = true;
        this.buildGrid();
        this.clearStatus();
        this.updateCounter();
      })
      .catch((err: unknown) => {
        const httpStatus = (err as { shape?: { data?: { httpStatus?: number } } }).shape?.data?.httpStatus ?? 'unknown';
        console.error(`[GameScene] Load failed (HTTP: ${httpStatus}):`, err);
        this.showStatus('Map not found. Tap to retry.', ERROR_COLOR);
        this.input.once('pointerdown', () => this.fetchInitialMap());
      });
  }

  // ---------------------------------------------------------------------------
  // Grid rendering (deferred until map is loaded)
  // ---------------------------------------------------------------------------

  private buildGrid(): void {
    // Clear any previously rendered tiles (e.g., on retry)
    for (const row of this.tiles) {
      for (const tile of row) {
        tile.destroy();
      }
    }
    this.tiles = [];

    for (let row = 0; row < GRID_SIZE; row++) {
      this.tiles[row] = [];
      const gridRow = this.grid[row];
      if (!gridRow) {
        continue;
      }
      for (let col = 0; col < GRID_SIZE; col++) {
        const state = gridRow[col] ?? TILE_WALL;
        const x = this.originX + col * TILE_SIZE + TILE_SIZE / 2;
        const y = this.originY + row * TILE_SIZE + TILE_SIZE / 2;
        const tile = this.add
          .rectangle(x, y, TILE_SIZE - 1, TILE_SIZE - 1, this.colorForState(state))
          .setStrokeStyle(1, STROKE_COLOR, 0.25)
          .setInteractive({ useHandCursor: true });
        tile.on('pointerdown', () => {
          this.handleTileClick(row, col);
        });
        const tileRow = this.tiles[row];
        if (tileRow) {
          tileRow[col] = tile;
        }
      }
    }
  }

  private buildOverlay(width: number): void {
    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '22px',
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center',
    };
    const counterStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '18px',
      color: '#06d6a0',
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center',
    };
    const statusStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '16px',
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 3,
      align: 'center',
    };

    this.modeLabel = this.add
      .text(width / 2, this.originY - 40, MODE_LABEL, labelStyle)
      .setOrigin(0.5);
    this.counterLabel = this.add
      .text(width / 2, this.originY + GRID_PIXELS + 40, '', counterStyle)
      .setOrigin(0.5);
    this.statusLabel = this.add
      .text(width / 2, this.originY + GRID_PIXELS / 2, '', statusStyle)
      .setOrigin(0.5)
      .setDepth(10);

    const exitX = width - 90;
    const exitY = 30;
    this.exitButtonBg = this.add
      .rectangle(exitX, exitY, 130, 34, 0xff4500)
      .setInteractive({ useHandCursor: true });
    this.exitButtonText = this.add
      .text(exitX, exitY, 'Save & Exit', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.exitButtonBg.on('pointerover', () => {
      this.exitButtonBg?.setFillStyle(0xff6a00);
    });
    this.exitButtonBg.on('pointerout', () => {
      this.exitButtonBg?.setFillStyle(0xff4500);
    });
    this.exitButtonBg.on('pointerup', () => {
      this.handleExit();
    });
  }

  // ---------------------------------------------------------------------------
  // Tile interaction
  // ---------------------------------------------------------------------------

  private handleTileClick(row: number, col: number): void {
    // Guard: do nothing if the map isn't loaded yet
    if (!this.isMapLoaded) {
      return;
    }
    if (!isInRange(this.grid, row, col)) {
      return;
    }
    const key = `${row},${col}`;
    if (this.pendingMutations.has(key)) {
      return;
    }

    const currentState = this.grid[row]?.[col] ?? TILE_WALL;
    const desiredState = currentState === TILE_WALL ? TILE_PATH : TILE_WALL;

    this.setTilePending(row, col);
    this.pendingMutations.add(key);

    // Optimistic update on local grid for counter display
    const rowCells = this.grid[row];
    if (rowCells) {
      rowCells[col] = desiredState;
    }
    this.updateCounter();

    trpc.mutateTile
      .mutate({ x: col, y: row, state: desiredState })
      .then((result: { x: number; y: number; state: number }) => {
        console.log(`[GameScene] TILE_MUTATION_SUCCESS (${result.x}, ${result.y}) → ${result.state}`);
        this.finalizeTile(result.y, result.x, result.state);
      })
      .catch((err: unknown) => {
        const httpStatus = (err as { shape?: { data?: { httpStatus?: number } } }).shape?.data?.httpStatus ?? 'unknown';
        console.error(`[GameScene] TILE_MUTATION failed for (${col}, ${row}) (HTTP: ${httpStatus}):`, err);
        const revertRow = this.grid[row];
        if (revertRow) {
          revertRow[col] = currentState;
        }
        this.revertTile(row, col, currentState);
        this.updateCounter();
      });
  }

  private handleExit(): void {
    if (this.exitRequested) {
      return;
    }
    this.exitRequested = true;
    if (this.pendingMutations.size > 0) {
      this.showStatus('Saving changes…', 0xffd166);
    } else {
      this.performExit();
    }
  }

  private performExit(): void {
    if (this.lastExitEvent) {
      try {
        exitExpandedMode(this.lastExitEvent);
      } catch (err: unknown) {
        console.error('[GameScene] Failed to exit expanded mode:', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tile visual states
  // ---------------------------------------------------------------------------

  private setTilePending(row: number, col: number): void {
    const tile = this.tiles[row]?.[col];
    if (!tile) {
      return;
    }
    tile.setFillStyle(PENDING_COLOR, 0.5);
    this.tweens.add({
      targets: tile,
      alpha: 0.65,
      duration: 300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private finalizeTile(row: number, col: number, state: number): void {
    const tile = this.tiles[row]?.[col];
    if (!tile) {
      return;
    }
    this.tweens.killTweensOf(tile);
    tile.setAlpha(1);
    tile.setFillStyle(this.colorForState(state));

    const rowCells = this.grid[row];
    if (!rowCells) {
      return;
    }
    rowCells[col] = state;
    this.pendingMutations.delete(`${row},${col}`);
    this.updateCounter();
    if (this.exitRequested && this.pendingMutations.size === 0) {
      this.performExit();
    }
  }

  private revertTile(row: number, col: number, originalState: number): void {
    const tile = this.tiles[row]?.[col];
    if (!tile) {
      return;
    }
    this.tweens.killTweensOf(tile);
    tile.setAlpha(1);
    tile.setFillStyle(ERROR_COLOR);
    this.tweens.add({
      targets: tile,
      alpha: 0,
      duration: 200,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        tile.setFillStyle(this.colorForState(originalState));
        tile.setAlpha(1);
      },
    });
    this.pendingMutations.delete(`${row},${col}`);
    if (this.exitRequested && this.pendingMutations.size === 0) {
      this.performExit();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private parseMapString(mapString: string): Grid {
    const parsed: Grid = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      parsed[row] = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        const index = row * GRID_SIZE + col;
        const char = mapString[index] ?? '0';
        const rowCells = parsed[row];
        if (rowCells) {
          rowCells[col] = parseInt(char, 10);
        }
      }
    }
    return parsed;
  }

  private showStatus(message: string, color: number): void {
    if (!this.statusLabel) {
      return;
    }
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    this.statusLabel.setStyle({ color: hex });
    this.statusLabel.setText(message);
    this.statusLabel.setVisible(true);
  }

  private clearStatus(): void {
    if (this.statusLabel) {
      this.statusLabel.setVisible(false);
    }
  }

  private updateCounter(): void {
    if (!this.counterLabel) {
      return;
    }
    const dug = countPaths(this.grid);
    this.counterLabel.setText(`Total Paths Dug: ${dug} / ${TOTAL_TILES}`);
  }

  private colorForState(state: number): number {
    return state === TILE_PATH ? PATH_COLOR : WALL_COLOR;
  }

  // ---------------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------------

  private handleResize(gameSize: Phaser.Structs.Size): void {
    const width = gameSize.width;
    const height = gameSize.height;
    this.cameras.resize(width, height);
    this.originX = Math.round((width - GRID_PIXELS) / 2);
    this.originY = Math.round((height - GRID_PIXELS) / 2);

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const tile = this.tiles[row]?.[col];
        if (!tile) {
          continue;
        }
        tile.setPosition(
          this.originX + col * TILE_SIZE + TILE_SIZE / 2,
          this.originY + row * TILE_SIZE + TILE_SIZE / 2
        );
      }
    }

    if (this.modeLabel) {
      this.modeLabel.setPosition(width / 2, this.originY - 40);
    }
    if (this.counterLabel) {
      this.counterLabel.setPosition(width / 2, this.originY + GRID_PIXELS + 40);
    }
    if (this.statusLabel) {
      this.statusLabel.setPosition(width / 2, this.originY + GRID_PIXELS / 2);
    }
    if (this.exitButtonBg) {
      this.exitButtonBg.setPosition(width - 90, 30);
    }
    if (this.exitButtonText) {
      this.exitButtonText.setPosition(width - 90, 30);
    }
  }

  shutdown(): void {
    if (this.game?.canvas && this.canvasClickListener) {
      this.game.canvas.removeEventListener('click', this.canvasClickListener);
    }
  }
}
