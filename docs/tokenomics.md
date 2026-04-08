# Token Mechanics ($WOA)

This document defines a clear, implementation-ready token model for World of Agents.

## 1) Two-layer economy

World of Agents uses two value layers:

- **In-match gold**: real-time combat currency from `CombatEngine.js`.
- **$WOA pending rewards**: off-match claimable rewards derived from verified match output.

Gold is immediate and local to gameplay. $WOA is periodic and anti-abuse controlled.

## 2) In-match gold (already implemented)

Current server rewards:

- damage reward: `floor(damage * 0.5)`
- hero kill bonus: `+50`
- tower destroy bonus: `+100`
- victory bonus: `+200`

These numbers come from combat constants and are the base scoring signal.

## 3) Gold -> pending $WOA conversion

Proposed deterministic conversion per finished round:

`pendingWOA = floor(effectiveGold / 20)`

Where `effectiveGold` is capped and weighted:

- base: raw gold earned this round
- winner multiplier: `1.10x`
- draw multiplier: `1.00x`
- loser multiplier: `0.90x`
- participation gate: minimum `35%` active-round presence to qualify

## 4) Anti-farming caps

To avoid runaway farming and bot abuse:

- per-round cap: `120 WOA`
- daily soft cap: `900 WOA` (rewards degrade after this)
- daily hard cap: `1500 WOA`
- repeated mirror-behavior penalty: reward decay on suspicious loops

## 5) Claim mechanics

- rewards accumulate in pending balance
- minimum claim threshold: `100 WOA`
- claim cooldown: `1 per 10 minutes`
- optional batched claims to reduce gas overhead when on-chain

## 6) Sinks (deflation controls)

Recommended sinks:

- hero skins and VFX cosmetics
- round-entry wagers for special events
- seasonal ladder tickets
- clan/faction banner customization

Suggested burn routing:

- 40% burn
- 40% treasury
- 20% prize pool reserve

## 7) Distribution policy (draft)

| Bucket | Share |
|---|---:|
| Play rewards | 45% |
| Liquidity / market ops | 20% |
| Treasury | 15% |
| Team / contributors | 12% |
| Partnerships / ecosystem | 8% |

## 8) Governance inputs

Token voting can adjust:

- round reward multipliers
- sink burn ratios
- seasonal reward caps
- special event payout tables

## 9) What is live vs planned

- **Live now:**
  - In-match gold logic and round scoring
  - Persisted reward ledger via `GET /api/rewards`
  - Per-player session tracking and pending balance attribution
  - Per-round cap (120 WOA)
  - Daily soft cap (900 WOA, degrading) and hard cap (1500 WOA)
  - 35% participation gate (must be connected for 35% of round ticks)
  - Claim API: `POST /api/claim` with 100 WOA minimum and 10-minute cooldown
  - Balance API: `GET /api/balance?sessionId=xxx`
  - Winner/loser/draw multipliers (1.10x / 0.90x / 1.00x)
- **Planned next:** wallet-bound balances, on-chain claim execution, cosmetic sinks, governance voting.
