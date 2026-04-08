# API Reference (Current Local Build)

Base URL (local): `http://localhost:3000`

The current implementation is a local Fight Club server with REST + WebSocket spectator APIs.

## GET /api/state

Returns full simulation state used by the frontend.

Includes:

- game metadata (`gameId`, `tick`, `phase`)
- lanes + units + heroes
- towers and strongholds
- recent combat events
- winner status
- `fightClub` summary block

Example:

```json
{
  "gameId": "fightclub_ogres-vs-mages_...",
  "tick": 120,
  "phase": "active",
  "lanes": { "mid": { "frontline": 8 } },
  "heroes": { "alliance": [], "horde": [] },
  "fightClub": {
    "round": { "id": "ogres-vs-mages", "title": "Round 1: Ogres vs Mages" },
    "roundTick": 120,
    "wins": { "alliance": 0, "horde": 0 },
    "prediction": { "alliance": 10, "horde": 12, "alliancePct": 45, "hordePct": 55 }
  }
}
```

## GET /api/fightclub

Returns round-focused summary:

- active round definition
- all configured rounds
- win scoreboard
- history of recent round outcomes
- prediction totals/percentages

## POST /api/predict

Submit a winner prediction for the active round.

Request body:

```json
{ "pick": "alliance" }
```

Allowed values for `pick`:

- `alliance`
- `horde`

Success response:

```json
{
  "ok": true,
  "fightClub": {
    "prediction": {
      "alliance": 3,
      "horde": 2,
      "total": 5,
      "alliancePct": 60,
      "hordePct": 40
    }
  }
}
```

Error response (`400`):

```json
{ "error": "pick must be 'alliance' or 'horde'" }
```

## GET /api/rewards

Returns persisted reward ledger data from `data/reward-ledger.json`.

Query params:

- `limit` (optional, default 20, max 100): number of recent rounds.

Response fields:

- `totals` -> cumulative emitted reward estimate by faction
- `woaPerGold` -> conversion scalar used by backend
- `perRoundCap` -> hard round cap
- `recentRounds` -> newest-first round reward records
- `updatedAt` -> ledger write timestamp

## WebSocket /ws

Connect to:

`ws://localhost:3000/ws`

Server broadcasts state envelopes:

```json
{
  "type": "state",
  "data": { "tick": 121 }
}
```

Broadcast cadence is controlled by `BROADCAST_RATE` (default 10/s).

## Environment controls

- `PORT` (default `3000`)
- `TICK_RATE` (default `10`)
- `BROADCAST_RATE` (default `10`)

## Planned API additions

- persistent player profiles
- historical match query endpoints
- wallet-based pending/claimable $WOA endpoints
