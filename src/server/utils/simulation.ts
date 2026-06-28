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
      row.push(char === '1' ? 1 : 0);
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

  const grid: number[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: number[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const idx = r * GRID_SIZE + c;
      const char = mapString[idx] ?? '0';
      row.push(char === '1' ? 1 : 0);
    }
    grid.push(row);
  }

  if (grid[0]?.[0] !== 1) {
    return {
      victory: 'Defender',
      frames: [
        {
          tick: 0,
          swarms: [],
        },
      ],
    };
  }

  // Identify traps and towers deterministically
  const trapCoords: Array<{ x: number; y: number }> = [];
  const towerCoords: Array<{ x: number; y: number }> = [];
  let towerCount = 0;

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r]?.[c] === 0 && towerCount < 4 && r > 2 && c > 2) {
        let hasAdjPath = false;
        const neighbors = [
          { r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }
        ];
        for (const n of neighbors) {
          if (n.r >= 0 && n.r < GRID_SIZE && n.c >= 0 && n.c < GRID_SIZE) {
            if (grid[n.r]?.[n.c] === 1) {
              hasAdjPath = true;
              break;
            }
          }
        }
        if (hasAdjPath) {
          towerCoords.push({ x: c, y: r });
          towerCount++;
        }
      } else if (grid[r]?.[c] === 1 && trapCoords.length < 4 && r > 1 && c > 1 && (r !== 15 || c !== 15)) {
        if ((r + c) % 5 === 0) {
          trapCoords.push({ x: c, y: r });
        }
      }
    }
  }

  type SwarmState = {
    x: number;
    y: number;
    count: number;
    visited: Set<string>;
    status: 'moving' | 'reached' | 'deadend';
  };

  const startVisited = new Set<string>();
  startVisited.add('0,0');

  let currentSwarms: SwarmState[] = [
    {
      x: 0,
      y: 0,
      count: initialCount,
      visited: startVisited,
      status: 'moving',
    },
  ];

  const frames: SwarmFrame[] = [
    {
      tick: 0,
      swarms: currentSwarms.map((s) => ({ x: s.x, y: s.y, count: s.count })),
    },
  ];

  const directions = [
    { dx: 0, dy: -1 }, // North
    { dx: 0, dy: 1 },  // South
    { dx: -1, dy: 0 }, // West
    { dx: 1, dy: 0 },  // East
  ];

  let tick = 0;
  const maxTicks = 100;

  while (tick < maxTicks) {
    const activeMoving = currentSwarms.filter((s) => s.status === 'moving' && s.count > 0);
    if (activeMoving.length === 0) {
      break;
    }

    tick++;
    const nextSwarms: SwarmState[] = [];

    for (const swarm of currentSwarms) {
      if (swarm.status === 'reached' || swarm.status === 'deadend' || swarm.count <= 0) {
        nextSwarms.push(swarm);
        continue;
      }

      const validMoves: Array<{ x: number; y: number }> = [];
      for (const { dx, dy } of directions) {
        const nx = swarm.x + dx;
        const ny = swarm.y + dy;

        if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
          if (grid[ny]?.[nx] === 1) {
            const key = `${nx},${ny}`;
            if (!swarm.visited.has(key)) {
              validMoves.push({ x: nx, y: ny });
            }
          }
        }
      }

      if (validMoves.length === 0) {
        nextSwarms.push({
          ...swarm,
          status: 'deadend',
        });
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
            const newVisited = new Set(swarm.visited);
            newVisited.add(`${move.x},${move.y}`);

            // Calculate damage from traps & towers
            let damage = 0;
            if (applyDamage) {
              const isTrap = trapCoords.some(tc => tc.x === move.x && tc.y === move.y);
              if (isTrap) {
                damage += 5; // Balanced trap damage
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
              visited: newVisited,
              status: status,
            });
          }
        }
      }
    }

    const mergedSwarmsMap = new Map<string, SwarmState>();
    for (const swarm of nextSwarms) {
      // Group by spatial coordinates (x, y) to prevent exponential array growth
      const key = `${swarm.x},${swarm.y},${swarm.status}`;
      if (mergedSwarmsMap.has(key)) {
        const existing = mergedSwarmsMap.get(key)!;
        existing.count += swarm.count;
        // Merge the visited histories (signatures)
        for (const v of swarm.visited) {
          existing.visited.add(v);
        }
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
  const victory = hasReached ? 'Attacker' : 'Defender';

  return {
    victory,
    frames,
  };
}
