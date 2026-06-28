import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { context, redis } from '@devvit/web/server';
import {
  applyMutation,
  createDefaultMap,
  getMapKey,
  TOTAL_TILES,
} from './utils/mapStore';

const t = initTRPC.create();

/**
 * Maximum number of transaction retry attempts before giving up.
 * Prevents infinite loops under high contention.
 */
const MAX_RETRY_ATTEMPTS = 5;

export const appRouter = t.router({
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
        const { postId } = context;

        if (!postId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'postId is required but missing from context',
          });
        }

        const key = getMapKey(postId);
        const { x, y, state } = input;

        // Retry loop for optimistic locking
        for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
          // WATCH the key first - this monitors for changes after this point
          const txn = await redis.watch(key);
          // Read current map value using redis.get() directly (not txn.get()) because we need the actual value
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
            // Don't retry for validation errors - they're client-side issues
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: result.error ?? 'Mutation rejected by server',
            });
          }

          // Queue the SET command in the transaction
          await txn.multi();
          await txn.set(key, result.newMap);

          // Execute transaction - may throw or return null/empty on WATCH conflict
          let execResult;
          try {
            execResult = await txn.exec();
          } catch (error) {
            // Transaction was aborted due to WATCH conflict
            console.log(
              `[tRPC] mutateTile: transaction aborted at (${x}, ${y}), retrying (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`,
            );
            continue;
          }

          // exec returns null or empty array when watched key was modified (conflict)
          // Also treat empty array as conflict (defensive check)
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

        // Exhausted retries - give up with conflict error
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Unable to complete mutation due to concurrent updates, please retry',
        });
      }
    ),
});

export type AppRouter = typeof appRouter;
