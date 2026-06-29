export type SimulationResult = {
  success: boolean;
  path: Array<{ x: number; y: number }>;
  error?: string;
};

/**
 * Runs a pathfinding simulation from the top-left (0,0) spawn point
 * to the community vault (15,15) on a 16x16 grid.
 * Walkable paths are represented by '1', and solid walls by '0'.
 * Movement is only horizontal and vertical (no diagonals).
 */
export function runRaidSimulation(mapString: string): SimulationResult {
  const GRID_SIZE = 16;
  const TOTAL_TILES = GRID_SIZE * GRID_SIZE;

  if (!mapString || mapString.length !== TOTAL_TILES) {
    return {
      success: false,
      path: [],
      error: `Invalid map layout length: expected ${TOTAL_TILES}, got ${mapString ? mapString.length : 0}`,
    };
  }

  const grid: number[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: number[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const char = mapString[r * GRID_SIZE + c];
      row.push((char === '0' || char === '3') ? 1 : 0);
    }
    grid.push(row);
  }

  if (grid[0]?.[0] !== 1) {
    return {
      success: false,
      path: [],
      error: 'Spawn point (0,0) is blocked.',
    };
  }

  const start = { x: 0, y: 0 };
  const target = { x: 15, y: 15 };

  const queue: Array<{ x: number; y: number; path: Array<{ x: number; y: number }> }> = [];
  const visited = new Set<string>();

  queue.push({ x: start.x, y: start.y, path: [start] });
  visited.add(`${start.x},${start.y}`);

  const directions = [
    { dx: 0, dy: -1 }, // North
    { dx: 0, dy: 1 },  // South
    { dx: -1, dy: 0 }, // West
    { dx: 1, dy: 0 },  // East
  ];

  let bestFailurePath: Array<{ x: number; y: number }> = [start];
  let maxManhattanDist = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const { x, y, path } = current;

    const dist = x + y;
    if (dist > maxManhattanDist) {
      maxManhattanDist = dist;
      bestFailurePath = path;
    }

    if (x === target.x && y === target.y) {
      return {
        success: true,
        path,
      };
    }

    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
        if (grid[ny]?.[nx] === 1) {
          const key = `${nx},${ny}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push({
              x: nx,
              y: ny,
              path: [...path, { x: nx, y: ny }],
            });
          }
        }
      }
    }
  }

  return {
    success: false,
    path: bestFailurePath,
    error: 'No valid path from (0,0) to (15,15).',
  };
}

export type SwarmFrame = {
  tick: number;
  swarms: Array<{
    x: number;
    y: number;
    count: number;
  }>;
};

export type SwarmSimulationResult = {
  victory: 'Attacker' | 'Defender';
  frames: Array<SwarmFrame>;
};

/**
 * Runs a junction-splitting swarm simulation on a 16x16 grid.
 */
export function runSwarmSimulation(mapString: string, applyDamage = false, initialCount = 100): SwarmSimulationResult {
  const GRID_SIZE = 16;

  // 1. Parse Grid Map Layout
  const grid: number[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: number[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const idx = r * GRID_SIZE + c;
      const char = mapString[idx] ?? '0';
      row.push((char === '0' || char === '3') ? 1 : 0);
    }
    grid.push(row);
  }

  if (grid[0]?.[0] !== 1) {
    return { victory: 'Defender', frames: [{ tick: 0, swarms: [] }] };
  }

  // Identify traps and towers from the multi-state map layout
  const trapCoords: Array<{ x: number; y: number }> = [];
  const towerCoords: Array<{ x: number; y: number }> = [];

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const char = mapString[r * GRID_SIZE + c];
      if (char === '2') {
        towerCoords.push({ x: c, y: r });
      } else if (char === '3') {
        trapCoords.push({ x: c, y: r });
      }
    }
  }

  const directions = [
    { dx: 0, dy: -1 }, // North
    { dx: 0, dy: 1 },  // South
    { dx: -1, dy: 0 }, // West
    { dx: 1, dy: 0 },  // East
  ];

  // 2. Pre-compute Source-Centric Distance Field from (0,0) via BFS
  const distGrid: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(-1));
  const queue: Array<{ x: number; y: number; d: number }> = [{ x: 0, y: 0, d: 0 }];
  if (distGrid[0] !== undefined) distGrid[0][0] = 0;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const { dx, dy } of directions) {
      const nx = curr.x + dx;
      const ny = curr.y + dy;
      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
        if (grid[ny]?.[nx] === 1 && distGrid[ny]?.[nx] === -1) {
          if (distGrid[ny] !== undefined) distGrid[ny][nx] = curr.d + 1;
          queue.push({ x: nx, y: ny, d: curr.d + 1 });
        }
      }
    }
  }

  // 3. Initialize Swarm State (Completely Stateless; No Visited History Sets)
  type SwarmState = {
    x: number;
    y: number;
    count: number;
    status: 'moving' | 'reached' | 'deadend';
    delayTicks?: number;
  };

  let currentSwarms: SwarmState[] = [
    { x: 0, y: 0, count: initialCount, status: 'moving', delayTicks: 0 }
  ];

  const frames: SwarmFrame[] = [
    { tick: 0, swarms: currentSwarms.map((s) => ({ x: s.x, y: s.y, count: s.count })) }
  ];

  let tick = 0;
  const maxTicks = 100;

  while (tick < maxTicks) {
    const activeMoving = currentSwarms.filter((s) => s.status === 'moving' && s.count > 0);
    if (activeMoving.length === 0) break;

    tick++;
    const nextSwarms: SwarmState[] = [];

    for (const swarm of currentSwarms) {
      if (swarm.delayTicks && swarm.delayTicks > 0) {
        nextSwarms.push({ ...swarm, delayTicks: swarm.delayTicks - 1 });
        continue;
      }
      if (swarm.status === 'reached' || swarm.status === 'deadend' || swarm.count <= 0) {
        nextSwarms.push(swarm);
        continue;
      }

      // Check neighbors with a strictly GREATER distance value from the source
      const currentDist = distGrid[swarm.y]?.[swarm.x] ?? -1;
      const validMoves: Array<{ x: number; y: number }> = [];

      for (const { dx, dy } of directions) {
        const nx = swarm.x + dx;
        const ny = swarm.y + dy;
        if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
          if (grid[ny]?.[nx] === 1 && distGrid[ny] !== undefined && distGrid[ny][nx]! > currentDist) {
            validMoves.push({ x: nx, y: ny });
          }
        }
      }

      if (validMoves.length === 0) {
        nextSwarms.push({ ...swarm, status: 'deadend' });
      } else {
        const k = validMoves.length;
        const baseSplit = Math.floor(swarm.count / k);
        let remainder = swarm.count % k;

        for (const move of validMoves) {
          let allocatedCount = baseSplit;
          if (remainder > 0) {
            allocatedCount += 1;
            remainder -= 1;
          }

          if (allocatedCount >= 1) {
            const isTarget = move.x === 15 && move.y === 15;

            // Calculate damage from traps & towers
            let damage = 0;
            let newDelayTicks = 0;
            if (applyDamage) {
              const isTrap = trapCoords.some(tc => tc.x === move.x && tc.y === move.y);
              if (isTrap) {
                damage += 5; // Balanced trap damage
                newDelayTicks = 2; // Reduced movement velocity
              }
              for (const tower of towerCoords) {
                const distSq = (tower.x - move.x) ** 2 + (tower.y - move.y) ** 2;
                if (distSq <= 16) { // Tower range is 4 tiles (distSq <= 16)
                  damage += 1; // 1 damage per tick per tower
                }
              }
            }

            const nextCount = Math.max(0, allocatedCount - damage);
            const status = nextCount <= 0 ? 'deadend' : (isTarget ? 'reached' : 'moving');

            nextSwarms.push({
              x: move.x,
              y: move.y,
              count: nextCount,
              status,
              delayTicks: newDelayTicks
            });
          }
        }
      }
    }

    // Spatial coordinate grouping to prevent exponential array scaling
    const mergedSwarmsMap = new Map<string, SwarmState>();
    for (const swarm of nextSwarms) {
      const key = `${swarm.x},${swarm.y},${swarm.status},${swarm.delayTicks || 0}`;
      if (mergedSwarmsMap.has(key)) {
        mergedSwarmsMap.get(key)!.count += swarm.count;
      } else {
        mergedSwarmsMap.set(key, swarm);
      }
    }

    currentSwarms = Array.from(mergedSwarmsMap.values());
    frames.push({
      tick,
      swarms: currentSwarms.map((s) => ({ x: s.x, y: s.y, count: s.count })),
    });
  }

  const hasReached = currentSwarms.some((s) => s.status === 'reached' && s.count > 0);
  return { victory: hasReached ? 'Attacker' : 'Defender', frames };
}
