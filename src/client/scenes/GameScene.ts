import { GameObjects, Scene } from 'phaser';
import * as Phaser from 'phaser';
import {
  countPaths,
  createGrid,
  GRID_SIZE,
  isInRange,
  TILE_PATH,
  TILE_WALL,
  TOTAL_TILES,
  toggleTile,
  type Grid,
} from '../../shared/grid';

const TILE_SIZE = 32;
const GRID_PIXELS = GRID_SIZE * TILE_SIZE;

const WALL_COLOR = 0x222222;
const PATH_COLOR = 0x555555;
const STROKE_COLOR = 0x000000;

const MODE_LABEL = 'Build Mode: Tap to Dig';

export class GameScene extends Scene {
  private grid: Grid = [];
  private tiles: GameObjects.Rectangle[][] = [];
  private modeLabel: GameObjects.Text | null = null;
  private counterLabel: GameObjects.Text | null = null;
  private originX = 0;
  private originY = 0;

  constructor() {
    super('GameScene');
  }

  init(): void {
    this.grid = createGrid();
    this.tiles = [];
    this.modeLabel = null;
    this.counterLabel = null;
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setBackgroundColor(0x0b0d12);

    this.originX = Math.round((width - GRID_PIXELS) / 2);
    this.originY = Math.round((height - GRID_PIXELS) / 2);

    this.buildGrid();
    this.buildOverlay(width);

    this.scale.on('resize', this.handleResize, this);
  }

  private buildGrid(): void {
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

    this.modeLabel = this.add
      .text(width / 2, this.originY - 40, MODE_LABEL, labelStyle)
      .setOrigin(0.5);
    this.counterLabel = this.add
      .text(width / 2, this.originY + GRID_PIXELS + 40, '', counterStyle)
      .setOrigin(0.5);
    this.updateCounter();
  }

  private handleTileClick(row: number, col: number): void {
    if (!isInRange(this.grid, row, col)) {
      return;
    }
    const previous = this.grid;
    this.grid = toggleTile(this.grid, row, col);
    if (this.grid === previous) {
      return;
    }
    this.refreshTile(row, col);
    this.updateCounter();
  }

  private refreshTile(row: number, col: number): void {
    const tile = this.tiles[row]?.[col];
    if (!tile) {
      return;
    }
    const state = this.grid[row]?.[col] ?? TILE_WALL;
    tile.setFillStyle(this.colorForState(state));
    this.tweens.add({
      targets: tile,
      scaleX: 1.18,
      scaleY: 1.18,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
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
  }
}
