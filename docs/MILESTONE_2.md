# Milestone 2 — Network Bridge & Persistent State Synchronization

Milestone 2 bridges the client-side Phaser canvas with the server-side Devvit
API and Redis Key-Value store. The map layout is persistent, shared across all
players in a post, and mutated through coordinate-specific transactional tRPC
procedure calls rather than full-grid overwrites.

---

## 1. Data Serialization Specification

### 1.1 Flat String Layout

Inside Devvit Redis, the 16×16 grid is stored as a **256-character flat string**
under the key `dungeon:layout:{postId}`. Each character is either `'0'` (raw
unexcavated stone wall) or `'1'` (excavated pathway).

| Property | Value |
|----------|-------|
| Key schema | `dungeon:layout:{postId}` |
| Value length | `256` characters |
| Character domain | `'0'` (wall) or `'1'` (path) |
| Encoding | ASCII, no delimiters |

### 1.2 Index Transformation Logic

Coordinate-to-index mapping uses **row-major** order:

```
index = y * GRID_SIZE + x
```

Where `GRID_SIZE = 16`, `y` = row (vertical, 0 = top), `x` = col (horizontal, 0 = left).

**Concrete examples:**

| `(y, x)` | Calculation | Index |
|----------|-------------|-------|
| `(0, 0)` | `0 * 16 + 0` | `0` |
| `(0, 5)` | `0 * 16 + 5` | `5` |
| `(4, 5)` | `4 * 16 + 5` | `69` |
| `(8, 8)` | `8 * 16 + 8` | `136` |
| `(15, 15)` | `15 * 16 + 15` | `255` |

### 1.3 Default Initialization

When a post is first loaded and no `dungeon:layout:{postId}` key exists (or the
stored value is not exactly 256 characters), the `getMap` tRPC procedure
automatically seeds the key with `'0'.repeat(256)` — a fully walled matrix.

---

## 2. Network Protocol — tRPC Procedures

All client↔server communication uses **tRPC v11** over HTTP, mounted at `/trpc/*`
via Hono's `fetchRequestHandler`. There are no `window.postMessage` calls.

### Architecture Overview

```
Client (Phaser iframe)
    │
    │  trpc.getMap.query()
    │  trpc.mutateTile.mutate({ x, y, state })
    │
    ▼  HTTP POST /trpc/getMap   (batch stream link)
       HTTP POST /trpc/mutateTile
    │
    ▼  Hono fetchRequestHandler(/trpc/*)
    │
    ▼  tRPC Router (src/server/trpc.ts)
    │
    ▼  mapStore.ts → Redis
```

### 2.1 `getMap` — Query Procedure

Fetches the current map from Redis. If no key exists for the post, seeds and
returns the default all-wall map.

**Client call:**
```typescript
const result = await trpc.getMap.query();
// result: { map: string }  — exactly 256 chars of '0' or '1'
```

**Server implementation summary:**
1. Reads `context.postId` from Devvit context
2. Calls `redis.get('dungeon:layout:{postId}')`
3. If missing or wrong length → `redis.set(key, '0'.repeat(256))` → returns default
4. Otherwise returns stored string

**Output shape:**
```typescript
type GetMapOutput = {
  map: string; // 256 characters
};
```

**Zod input schema:** none (no inputs, it's a query)

### 2.2 `mutateTile` — Mutation Procedure

Atomically mutates a single tile at `(x, y)` to the desired `state`.

**Client call:**
```typescript
const result = await trpc.mutateTile.mutate({ x: 5, y: 4, state: 1 });
// result: { x: number, y: number, state: number }
```

**Zod input schema (server-enforced):**
```typescript
z.object({
  x: z.number().int().min(0).max(15),
  y: z.number().int().min(0).max(15),
  state: z.number().int().min(0).max(1),
})
```

**Server implementation summary:**
1. Zod validates `x`, `y`, `state` — rejects with `BAD_REQUEST` on invalid input
2. Reads `context.postId` from Devvit context
3. Fetches current map string from Redis
4. If map is corrupt/missing → reinitializes and throws `INTERNAL_SERVER_ERROR`
5. Calls `applyMutation(currentMap, { x, y, state })` from `mapStore.ts`
6. Writes new string to Redis atomically
7. Returns `{ x, y, state }` on success

**Output shape:**
```typescript
type MutateTileOutput = {
  x: number;
  y: number;
  state: number; // the committed state
};
```

### 2.3 Error Handling

All errors are thrown as `TRPCError` and received on the client as rejected
promises. The client catches them via `.catch()` and reverts the tile visually.

| tRPC Error Code | Cause |
|-----------------|-------|
| `BAD_REQUEST` | Missing `postId`, or Zod schema mismatch (invalid coords/state) |
| `INTERNAL_SERVER_ERROR` | Map string was corrupt/missing — reinitialized and request aborted |

### 2.4 Validation Contract

1. **Zod schema**: `x` and `y` are `int().min(0).max(15)`. `state` is `int().min(0).max(1)`.
   Violations are rejected before any Redis access.
2. **Secondary validation**: `applyMutation` in `mapStore.ts` re-checks bounds,
   state validity, and map integrity as a defense-in-depth layer.
3. **Atomicity**: Only the single target index is updated. The other 255 characters
   are preserved via string split/join — no partial writes.

---

## 3. Client-Side Lifecycle

### 3.1 Deferred Rendering

`GameScene` does NOT render the grid during `create()`. Instead:

1. `init()` seeds an empty grid container and sets `isMapLoaded = false`.
2. `create()` builds the overlay labels, shows a `"Loading map…"` status, and
   calls `fetchInitialMap()`.
3. `fetchInitialMap()` calls `trpc.getMap.query()` asynchronously.
4. On success: `parseMapString()` converts the 256-char string to a 2D `Grid`,
   `buildGrid()` renders all 256 `Rectangle` GameObjects, status label is hidden.
5. On error: status label updates to `"Failed to load map. Tap to retry."` and a
   retry handler is registered on the next `pointerdown`.
6. Tile tap interaction is **blocked** (`isMapLoaded` guard) until loading completes.

### 3.2 Tile Click Flow

When a player taps a tile:

1. Guard: tile not in `pendingMutations` set and `isMapLoaded === true`.
2. Compute `desiredState = currentState === TILE_WALL ? TILE_PATH : TILE_WALL`.
3. **Optimistic update**: local `this.grid[row][col] = desiredState`, counter refreshes.
4. Tile enters **pending** visual: fill `PENDING_COLOR` (`0xffd166`) at 50% opacity,
   repeating sine-wave alpha tween.
5. `trpc.mutateTile.mutate({ x: col, y: row, state: desiredState })` is called.
6. Coordinate added to `pendingMutations` to prevent duplicate requests.

**On success** (`result: { x, y, state }`):
1. Pending tween killed, alpha reset to `1.0`.
2. Fill color updated to `WALL_COLOR` or `PATH_COLOR`.
3. `this.grid` confirmed with committed state, counter refreshes.
4. Coordinate removed from `pendingMutations`.

**On failure** (network error, server rejection):
1. Optimistic local update **reverted** (`this.grid[row][col] = originalState`).
2. Tile flashes `ERROR_COLOR` (`0xef233c`) via a short blink tween, then restores original color.
3. Coordinate removed from `pendingMutations`.

### 3.3 No `window.postMessage`

No `window.addEventListener('message')` or `window.parent.postMessage()` calls
exist in the client. All communication goes through `trpc.*` procedure calls
over HTTP.

---

## 4. Developer Integration Instructions

### 4.1 Audit State Mutations via Console

Open browser DevTools while the game is running. The Devvit server logs every
significant event:

```
[tRPC] getMap: initialized default map for post t3_abc123
[tRPC] getMap: returning 256-char map for post t3_abc123
[tRPC] mutateTile: committed (5, 4) → 1 for post t3_abc123
[tRPC] mutateTile: map corrupt or missing for post t3_abc123, reinitializing
[tRPC] Error on procedure 'mutateTile': ...
```

To trace the full lifecycle of a specific tile:

1. **Client init**: `fetchInitialMap()` runs. Console shows "Loading map…" status.
   Server logs `getMap: returning 256-char map` (or `initialized default map`).

2. **Tile tap**: Client shows golden pulse. Server receives mutation via tRPC HTTP.
   Server logs `mutateTile: committed (x, y) → state`.

3. **Success**: Tile finalizes to PATH or WALL color. Counter updates.

4. **Failure**: Tile flashes red. Optimistic update is reverted. Check server logs
   for the specific `TRPCError` code and message.

5. **Redis verification** (local environment):
   ```typescript
   const raw = await redis.get('dungeon:layout:{postId}');
   console.log(raw); // 256-char string
   console.log(raw?.split('').filter(c => c === '1').length); // path count
   ```

### 4.2 Local Development Workflow

```bash
# Run unit tests (Milestone 1 grid model + Milestone 2 mutation logic)
npm run test

# Run only Milestone 2 tests
npm run test -- milestone2

# Type-check all packages
npm run type-check

# Lint source files
npm run lint

# Build production bundles (client + server)
npm run build

# Start devvit playtest with hot-reload
npm run dev
```

### 4.3 Simulating Multi-Player Mutations

To test concurrent writes locally:

1. Open the Reddit post in two browser tabs (or one incognito window).
2. Tap the same tile `(x, y)` in both tabs simultaneously.
3. The last write to Redis wins. Both tabs will converge to the same final state
   on their next interaction (the `getMap` query on load gives each new player
   the current persisted state).
4. There is **no optimistic locking** in Milestone 2. Conflict resolution is
   last-write-wins, acceptable for a dungeon-crafting tool.

### 4.4 Key Files Reference

| File | Responsibility |
|------|----------------|
| `src/shared/protocol.ts` | TypeScript types for message contracts and error types |
| `src/shared/grid.ts` | Pure grid model, bounds checking, path counting |
| `src/server/utils/mapStore.ts` | Index math, default map generation, atomic `applyMutation` |
| `src/server/trpc.ts` | tRPC router: `getMap` query + `mutateTile` mutation |
| `src/server/index.ts` | Hono app, tRPC `fetchRequestHandler` mount at `/trpc/*` |
| `src/client/trpc.ts` | Typed `createTRPCProxyClient` with `httpBatchStreamLink` |
| `src/client/scenes/GameScene.ts` | Phaser scene, deferred rendering, pending state, error recovery |
| `tests/milestone2.test.ts` | Unit tests: mutation atomicity, boundary rejection, tRPC procedure simulation |

---

## 5. Milestone Constraints Checklist

- [x] Re-render synchronization: client fetches state before rendering grid
- [x] Atomic state mutations: coordinate-specific `mutateTile` only, no full-grid writes
- [x] Data compression: 256-char flat string under `dungeon:layout:{postId}`
- [x] tRPC v11 end-to-end type safety (no `window.postMessage`)
- [x] Zod input validation on all mutation inputs
- [x] Client optimistic updates with server-confirmed finalization
- [x] Error recovery: failed mutations revert to original state with visual feedback
- [x] Loading state: grid deferred until server responds
- [x] All colors use `0x` hex format
- [x] Zero `todo` placeholders or incomplete stubs
