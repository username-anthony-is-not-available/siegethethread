import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { context, redis } from '@devvit/web/server';
import {
  applyMutation,
  createDefaultMap,
  getMapKey,
  TOTAL_TILES,
} from './utils/mapStore';
import {
  getProfileKey,
  getApKey,
  type PlayerProfile,
  type PlayerClass,
  type PlayerRole,
  type ProfileStatusResponse,
} from '../shared/protocol';

const t = initTRPC.create();

const MAX_RETRY_ATTEMPTS = 5;

export const appRouter = t.router({
  /**
   * getProfileStatus: check profile and remaining energy.
   */
  getProfileStatus: t.procedure.query(async (): Promise<ProfileStatusResponse> => {
    const { userId, postId } = context;
    if (!userId) {
      return { hasProfile: false, profile: null, remainingAp: 0, totalAp: 20 };
    }

    const profileKey = getProfileKey(userId);
    const profile = await redis.hGetAll(profileKey);
    if (!profile || Object.keys(profile).length === 0) {
      return { hasProfile: false, profile: null, remainingAp: 0, totalAp: 20 };
    }

    const apKey = getApKey(userId, postId || 'default_post');
    const rawAp = await redis.get(apKey);
    const remainingAp = rawAp !== undefined && rawAp !== null ? parseInt(rawAp, 10) : 20;

    return {
      hasProfile: true,
      profile: {
        class: profile.class as PlayerClass,
        role: profile.role as PlayerRole,
        level: parseInt(profile.level || '1', 10),
        xp: parseInt(profile.xp || '0', 10),
      },
      remainingAp,
      totalAp: 20,
    };
  }),

  /**
   * Fetches the player profile from Redis under the player:profile:${userId} key.
   */
  getPlayerProfile: t.procedure.query(async (): Promise<PlayerProfile | null> => {
    const { userId } = context;
    if (!userId) {
      return null;
    }

    const key = getProfileKey(userId);
    const profile = await redis.hGetAll(key);
    if (!profile || Object.keys(profile).length === 0) {
      return null;
    }

    return {
      class: profile.class as PlayerClass,
      role: profile.role as PlayerRole,
      level: parseInt(profile.level || '1', 10),
      xp: parseInt(profile.xp || '0', 10),
    };
  }),

  /**
   * Initializes the player profile in Redis and sets the daily AP to 20 if role is Defender.
   */
  initializeProfile: t.procedure
    .input(
      z.object({
        chosenClass: z.enum(['Barbarian', 'Sorcerer', 'Rogue']),
        chosenRole: z.enum(['Attacker', 'Defender']),
      })
    )
    .mutation(async ({ input }): Promise<PlayerProfile> => {
      const { userId, postId } = context;
      if (!userId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User is not logged in',
        });
      }

      const profileKey = getProfileKey(userId);
      const apKey = getApKey(userId, postId || 'default_post');

      const profileData: Record<string, string> = {
        class: input.chosenClass,
        role: input.chosenRole,
        level: '1',
        xp: '0',
      };

      await redis.hSet(profileKey, profileData);

      if (input.chosenRole === 'Defender') {
        await redis.set(apKey, '20');
      } else {
        // Attackers don't get Defender AP
        await redis.set(apKey, '0');
      }

      return {
        class: input.chosenClass,
        role: input.chosenRole,
        level: 1,
        xp: 0,
      };
    }),

  /**
   * Returns current user's AP status for the calendar day.
   */
  getRemainingEnergy: t.procedure.query(async (): Promise<{ remainingAp: number; totalAp: number }> => {
    const { userId, postId } = context;
    if (!userId) {
      return { remainingAp: 0, totalAp: 0 };
    }

    // First fetch profile to see if they are a defender
    const profileKey = getProfileKey(userId);
    const profile = await redis.hGetAll(profileKey);
    const isDefender = profile && profile.role === 'Defender';

    if (!isDefender) {
      return { remainingAp: 0, totalAp: 0 };
    }

    const apKey = getApKey(userId, postId || 'default_post');
    const rawAp = await redis.get(apKey);
    if (rawAp === undefined || rawAp === null) {
      // Initialize to 20 if profile exists but AP key not initialized yet for today
      await redis.set(apKey, '20');
      return { remainingAp: 20, totalAp: 20 };
    }

    return {
      remainingAp: parseInt(rawAp, 10),
      totalAp: 20,
    };
  }),

  /**
   * Fetches the current 256-character map layout from Redis.
   * If no map exists for this post yet, seeds it with all-wall ('0') default
   * and persists it before returning.
   */
  getMap: t.procedure.query(async (): Promise<{ map: string }> => {
    const { postId } = context;

    if (!postId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'postId is required but missing from context',
      });
    }

    const key = getMapKey(postId);
    const existing = await redis.get(key);

    if (existing && existing.length === TOTAL_TILES) {
      console.log(`[tRPC] getMap: returning ${TOTAL_TILES}-char map for post ${postId}`);
      return { map: existing };
    }

    // First load — seed the key with a fully-walled default map
    const defaultMap = createDefaultMap();
    await redis.set(key, defaultMap);
    console.log(`[tRPC] getMap: initialized default map for post ${postId}`);
    return { map: defaultMap };
  }),

  /**
   * Atomically mutates a single tile at (x, y) to the given state.
   * Uses Redis WATCH/MULTI/EXEC transactions to prevent lost updates
   * from concurrent mutations. Retries on WATCH conflicts.
   */
  mutateTile: t.procedure
    .input(
      z.object({
        x: z.number().int().min(0).max(15),
        y: z.number().int().min(0).max(15),
        state: z.number().int().min(0).max(1),
      })
    )
    .mutation(
      async ({
        input,
      }: {
        input: { x: number; y: number; state: number };
      }): Promise<{ x: number; y: number; state: number }> => {
        const { postId, userId } = context;

        if (!postId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'postId is required but missing from context',
          });
        }

        if (!userId) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'User is not logged in',
          });
        }

        // Retrieve player profile
        const profileKey = getProfileKey(userId);
        const profile = await redis.hGetAll(profileKey);
        if (!profile || Object.keys(profile).length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Player profile is not initialized',
          });
        }

        // Verify player is Defender
        if (profile.role !== 'Defender') {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Only Defenders can mutate the board grid',
          });
        }

        // Check Action Points energy availability
        const apKey = getApKey(userId, postId);
        const rawAp = await redis.get(apKey);
        const ap = rawAp !== undefined && rawAp !== null ? parseInt(rawAp, 10) : 20;

        if (ap <= 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'OUT_OF_ENERGY',
          });
        }

        const key = getMapKey(postId);
        const { x, y, state } = input;

        // Retry loop for optimistic locking
        for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
          // WATCH both keys
          const txn = await redis.watch(key, apKey);
          
          // Re-fetch energy within watch transaction scope
          const watchApRaw = await redis.get(apKey);
          const watchAp = watchApRaw !== undefined && watchApRaw !== null ? parseInt(watchApRaw, 10) : 20;
          if (watchAp <= 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'OUT_OF_ENERGY',
            });
          }

          const currentMap = await redis.get(key);

          // Handle missing map - initialize and retry
          if (!currentMap || currentMap.length !== TOTAL_TILES) {
            await redis.set(key, createDefaultMap());
            console.log(`[tRPC] mutateTile: initialized map on attempt ${attempt + 1}`);
            continue;
          }

          // Apply the mutation to compute the new map
          const mutationPayload = {
            type: 'TILE_MUTATION_REQUEST' as const,
            x,
            y,
            state,
          };

          const result = applyMutation(currentMap, mutationPayload);

          if (!result.success || !result.newMap) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: result.error ?? 'Mutation rejected by server',
            });
          }

          // Queue the commands in transaction
          await txn.multi();
          await txn.set(key, result.newMap);
          await txn.set(apKey, String(watchAp - 1));

          // Execute transaction
          let execResult;
          try {
            execResult = await txn.exec();
          } catch (error) {
            console.log(
              `[tRPC] mutateTile: transaction aborted at (${x}, ${y}), retrying (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`,
            );
            continue;
          }

          if (!execResult || (Array.isArray(execResult) && execResult.length === 0)) {
            console.log(
              `[tRPC] mutateTile: WATCH conflict detected at (${x}, ${y}), retrying (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`,
            );
            continue;
          }

          // Transaction succeeded
          console.log(`[tRPC] mutateTile: committed (${x}, ${y}) → ${state} for post ${postId}`);
          return { x, y, state };
        }

        // Exhausted retries
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Unable to complete mutation due to concurrent updates, please retry',
        });
      }
    ),

  /**
   * debug_setPlayerRole - Dev-only mutation to change role.
   */
  debug_setPlayerRole: t.procedure
    .input(z.object({ targetRole: z.enum(['Attacker', 'Defender']) }))
    .mutation(async ({ input }): Promise<PlayerProfile> => {
      const { userId, postId } = context;
      if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User is not logged in' });
      }
      const profileKey = getProfileKey(userId);
      const apKey = getApKey(userId, postId || 'default_post');

      const profile = await redis.hGetAll(profileKey);
      if (!profile || Object.keys(profile).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Player profile is not initialized' });
      }

      await redis.hSet(profileKey, { role: input.targetRole });
      if (input.targetRole === 'Defender') {
        await redis.set(apKey, '20');
      } else {
        await redis.set(apKey, '0');
      }

      return {
        class: profile.class as PlayerClass,
        role: input.targetRole,
        level: parseInt(profile.level || '1', 10),
        xp: parseInt(profile.xp || '0', 10),
      };
    }),

  /**
   * debug_refillEnergy - Dev-only mutation resetting AP to 20.
   */
  debug_refillEnergy: t.procedure.mutation(async (): Promise<{ remainingAp: number; totalAp: number }> => {
    const { userId, postId } = context;
    if (!userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User is not logged in' });
    }
    const apKey = getApKey(userId, postId || 'default_post');
    await redis.set(apKey, '20');
    return { remainingAp: 20, totalAp: 20 };
  }),

  /**
   * debug_triggerMatchmakerSimulation - Runs pathfinding from (0,0) to (15,15) on the active map.
   */
  debug_triggerMatchmakerSimulation: t.procedure.mutation(async (): Promise<{
    victory: 'Attacker' | 'Defender';
    frames: Array<{
      tick: number;
      swarms: Array<{ x: number; y: number; count: number }>;
    }>;
    success: boolean;
  }> => {
    const { postId } = context;
    if (!postId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'postId is required' });
    }
    const mapKey = getMapKey(postId);
    let mapString = await redis.get(mapKey);
    if (!mapString || mapString.length !== TOTAL_TILES) {
      mapString = createDefaultMap();
      await redis.set(mapKey, mapString);
    }

    const { runSwarmSimulation } = await import('./utils/simulation');
    const simResult = runSwarmSimulation(mapString, true);

    // Store replay JSON object in Redis under dungeon:replay:${postId}
    const replayKey = `dungeon:replay:${postId}`;
    await redis.set(replayKey, JSON.stringify({
      victory: simResult.victory,
      frames: simResult.frames,
    }));

    return {
      victory: simResult.victory,
      frames: simResult.frames,
      success: simResult.victory === 'Attacker',
    };
  }),

  /**
   * debug_fullReset - Dev-only mutation to delete player profile, delete AP energy, and reset map to all-walls ('0').
   */
  debug_fullReset: t.procedure.mutation(async (): Promise<{ profile: null; map: string; remainingAp: number; totalAp: number }> => {
    const { userId, postId } = context;
    if (!userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User is not logged in' });
    }
    const profileKey = getProfileKey(userId);
    const apKey = getApKey(userId, postId || 'default_post');

    // Delete player profile and daily AP
    await redis.del(profileKey);
    await redis.del(apKey);

    // Reset map if postId exists
    const defaultMap = createDefaultMap();
    if (postId) {
      const mapKey = getMapKey(postId);
      await redis.set(mapKey, defaultMap);
    }

    return {
      profile: null,
      map: defaultMap,
      remainingAp: 20,
      totalAp: 20,
    };
  }),
});

export type AppRouter = typeof appRouter;
