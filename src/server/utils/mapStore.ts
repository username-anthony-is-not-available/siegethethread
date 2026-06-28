import type { TileMutationRequest } from '../../shared/protocol';

export const MAP_KEY_PREFIX = 'dungeon:layout';
export const GRID_SIZE = 16;
export const TOTAL_TILES = GRID_SIZE * GRID_SIZE;

export function getMapKey(postId: string): string {
  return `${MAP_KEY_PREFIX}:${postId}`;
}

export function createDefaultMap(): string {
  return '0'.repeat(TOTAL_TILES);
}

export function applyMutation(
  currentMap: string,
  mutation: TileMutationRequest
): { success: boolean; newMap?: string; error?: string } {
  const { x, y, state } = mutation;

  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
    return { success: false, error: 'OUT_OF_BOUNDS' };
  }

  if (state !== 0 && state !== 1) {
    return { success: false, error: 'INVALID_STATE' };
  }

  if (currentMap.length !== TOTAL_TILES) {
    return { success: false, error: 'CORRUPT_MAP' };
  }

  const index = y * GRID_SIZE + x;
  const chars = currentMap.split('');
  chars[index] = String(state);
  const newMap = chars.join('');

  return { success: true, newMap };
}
