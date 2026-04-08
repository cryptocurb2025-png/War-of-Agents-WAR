# Tech Stack

## Runtime and language

- Node.js (ES modules)
- Vanilla JavaScript (no framework lock-in)

## Frontend

- HTML + CSS + Canvas 2D
- WebSocket client for real-time state
- Lightweight pixel-sprite rendering via SVG assets

Why this stack:

- low overhead
- easy deployment
- consistent frame pacing on normal hardware

## Backend

- Single Node process (`spectatorServer.js`)
- Authoritative simulation tick loop
- In-memory round state
- REST endpoints + WebSocket stream

Core modules:

- `CombatEngine.js` - lane combat, damage, tower/base pressure
- `GameState.js` - state assembly and serialization
- `Agent.js` - hero class templates and stat operations
- `Unit.js` - creep and archetype unit definitions
- `Lane.js` / `Tower.js` / `Stronghold.js` - structure and lane rules

## Data model

Current mode is stateless across restarts (in-memory only):

- round config + win counters in memory
- predictions stored in memory
- no database in this phase

This is intentional for rapid gameplay iteration.

## Performance profile

- simulation: ~10 ticks/sec default
- broadcast: ~10 updates/sec default
- rendering: canvas with capped UI update cadence
- assets: small SVG sprites (crisp pixels, low transfer size)

## Production path (next)

Planned upgrades for full live service:

1. persistent DB for profiles, match history, and token balances
2. auth/session layer
3. horizontal game instance orchestration
4. optional asset atlas pipeline for larger art sets
