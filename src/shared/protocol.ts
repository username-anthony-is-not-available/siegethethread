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

export type ClientToServerMessage = FetchMapRequest | TileMutationRequest;

export type ServerToClientMessage =
  | FetchMapResponse
  | TileMutationSuccess
  | TileMutationError;
