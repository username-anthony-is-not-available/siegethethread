/**
 * Shared API response types for SiegeTheThread.
 * These represent the tRPC procedure output shapes shared between client and server.
 */

import type { PlayerProfile, EnergyResponse, MatchmakerSimulationResponse, DebugFullResetResponse } from './protocol';

export type GetMapResponse = {
  map: string;
};

export type MutateTileResponse = {
  x: number;
  y: number;
  state: number;
};

export type GetPlayerProfileResponse = PlayerProfile | null;

export type GetRemainingEnergyResponse = EnergyResponse;

export type DebugSetPlayerRoleResponse = PlayerProfile;

export type DebugRefillEnergyResponse = EnergyResponse;

export type DebugTriggerMatchmakerSimulationResponse = MatchmakerSimulationResponse;

export type DebugFullResetResponseResponse = DebugFullResetResponse;



