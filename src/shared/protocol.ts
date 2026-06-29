/**
 * Protocol types for SiegeTheThread Milestone 2.
 *
 * With tRPC as the transport, these types serve as the canonical contract for
 * the map data model. The tRPC router input/output types align with these
 * definitions.
 */

// ---------------------------------------------------------------------------
// Client → Server (tRPC inputs)
// ---------------------------------------------------------------------------

export type FetchMapRequest = {
  type: 'FETCH_MAP_REQUEST';
};

export type TileMutationRequest = {
  type: 'TILE_MUTATION_REQUEST';
  x: number;
  y: number;
  state: number;
};

export type TileBatchMutationRequest = {
  type: 'TILE_BATCH_MUTATION_REQUEST';
  mutations: Array<{
    x: number;
    y: number;
    state: number;
  }>;
};

// Profile types
export type PlayerClass = 'Barbarian' | 'Sorcerer' | 'Rogue';
export type PlayerRole = 'Attacker' | 'Defender';

export type PlayerProfile = {
  class: PlayerClass;
  role: PlayerRole;
  level: number;
  xp: number;
};

export type ProfileStatusResponse = {
  hasProfile: boolean;
  profile: PlayerProfile | null;
  remainingAp: number;
  totalAp: number;
};

export function getProfileKey(userId: string): string {
  return `player:profile:${userId}`;
}

export function getApKey(userId: string, postId: string): string {
  return `player:ap:${userId}:${postId}`;
}

export type InitializeProfileRequest = {
  chosenClass: PlayerClass;
  chosenRole: PlayerRole;
};

export type EnergyResponse = {
  remainingAp: number;
  totalAp: number;
};

export type DebugSetPlayerRoleRequest = {
  targetRole: PlayerRole;
};

export type MatchmakerSimulationResponse = {
  path: [number, number][];
  success: boolean;
};

export type DebugFullResetResponse = {
  profile: null;
  map: string;
  remainingAp: number;
  totalAp: number;
};

// ---------------------------------------------------------------------------
// Server → Client (tRPC outputs)
// ---------------------------------------------------------------------------

export type FetchMapResponse = {
  type: 'FETCH_MAP_RESPONSE';
  map: string;
};

export type TileMutationSuccess = {
  type: 'TILE_MUTATION_SUCCESS';
  x: number;
  y: number;
  state: number;
};

export type TileMutationError = {
  type: 'TILE_MUTATION_ERROR';
  x: number;
  y: number;
  /** Original state before the failed mutation attempt */
  previousState: number;
  reason: string;
};

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type ClientToServerMessage = FetchMapRequest | TileMutationRequest | TileBatchMutationRequest;

export type ServerToClientMessage =
  | FetchMapResponse
  | TileMutationSuccess
  | TileMutationError;

