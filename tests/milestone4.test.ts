import { describe, expect, it } from 'vitest';
import { runSwarmSimulation } from '../src/server/utils/simulation';

describe('Milestone 4: Algorithmic Pathfinding & Swarm Simulation Engine', () => {
  it('should return a defender victory on a completely sealed map', () => {
    const sealedMap = '0'.repeat(256);
    const result = runSwarmSimulation(sealedMap);
    expect(result.victory).toBe('Defender');
    expect(result.frames[0]?.swarms.length).toBe(0);
  });

  it('should return an attacker victory on a corridor map to the vault', () => {
    const grid = Array(16).fill(null).map(() => Array(16).fill(0));
    // Path from (0,0) down to (15,0)
    for (let y = 0; y <= 15; y++) {
      grid[y][0] = 1;
    }
    // Path from (15,0) to (15,15)
    for (let x = 0; x <= 15; x++) {
      grid[15][x] = 1;
    }
    const mapString = grid.map(row => row.join('')).join('');
    const result = runSwarmSimulation(mapString);
    expect(result.victory).toBe('Attacker');
    expect(result.frames.length).toBeGreaterThan(1);
    
    const finalFrame = result.frames[result.frames.length - 1];
    const reachedVault = finalFrame?.swarms.some(s => s.x === 15 && s.y === 15);
    expect(reachedVault).toBe(true);
  });

  it('should split a swarm of 100 units into 50/50 at a T-junction', () => {
    // 16x16 grid initialized to walls '0'
    const grid = Array(16).fill(null).map(() => Array(16).fill(0));
    
    // Walkable path: (0,0) -> (0,1) -> T-junction splitting to (0,2) and (1,1)
    grid[0][0] = 1;
    grid[0][1] = 1;
    grid[0][2] = 1;
    grid[1][1] = 1;

    // Convert 2D grid to flat map string
    const mapString = grid.map(row => row.join('')).join('');
    const result = runSwarmSimulation(mapString);

    // Frame 0: (0,0) count 100
    // Frame 1: (0,1) count 100
    // Frame 2: split to (0,2) count 50 and (1,1) count 50
    expect(result.frames[0]?.swarms).toEqual([{ x: 0, y: 0, count: 100 }]);
    expect(result.frames[1]?.swarms).toEqual([{ x: 1, y: 0, count: 100 }]);
    
    const frame2Swarms = result.frames[2]?.swarms;
    expect(frame2Swarms?.length).toBe(2);
    
    const swarmAt0_2 = frame2Swarms?.find(s => s.x === 2 && s.y === 0);
    const swarmAt1_1 = frame2Swarms?.find(s => s.x === 1 && s.y === 1);

    expect(swarmAt0_2?.count).toBe(50);
    expect(swarmAt1_1?.count).toBe(50);
  });

  it('should terminate a sub-swarm at a dead-end while the parallel branch reaches the vault', () => {
    // 16x16 grid initialized to walls '0'
    const grid = Array(16).fill(null).map(() => Array(16).fill(0));
    
    // Path:
    // (0,0) -> (0,1)
    // At (0,1) split into:
    // Branch A (dead end): (0,2)
    // Branch B (to vault): (1,1) -> (2,1) -> ... -> (15,1) -> (15,2) -> ... -> (15,15)
    grid[0][0] = 1;
    grid[0][1] = 1;
    grid[0][2] = 1;

    // Build path to vault for Branch B
    for (let y = 1; y <= 15; y++) {
      grid[y][1] = 1;
    }
    for (let x = 2; x <= 15; x++) {
      grid[15][x] = 1;
    }

    const mapString = grid.map(row => row.join('')).join('');
    const result = runSwarmSimulation(mapString);

    expect(result.victory).toBe('Attacker');

    // Verify that there is a tick where Branch A (at 0,2) stops moving (dead-end)
    // and is still present in subsequent ticks with count 50,
    // while Branch B continues to advance to (15,15)
    const finalFrame = result.frames[result.frames.length - 1];
    expect(finalFrame).toBeDefined();

    const deadEndSwarm = finalFrame?.swarms.find(s => s.x === 2 && s.y === 0);
    const reachedVaultSwarm = finalFrame?.swarms.find(s => s.x === 15 && s.y === 15);

    expect(deadEndSwarm?.count).toBe(50);
    expect(reachedVaultSwarm?.count).toBe(50);
  });

  it('should not vanish a micro-swarm of size 1 at a 2-way split', () => {
    const grid = Array(16).fill(null).map(() => Array(16).fill(0));
    grid[0][0] = 1;
    grid[0][1] = 1;
    grid[0][2] = 1;
    grid[1][1] = 1;
    const mapString = grid.map(row => row.join('')).join('');
    const result = runSwarmSimulation(mapString, false, 1);

    expect(result.frames[0]?.swarms).toEqual([{ x: 0, y: 0, count: 1 }]);
    expect(result.frames[1]?.swarms).toEqual([{ x: 1, y: 0, count: 1 }]);

    const frame2Swarms = result.frames[2]?.swarms;
    expect(frame2Swarms?.length).toBe(1);
    expect(frame2Swarms?.[0].count).toBe(1);
    const isPathA = frame2Swarms?.[0].x === 2 && frame2Swarms?.[0].y === 0;
    const isPathB = frame2Swarms?.[0].x === 1 && frame2Swarms?.[0].y === 1;
    expect(isPathA || isPathB).toBe(true);
  });
});
