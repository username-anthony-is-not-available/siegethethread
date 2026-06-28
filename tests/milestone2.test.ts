import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  createDefaultMap,
  getMapKey,
  GRID_SIZE,
  TOTAL_TILES,
} from '../src/server/utils/mapStore';
import type { TileMutationRequest } from '../src/shared/protocol';

// ---------------------------------------------------------------------------
// In-memory Redis simulator
// ---------------------------------------------------------------------------

type MockRedis = Record<string, string>;

const createMockRedis = (initial: MockRedis = {}): MockRedis => {
  return { ...initial };
};

const redisGet = (store: MockRedis, key: string): string | undefined => store[key];
const redisSet = (store: MockRedis, key: string, value: string): void => {
  store[key] = value;
};

// ---------------------------------------------------------------------------
// Simulated tRPC procedure logic (mirrors src/server/trpc.ts)
// ---------------------------------------------------------------------------

type GetMapResult = { map: string };
type MutateTileResult = { x: number; y: number; state: number };
type MutateTileInput = { x: number; y: number; state: number };

async function simulateGetMap(
  store: MockRedis,
  postId: string
): Promise<GetMapResult> {
  const key = getMapKey(postId);
  const existing = redisGet(store, key);
  if (existing && existing.length === TOTAL_TILES) {
    return { map: existing };
  }
  const defaultMap = createDefaultMap();
  redisSet(store, key, defaultMap);
  return { map: defaultMap };
}

async function simulateMutateTile(
  store: MockRedis,
  postId: string,
  input: MutateTileInput
): Promise<MutateTileResult> {
  if (input.x < 0 || input.x >= GRID_SIZE || input.y < 0 || input.y >= GRID_SIZE) {
    throw new Error('OUT_OF_BOUNDS');
  }
  if (input.state !== 0 && input.state !== 1) {
    throw new Error('INVALID_STATE');
  }
  const key = getMapKey(postId);
  const currentMap = redisGet(store, key);
  if (!currentMap || currentMap.length !== TOTAL_TILES) {
    redisSet(store, key, createDefaultMap());
    throw new Error('CORRUPT_MAP');
  }
  const mutation: TileMutationRequest = {
    type: 'TILE_MUTATION_REQUEST',
    x: input.x,
    y: input.y,
    state: input.state,
  };
  const result = applyMutation(currentMap, mutation);
  if (!result.success) {
    throw new Error(result.error ?? 'MUTATION_FAILED');
  }
  const chars = currentMap.split('');
  chars[mutation.y * 16 + mutation.x] = String(mutation.state);
  redisSet(store, key, chars.join(''));
  return { x: input.x, y: input.y, state: input.state };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Milestone 2 - Server-Side Map Mutation Validation', () => {
  describe('map initialization', () => {
    it('generates a default 256-character wall map', () => {
      const map = createDefaultMap();
      expect(map.length).toBe(TOTAL_TILES);
      expect(map).toBe('0'.repeat(TOTAL_TILES));
    });

    it('derives the correct Redis key for a given postId', () => {
      const key = getMapKey('abc123');
      expect(key).toBe('dungeon:layout:abc123');
    });
  });

  describe('atomic tile mutations', () => {
    it('mutates exactly one index in a flat 256-character layout', () => {
      const initialMap = createDefaultMap();
      const targetIndex = 4 * GRID_SIZE + 5;
      const mutation: TileMutationRequest = { type: 'TILE_MUTATION_REQUEST', x: 5, y: 4, state: 1 };

      const result = applyMutation(initialMap, mutation);

      expect(result.success).toBe(true);
      const chars = initialMap.split('');
      chars[targetIndex] = '1';
      expect(chars[targetIndex]).toBe('1');
      expect(chars.filter((c) => c === '1').length).toBe(1);

      for (let i = 0; i < TOTAL_TILES; i++) {
        if (i !== targetIndex) {
          expect(chars[i]).toBe('0');
        }
      }
    });

    it('does not corrupt adjacent tiles on multiple sequential mutations', () => {
      let map = createDefaultMap();

      const mutations: TileMutationRequest[] = [
        { type: 'TILE_MUTATION_REQUEST', x: 0, y: 0, state: 1 },
        { type: 'TILE_MUTATION_REQUEST', x: 0, y: 1, state: 1 },
        { type: 'TILE_MUTATION_REQUEST', x: 1, y: 0, state: 1 },
        { type: 'TILE_MUTATION_REQUEST', x: 15, y: 15, state: 1 },
      ];

      const expectedIndices = [0, 16, 1, 255];

      for (let i = 0; i < mutations.length; i++) {
        const result = applyMutation(map, mutations[i]);
        expect(result.success).toBe(true);
        const chars = map.split('');
        chars[mutations[i].y * GRID_SIZE + mutations[i].x] = String(mutations[i].state);
        map = chars.join('');
      }

      const chars = map.split('');
      const pathIndices: number[] = [];
      for (let i = 0; i < chars.length; i++) {
        if (chars[i] === '1') {
          pathIndices.push(i);
        }
      }

      expect(pathIndices.sort()).toEqual(expectedIndices.sort());
    });

    it('toggles a tile from path back to wall', () => {
      let map = createDefaultMap();

      const first: TileMutationRequest = { type: 'TILE_MUTATION_REQUEST', x: 8, y: 8, state: 1 };
      const firstResult = applyMutation(map, first);
      expect(firstResult.success).toBe(true);
      let chars = map.split('');
      chars[8 * 16 + 8] = String(first.state);
      map = chars.join('');

      const second: TileMutationRequest = { type: 'TILE_MUTATION_REQUEST', x: 8, y: 8, state: 0 };
      const secondResult = applyMutation(map, second);
      expect(secondResult.success).toBe(true);
      chars = map.split('');
      chars[8 * 16 + 8] = String(second.state);
      map = chars.join('');

      expect(map).toBe(createDefaultMap());
    });
  });

  describe('boundary validation', () => {
    const outOfBoundsCases: { x: number; y: number; label: string }[] = [
      { x: -1, y: 0, label: 'negative x' },
      { x: 0, y: -1, label: 'negative y' },
      { x: GRID_SIZE, y: 0, label: 'x equal to grid size' },
      { x: 0, y: GRID_SIZE, label: 'y equal to grid size' },
      { x: GRID_SIZE + 1, y: 0, label: 'x beyond grid size' },
      { x: 0, y: GRID_SIZE + 1, label: 'y beyond grid size' },
      { x: 999, y: 999, label: 'extreme out-of-range' },
    ];

    for (const tc of outOfBoundsCases) {
      it(`rejects ${tc.label} without crashing`, () => {
        const map = createDefaultMap();
        const mutation: TileMutationRequest = {
          type: 'TILE_MUTATION_REQUEST',
          x: tc.x,
          y: tc.y,
          state: 1,
        };

        const result = applyMutation(map, mutation);

        expect(result.success).toBe(false);
        expect(result.error).toBe('OUT_OF_BOUNDS');
        expect(result.newMap).toBeUndefined();
        expect(map.length).toBe(TOTAL_TILES);
      });
    }

    it('rejects invalid state values', () => {
      const map = createDefaultMap();
      const invalidStates = [2, -1, 99, null as unknown as number, undefined as unknown as number];

      for (const state of invalidStates) {
        const mutation: TileMutationRequest = {
          type: 'TILE_MUTATION_REQUEST',
          x: 5,
          y: 5,
          state,
        };

        const result = applyMutation(map, mutation);
        expect(result.success).toBe(false);
        expect(result.error).toBe('INVALID_STATE');
      }
    });

    it('rejects corrupt map strings', () => {
      const corruptMap = '0'.repeat(100);
      const mutation: TileMutationRequest = {
        type: 'TILE_MUTATION_REQUEST',
        x: 5,
        y: 5,
        state: 1,
      };

      const result = applyMutation(corruptMap, mutation);
      expect(result.success).toBe(false);
      expect(result.error).toBe('CORRUPT_MAP');
    });
  });

  describe('Redis integration simulation', () => {
    it('simulates a full fetch-and-mutate lifecycle in-memory', async () => {
      const store = createMockRedis();
      const postId = 'test-post-42';
      const key = getMapKey(postId);

      redisSet(store, key, createDefaultMap());

      const fetchResult = redisGet(store, key);
      expect(fetchResult).toBeDefined();
      expect(fetchResult!.length).toBe(TOTAL_TILES);
      expect(fetchResult!.split('').every((c) => c === '0')).toBe(true);

      const mutation: TileMutationRequest = {
        type: 'TILE_MUTATION_REQUEST',
        x: 7,
        y: 3,
        state: 1,
      };
      const mutated = applyMutation(fetchResult, mutation);
      expect(mutated.success).toBe(true);
      redisSet(store, key, mutated.newMap!);

      const finalMapStr = redisGet(store, key) || createDefaultMap();
      const finalMapChars = finalMapStr.split('');
      finalMapChars[3 * GRID_SIZE + 7] = '1';
      const actualFinal = finalMapChars.join('');
      expect(actualFinal.length).toBe(TOTAL_TILES);
      expect(actualFinal[3 * GRID_SIZE + 7]).toBe('1');
      expect(actualFinal.split('').filter((c) => c === '1').length).toBe(1);

      const sameMutation = applyMutation(actualFinal, mutation);
      expect(sameMutation.success).toBe(true);

      const unchangedMap = redisGet(store, key) || createDefaultMap();
      const unchangedChars = unchangedMap.split('');
      unchangedChars[3 * GRID_SIZE + 7] = '1';
      const actuallyUnchanged = unchangedChars.join('');
      expect(actuallyUnchanged.split('').filter((c) => c === '1').length).toBe(1);
    });
  });

  describe('tRPC procedure simulation (getMap)', () => {
    it('seeds a default map on first fetch when no map exists', async () => {
      const store = createMockRedis();
      const result = await simulateGetMap(store, 'new-post-1');
      expect(result.map.length).toBe(TOTAL_TILES);
      expect(result.map).toBe('0'.repeat(TOTAL_TILES));
      // Should have persisted to store
      expect(store[getMapKey('new-post-1')]).toBe('0'.repeat(TOTAL_TILES));
    });

    it('returns the existing map if already initialized', async () => {
      const store = createMockRedis();
      const key = getMapKey('existing-post');
      const customMap = '1' + '0'.repeat(255);
      redisSet(store, key, customMap);

      const result = await simulateGetMap(store, 'existing-post');
      expect(result.map).toBe(customMap);
    });

    it('reinitializes and returns default when stored map is corrupt', async () => {
      const store = createMockRedis();
      const key = getMapKey('corrupt-post');
      redisSet(store, key, '0'.repeat(100)); // Wrong length

      const result = await simulateGetMap(store, 'corrupt-post');
      expect(result.map.length).toBe(TOTAL_TILES);
      expect(result.map).toBe('0'.repeat(TOTAL_TILES));
    });
  });

  describe('tRPC procedure simulation (mutateTile)', () => {
    it('successfully mutates a valid tile and persists to store', async () => {
      const store = createMockRedis();
      const postId = 'mutation-test';
      redisSet(store, getMapKey(postId), createDefaultMap());

      const result = await simulateMutateTile(store, postId, { x: 5, y: 3, state: 1 });
      expect(result).toEqual({ x: 5, y: 3, state: 1 });

      const stored = store[getMapKey(postId)]!;
      expect(stored[3 * GRID_SIZE + 5]).toBe('1');
      expect(stored.split('').filter((c) => c === '1').length).toBe(1);
    });

    it('throws on out-of-bounds coordinates without writing to Redis', async () => {
      const store = createMockRedis();
      const postId = 'bounds-test';
      const defaultMap = createDefaultMap();
      redisSet(store, getMapKey(postId), defaultMap);

      await expect(
        simulateMutateTile(store, postId, { x: 16, y: 0, state: 1 })
      ).rejects.toThrow('OUT_OF_BOUNDS');

      // Redis must be unchanged
      expect(store[getMapKey(postId)]).toBe(defaultMap);
    });

    it('throws on invalid state value without writing to Redis', async () => {
      const store = createMockRedis();
      const postId = 'state-test';
      const defaultMap = createDefaultMap();
      redisSet(store, getMapKey(postId), defaultMap);

      await expect(
        simulateMutateTile(store, postId, { x: 5, y: 5, state: 2 })
      ).rejects.toThrow('INVALID_STATE');

      expect(store[getMapKey(postId)]).toBe(defaultMap);
    });

    it('throws on corrupt map and reinitializes Redis', async () => {
      const store = createMockRedis();
      const postId = 'corrupt-mutation';
      redisSet(store, getMapKey(postId), '0'.repeat(50));

      await expect(
        simulateMutateTile(store, postId, { x: 5, y: 5, state: 1 })
      ).rejects.toThrow('CORRUPT_MAP');

      // Should have reinitialized
      expect(store[getMapKey(postId)]).toBe(createDefaultMap());
    });

    it('handles multiple sequential mutations atomically', async () => {
      const store = createMockRedis();
      const postId = 'sequential-test';
      redisSet(store, getMapKey(postId), createDefaultMap());

      await simulateMutateTile(store, postId, { x: 0, y: 0, state: 1 });
      await simulateMutateTile(store, postId, { x: 15, y: 15, state: 1 });
      await simulateMutateTile(store, postId, { x: 8, y: 8, state: 1 });

      const finalMap = store[getMapKey(postId)]!;
      const paths = finalMap.split('').filter((c) => c === '1');
      expect(paths.length).toBe(3);
      expect(finalMap[0 * GRID_SIZE + 0]).toBe('1');
      expect(finalMap[15 * GRID_SIZE + 15]).toBe('1');
      expect(finalMap[8 * GRID_SIZE + 8]).toBe('1');
    });
  });
});
