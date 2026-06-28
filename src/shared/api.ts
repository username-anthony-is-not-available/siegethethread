/**
 * Shared API response types for SiegeTheThread.
 * These represent the tRPC procedure output shapes shared between client and server.
 */

export type GetMapResponse = {
  map: string;
};

export type MutateTileResponse = {
  x: number;
  y: number;
  state: number;
};
