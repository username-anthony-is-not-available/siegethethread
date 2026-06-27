// Pure grid state model for SiegeTheThread Milestone 1.
// Intentionally free of any Phaser / DOM dependencies so it can be unit tested
// in isolation from the WebGL rendering context.

export const GRID_SIZE = 16;
export const TILE_WALL = 0;
export const TILE_PATH = 1;
export const TOTAL_TILES = GRID_SIZE * GRID_SIZE;

export type Grid = number[][];

export function createGrid(size: number = GRID_SIZE): Grid {
  const grid: Grid = [];
  for (let row = 0; row < size; row++) {
    const cells: number[] = [];
    for (let col = 0; col < size; col++) {
      cells.push(TILE_WALL);
    }
    grid.push(cells);
  }
  return grid;
}

export function gridSize(grid: Grid): number {
  return grid.length;
}

export function isInRange(grid: Grid, row: number, col: number): boolean {
  if (row < 0 || col < 0) {
    return false;
  }
  const rowCells = grid[row];
  if (!rowCells) {
    return false;
  }
  return col < rowCells.length;
}

export function getTile(grid: Grid, row: number, col: number): number | null {
  if (!isInRange(grid, row, col)) {
    return null;
  }
  const rowCells = grid[row];
  if (!rowCells) {
    return null;
  }
  const value = rowCells[col];
  return value === undefined ? null : value;
}

export function toggleTile(grid: Grid, row: number, col: number): Grid {
  if (!isInRange(grid, row, col)) {
    return grid;
  }
  const next: Grid = grid.map((cells) => cells.slice());
  const rowCells = next[row];
  if (!rowCells) {
    return grid;
  }
  const current = rowCells[col];
  if (current === undefined) {
    return grid;
  }
  rowCells[col] = current === TILE_WALL ? TILE_PATH : TILE_WALL;
  return next;
}

export function countPaths(grid: Grid): number {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell === TILE_PATH) {
        count += 1;
      }
    }
  }
  return count;
}
