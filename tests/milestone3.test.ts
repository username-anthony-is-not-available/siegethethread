import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  createDefaultMap,
  getMapKey,
  GRID_SIZE,
  TOTAL_TILES,
} from '../src/server/utils/mapStore';
import type { PlayerClass, PlayerRole, PlayerProfile } from '../src/shared/protocol';

// ---------------------------------------------------------------------------
// Mock Redis Store Simulator
// ---------------------------------------------------------------------------

type RedisHash = Record<string, string>;
type RedisStore = {
  strings: Record<string, string>;
  hashes: Record<string, RedisHash>;
};

function createMockRedisStore(): RedisStore {
  return {
    strings: {},
    hashes: {},
  };
}

// ---------------------------------------------------------------------------
// Simulated Router Procedures
// ---------------------------------------------------------------------------

async function mockInitializeProfile(
  store: RedisStore,
  userId: string,
  chosenClass: PlayerClass,
  chosenRole: PlayerRole,
  dateString: string
): Promise<PlayerProfile> {
  const profileKey = `player:profile:${userId}`;
  const apKey = `player:ap:${userId}:${dateString}`;

  store.hashes[profileKey] = {
    class: chosenClass,
    role: chosenRole,
    level: '1',
    experience: '0',
  };

  if (chosenRole === 'Defender') {
    store.strings[apKey] = '20';
  } else {
    store.strings[apKey] = '0';
  }

  return {
    class: chosenClass,
    role: chosenRole,
    level: 1,
    experience: 0,
  };
}

async function mockGetRemainingEnergy(
  store: RedisStore,
  userId: string,
  dateString: string
): Promise<{ remainingAp: number; totalAp: number }> {
  const profileKey = `player:profile:${userId}`;
  const profile = store.hashes[profileKey];
  const isDefender = profile && profile.role === 'Defender';

  if (!isDefender) {
    return { remainingAp: 0, totalAp: 0 };
  }

  const apKey = `player:ap:${userId}:${dateString}`;
  const rawAp = store.strings[apKey];
  if (rawAp === undefined) {
    store.strings[apKey] = '20';
    return { remainingAp: 20, totalAp: 20 };
  }

  return {
    remainingAp: parseInt(rawAp, 10),
    totalAp: 20,
  };
}

async function mockMutateTile(
  store: RedisStore,
  postId: string,
  userId: string,
  dateString: string,
  input: { x: number; y: number; state: number }
): Promise<{ x: number; y: number; state: number }> {
  const profileKey = `player:profile:${userId}`;
  const profile = store.hashes[profileKey];

  if (!profile) {
    throw new Error('PROFILE_NOT_INITIALIZED');
  }

  if (profile.role !== 'Defender') {
    throw new Error('UNAUTHORIZED_ROLE');
  }

  const apKey = `player:ap:${userId}:${dateString}`;
  const rawAp = store.strings[apKey];
  const ap = rawAp !== undefined ? parseInt(rawAp, 10) : 20;

  if (ap <= 0) {
    throw new Error('OUT_OF_ENERGY');
  }

  const mapKey = getMapKey(postId);
  let currentMap = store.strings[mapKey];
  if (!currentMap) {
    currentMap = createDefaultMap();
    store.strings[mapKey] = currentMap;
  }

  const result = applyMutation(currentMap, {
    type: 'TILE_MUTATION_REQUEST',
    x: input.x,
    y: input.y,
    state: input.state,
  });

  if (!result.success) {
    throw new Error(result.error ?? 'MUTATION_FAILED');
  }

  // Deduct AP & save map
  store.strings[mapKey] = result.newMap!;
  store.strings[apKey] = String(ap - 1);

  return { x: input.x, y: input.y, state: input.state };
}

async function mockDebugSetPlayerRole(
  store: RedisStore,
  userId: string,
  targetRole: PlayerRole,
  dateString: string
): Promise<PlayerProfile> {
  const profileKey = `player:profile:${userId}`;
  const apKey = `player:ap:${userId}:${dateString}`;
  const profile = store.hashes[profileKey];
  if (!profile) {
    throw new Error('PROFILE_NOT_INITIALIZED');
  }
  profile.role = targetRole;
  if (targetRole === 'Defender') {
    store.strings[apKey] = '20';
  } else {
    store.strings[apKey] = '0';
  }
  return {
    class: profile.class as PlayerClass,
    role: targetRole,
    level: parseInt(profile.level || '1', 10),
    experience: parseInt(profile.experience || '0', 10),
  };
}

async function mockDebugRefillEnergy(
  store: RedisStore,
  userId: string,
  dateString: string
): Promise<{ remainingAp: number; totalAp: number }> {
  const apKey = `player:ap:${userId}:${dateString}`;
  store.strings[apKey] = '20';
  return { remainingAp: 20, totalAp: 20 };
}

async function mockDebugFullReset(
  store: RedisStore,
  userId: string,
  postId: string,
  dateString: string
): Promise<{ profile: null; map: string; remainingAp: number; totalAp: number }> {
  const profileKey = `player:profile:${userId}`;
  const apKey = `player:ap:${userId}:${dateString}`;
  const mapKey = getMapKey(postId);

  delete store.hashes[profileKey];
  delete store.strings[apKey];
  store.strings[mapKey] = createDefaultMap();

  return {
    profile: null,
    map: store.strings[mapKey]!,
    remainingAp: 20,
    totalAp: 20,
  };
}

// ---------------------------------------------------------------------------
// Milestone 3 Test Scopes
// ---------------------------------------------------------------------------

describe('Milestone 3 - Player Profiles, Roles, and Daily Energy Authorization Boundaries', () => {
  const dateStr = '2026-06-28';

  describe('profile initialization & onboarding schema mapping', () => {
    it('sets profile values and initializes daily AP token for a Defender', async () => {
      const store = createMockRedisStore();
      const userId = 'defender_user_1';

      const profile = await mockInitializeProfile(store, userId, 'Sorcerer', 'Defender', dateStr);

      expect(profile).toEqual({
        class: 'Sorcerer',
        role: 'Defender',
        level: 1,
        experience: 0,
      });

      const dbProfile = store.hashes[`player:profile:${userId}`];
      expect(dbProfile).toBeDefined();
      expect(dbProfile!.class).toBe('Sorcerer');
      expect(dbProfile!.role).toBe('Defender');
      expect(dbProfile!.level).toBe('1');

      const apVal = store.strings[`player:ap:${userId}:${dateStr}`];
      expect(apVal).toBe('20');
    });

    it('sets profile values and blocks mutation energy initialization for an Attacker', async () => {
      const store = createMockRedisStore();
      const userId = 'attacker_user_1';

      const profile = await mockInitializeProfile(store, userId, 'Barbarian', 'Attacker', dateStr);
      expect(profile.role).toBe('Attacker');

      const apVal = store.strings[`player:ap:${userId}:${dateStr}`];
      expect(apVal).toBe('0');
    });
  });

  describe('energy query procedure', () => {
    it('returns initialized energy counts for Defender profiles', async () => {
      const store = createMockRedisStore();
      const userId = 'defender_user_2';
      await mockInitializeProfile(store, userId, 'Rogue', 'Defender', dateStr);

      const energy = await mockGetRemainingEnergy(store, userId, dateStr);
      expect(energy).toEqual({ remainingAp: 20, totalAp: 20 });
    });

    it('returns 0 energy for non-Defender (Attacker) profiles', async () => {
      const store = createMockRedisStore();
      const userId = 'attacker_user_2';
      await mockInitializeProfile(store, userId, 'Barbarian', 'Attacker', dateStr);

      const energy = await mockGetRemainingEnergy(store, userId, dateStr);
      expect(energy).toEqual({ remainingAp: 0, totalAp: 0 });
    });
  });

  describe('role boundaries and action authorization', () => {
    it('forcefully blocks Attackers from executing tile mutations', async () => {
      const store = createMockRedisStore();
      const userId = 'attacker_user_3';
      const postId = 'post_123';

      await mockInitializeProfile(store, userId, 'Barbarian', 'Attacker', dateStr);

      await expect(
        mockMutateTile(store, postId, userId, dateStr, { x: 5, y: 5, state: 1 })
      ).rejects.toThrow('UNAUTHORIZED_ROLE');
    });

    it('verifies Defender profile successfully decrements AP step-by-step upon mutations', async () => {
      const store = createMockRedisStore();
      const userId = 'defender_user_3';
      const postId = 'post_123';

      await mockInitializeProfile(store, userId, 'Rogue', 'Defender', dateStr);

      // Perform 3 mutations and verify AP decrements
      await mockMutateTile(store, postId, userId, dateStr, { x: 0, y: 0, state: 2 });
      let energy = await mockGetRemainingEnergy(store, userId, dateStr);
      expect(energy.remainingAp).toBe(19);

      await mockMutateTile(store, postId, userId, dateStr, { x: 1, y: 0, state: 1 });
      await mockMutateTile(store, postId, userId, dateStr, { x: 2, y: 0, state: 1 });
      energy = await mockGetRemainingEnergy(store, userId, dateStr);
      expect(energy.remainingAp).toBe(17);
    });

    it('blocks mutations with OUT_OF_ENERGY the moment ledger balance hits zero', async () => {
      const store = createMockRedisStore();
      const userId = 'defender_user_4';
      const postId = 'post_123';

      await mockInitializeProfile(store, userId, 'Sorcerer', 'Defender', dateStr);
      
      // Force AP count down to 1
      store.strings[`player:ap:${userId}:${dateStr}`] = '1';

      // Spend last AP
      await mockMutateTile(store, postId, userId, dateStr, { x: 0, y: 0, state: 2 });
      
      const energy = await mockGetRemainingEnergy(store, userId, dateStr);
      expect(energy.remainingAp).toBe(0);

      // Attempt another mutation
      await expect(
        mockMutateTile(store, postId, userId, dateStr, { x: 1, y: 0, state: 1 })
      ).rejects.toThrow('OUT_OF_ENERGY');
    });

    it('validates that debug_refillEnergy overrides zero balance restrictions', async () => {
      const store = createMockRedisStore();
      const userId = 'defender_user_5';
      const postId = 'post_123';

      await mockInitializeProfile(store, userId, 'Sorcerer', 'Defender', dateStr);
      store.strings[`player:ap:${userId}:${dateStr}`] = '0';

      // Verify blocked at first
      await expect(
        mockMutateTile(store, postId, userId, dateStr, { x: 1, y: 0, state: 1 })
      ).rejects.toThrow('OUT_OF_ENERGY');

      // Refill energy
      await mockDebugRefillEnergy(store, userId, dateStr);

      // Verify now succeeds
      const res = await mockMutateTile(store, postId, userId, dateStr, { x: 1, y: 0, state: 1 });
      expect(res).toEqual({ x: 1, y: 0, state: 1 });

      const energy = await mockGetRemainingEnergy(store, userId, dateStr);
      expect(energy.remainingAp).toBe(19);
    });

    it('validates that debug_setPlayerRole dynamically switches role and affects energy/validation', async () => {
      const store = createMockRedisStore();
      const userId = 'user_switch_1';
      const postId = 'post_123';

      // Start as Attacker
      await mockInitializeProfile(store, userId, 'Barbarian', 'Attacker', dateStr);

      // Verify tile mutation is blocked
      await expect(
        mockMutateTile(store, postId, userId, dateStr, { x: 1, y: 0, state: 1 })
      ).rejects.toThrow('UNAUTHORIZED_ROLE');

      // Switch to Defender
      await mockDebugSetPlayerRole(store, userId, 'Defender', dateStr);

      // Verify mutation now succeeds
      const res = await mockMutateTile(store, postId, userId, dateStr, { x: 1, y: 0, state: 1 });
      expect(res).toEqual({ x: 1, y: 0, state: 1 });
    });

    it('validates that debug_fullReset clears profile and deletes AP and resets grid map', async () => {
      const store = createMockRedisStore();
      const userId = 'user_reset_1';
      const postId = 'post_123';

      // Set profile, AP, and map
      await mockInitializeProfile(store, userId, 'Barbarian', 'Defender', dateStr);
      await mockMutateTile(store, postId, userId, dateStr, { x: 0, y: 0, state: 2 });

      const mapValBefore = store.strings[getMapKey(postId)];
      expect(mapValBefore).not.toBe(createDefaultMap());

      // Trigger full reset
      const res = await mockDebugFullReset(store, userId, postId, dateStr);
      expect(res.profile).toBeNull();
      expect(res.map).toBe(createDefaultMap());

      // Profile should be deleted
      expect(store.hashes[`player:profile:${userId}`]).toBeUndefined();
      expect(store.strings[`player:ap:${userId}:${dateStr}`]).toBeUndefined();
      expect(store.strings[getMapKey(postId)]).toBe(createDefaultMap());
    });
  });
});
