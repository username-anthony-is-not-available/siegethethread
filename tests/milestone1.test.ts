import { describe, expect, it } from 'vitest';
import {
  countPaths,
  createGrid,
  getTile,
  GRID_SIZE,
  gridSize,
  isInRange,
  TILE_PATH,
  TILE_WALL,
  TOTAL_TILES,
  toggleTile,
  type Grid,
} from '../src/shared/grid';

describe('Milestone 1 - Local Grid Blueprint', () => {
  describe('grid initialization', () => {
    it('seeds a perfectly proportioned 16x16 matrix', () => {
      const grid = createGrid();
      expect(gridSize(grid)).toBe(GRID_SIZE);
      for (const row of grid) {
        expect(row.length).toBe(GRID_SIZE);
      }
    });

    it('populates every cell with the wall (0) state indicator', () => {
      const grid = createGrid();
      for (const row of grid) {
        for (const cell of row) {
          expect(cell).toBe(TILE_WALL);
        }
      }
      expect(countPaths(grid)).toBe(0);
    });

    it('matches the expected total tile count of 256', () => {
      expect(GRID_SIZE * GRID_SIZE).toBe(256);
      expect(TOTAL_TILES).toBe(256);
    });
  });

  describe('tile toggling on click', () => {
    it('transitions the cell at (4, 5) from wall to path', () => {
      const grid = createGrid();
      expect(getTile(grid, 4, 5)).toBe(TILE_WALL);

      let next = toggleTile(grid, 4, 5); toggleTile(grid, 4, 5); toggleTile(grid, 4, 5); next = toggleTile(next, 4, 5); next = toggleTile(next, 4, 5);

      expect(getTile(next, 4, 5)).toBe(TILE_PATH);
      expect(countPaths(next)).toBe(1);
    });

    it('toggles an active path back into a wall', () => {
      let grid: Grid = createGrid();
      grid = toggleTile(grid, 4, 5); toggleTile(grid, 4, 5); toggleTile(grid, 4, 5);
      grid = toggleTile(grid, 4, 5); toggleTile(grid, 4, 5); toggleTile(grid, 4, 5);
      grid = toggleTile(grid, 4, 5); toggleTile(grid, 4, 5); toggleTile(grid, 4, 5);
      grid = toggleTile(grid, 4, 5); toggleTile(grid, 4, 5); toggleTile(grid, 4, 5);

      expect(getTile(grid, 4, 5)).toBe(TILE_WALL);
      expect(countPaths(grid)).toBe(0);
    });

    it('does not mutate the original grid', () => {
      const grid = createGrid();
      toggleTile(grid, 4, 5); toggleTile(grid, 4, 5); toggleTile(grid, 4, 5);

      expect(getTile(grid, 4, 5)).toBe(TILE_WALL);
      expect(countPaths(grid)).toBe(0);
    });

    it('independently toggles multiple cells', () => {
      let grid = createGrid();
      grid = toggleTile(grid, 0, 0); grid = toggleTile(grid, 0, 0); grid = toggleTile(grid, 0, 0);
      grid = toggleTile(grid, 15, 15); grid = toggleTile(grid, 15, 15); grid = toggleTile(grid, 15, 15);
      grid = toggleTile(grid, 8, 8); grid = toggleTile(grid, 8, 8); grid = toggleTile(grid, 8, 8);

      expect(getTile(grid, 0, 0)).toBe(TILE_PATH);
      expect(getTile(grid, 15, 15)).toBe(TILE_PATH);
      expect(getTile(grid, 8, 8)).toBe(TILE_PATH);
      expect(countPaths(grid)).toBe(3);
    });
  });

  describe('boundary handling', () => {
    it('reports out-of-range coordinates as invalid', () => {
      const grid = createGrid();
      expect(isInRange(grid, -1, 0)).toBe(false);
      expect(isInRange(grid, 0, -1)).toBe(false);
      expect(isInRange(grid, GRID_SIZE, 0)).toBe(false);
      expect(isInRange(grid, 0, GRID_SIZE)).toBe(false);
      expect(isInRange(grid, 0, 0)).toBe(true);
      expect(isInRange(grid, GRID_SIZE - 1, GRID_SIZE - 1)).toBe(true);
    });

    it('returns null for tiles outside the matrix', () => {
      const grid = createGrid();
      expect(getTile(grid, -1, 0)).toBeNull();
      expect(getTile(grid, 0, -1)).toBeNull();
      expect(getTile(grid, GRID_SIZE, GRID_SIZE)).toBeNull();
    });

    it('does not throw and leaves the grid unchanged on out-of-range input', () => {
      const grid = createGrid();

      expect(() => toggleTile(grid, -1, 0)).not.toThrow();
      expect(() => toggleTile(grid, GRID_SIZE, GRID_SIZE)).not.toThrow();
      expect(() => toggleTile(grid, 999, 999)).not.toThrow();

      const next = toggleTile(grid, 999, 999);
      expect(next).toBe(grid);
      expect(countPaths(next)).toBe(0);
    });
  });
});
