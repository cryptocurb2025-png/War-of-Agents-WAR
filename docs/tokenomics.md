# Rewards & Tokenomics ($WAR)

This document is the canonical specification for how $WAR rewards work in War of Agents.

For the high-level token design — supply, fair launch, distribution philosophy — see the [Whitepaper](whitepaper.md). This doc focuses on **rewards mechanics**: how value flows to players, spectators, agent owners, and strategy authors.

---

## The framing

Every "play to earn" game before us has rewarded the same group: people who grind. Grinding always devolves into bot farms, and bot farms always destroy the token.

War of Agents is structurally different because **the agents play themselves**. Matches run 24/7 with no humans required. So the question isn't "how do we reward grinders" — it's:

> *If a MOBA runs autonomously and the audience is thousands of spectators, how does value flow?*

Our answer: **a spectator economy.** Five participation tiers, each with its own reward surface:

| Tier | Who | What they do | What they earn |
|---|---|---|---|
| **Watch** | Anyone | Spectate live matches | Free entertainment, optional stake-on-outcome |
| **Predict** | Bettors | Stake on match / prop outcomes | Parimutuel pool payouts in $WAR |
| **Pilot** | Players | Drive a hero with mouse/keyboard | ELO, leaderboard drip, glory |
| **Author** | Coders | Submit AI strategy scripts | Tournament prizes, strategy NFT royalties |
| **Own** | Collectors | Hold agent / strategy / faction NFTs | A cut of every match those assets win |

Dota's economy rewards 10 humans per match. War of Agents rewards anyone who chose to be in the room.

---

## The six reward pillars

### 1. Prediction markets (the daily-actives engine)

Spectators stake $WAR on match outcomes through a parimutuel pool — no order book, no house, the pool is the market. Bet windows open before each match, with optional in-match prop markets that settle on specific events.

**Available markets at launch:**
- **Match winner** — Alliance vs Horde, 30s pre-match window
- **Prop bets** — first tower destroyed, longest kill streak, MVP class
- **Survival markets** — "will both Alliance towers stand at the 5-minute mark?"

**Settlement** is automatic at the moment the server marks `state.winner`. No oracles, no delay — the same authoritative tick that ends a match settles every market on that match.

**Rake** is small (3%) and split: 1% burned permanently, 1% to the seasonal prize pool, 1% to the development treasury. Parimutuel structure means there is no possibility of platform insolvency — winners are paid from the same pool the losers contributed to.

### 2. Agent NFTs (the "your hero is an asset" loop)

Every registered agent is a tradeable NFT on Base. Agents accumulate verifiable on-chain stats over time — ELO, K/D, win rate, item history, hero classes played, cosmetic unlocks. Owners earn:

- **Performance royalties** — when a match settles, a fixed share of the prediction pool (1% of the winning side) is split among the owners of the winning agents
- **Leaderboard drip** — top-100 ELO agents share a weekly $WAR distribution from the seasonal pool
- **Resale value** — high-ELO and historically significant agents become collectibles
- **Rental income** — list your agent on the rental market, earn $WAR per match someone uses it

This is the **alignment mechanism**: an agent owner has a permanent reason to want their agent to perform well, the way a racehorse owner wants their horse to win.

### 3. Strategy submission (the actually-novel mechanic)

Players submit strategy scripts — JavaScript or JSON behavior trees — that drive hero decision-making. Strategies compete head-to-head in scheduled brackets. The strategy itself is an NFT.

**Why this is the moat:** no MOBA in history has had a meaningful "code your strategy" tier with real prize pools. The audience for it is exactly the audience War of Agents needs — programmers, AI engineers, crypto degens — and they don't have a comparable product anywhere else.

**Mechanics:**
- Submit a strategy via API or web upload, pay a small $WAR fee
- Strategies are tested in a sandbox bracket against other recent submissions
- Top strategies graduate to the live agent pool and start earning
- Strategy authors earn a perpetual royalty when their strategy wins matches
- Strategies can be forked, sold, licensed, or open-sourced

### 4. Faction stakes (the tribal loyalty engine)

Stake $WAR to declare for **Alliance** or **Iron Horde**. Each weekly season, the faction with more total wins receives a treasury distribution. Stakers earn proportional to their stake size and stake duration.

This creates the long-term economic identity that Dota factions never had. You don't just "play Alliance for one match" — you bleed Alliance gold for the whole season because your bag is on the line.

### 5. Spectator engagement (the retention engine)

Small mechanics that make spectating *active*:

- **Cheer-to-burn** — pay a small $WAR amount to throw a "rally" buff at your faction during a match. The tokens are burned permanently. Pure spectator → game influence loop, doubles as the primary token sink.
- **Streak rewards** — predict 5 matches in a row correctly, earn a bonus drip from the seasonal pool
- **Watch badges** — limited-mint commemorative NFTs for spectators present during historic matches (perfect games, longest matches, season finals)

### 6. Tournament layer (the prestige engine)

Weekly **Champions of Agents** brackets. Top ELO agents auto-qualify, plus an open bracket anyone can enter for a $WAR fee. The fees fund the prize pool. **Sponsored tournaments** let anyone fund a custom bracket with custom rules — useful for guilds, streamers, partner protocols.

Tournaments become the esports loop without ever needing humans to coordinate schedules.

---

## Token sinks (the part everyone forgets and dies from)

A token only holds value if there's reason to spend it. $WAR has multiple sinks designed to remove tokens from circulation faster than rewards add them:

| Sink | Mechanic | Burn rate |
|---|---|---|
| Prediction rake | 1% of every pool | Permanent burn |
| Cheer-to-burn | Spectator buff costs | 100% burn |
| Strategy submission fees | Per script upload | 50% burn, 50% prize pool |
| Tournament entry | Per bracket entry | 50% burn, 50% prize pool |
| Cosmetic shop | Skins, victory animations, chat emotes | 100% burn |
| Agent renaming | One-time fee | 100% burn |
| Agent NFT minting | First-time mint | 50% burn, 50% treasury |

The intended loop: **bets fund prize pools → winners hold $WAR → winners spend $WAR on cosmetics, entries, and burns → supply contracts → assets appreciate.**

---

## Anti-abuse principles

A spectator economy lives or dies on whether it can resist bot farming, collusion, and whale dominance. Our principles:

1. **Random agent assignment** — agent owners don't choose which match their agent enters. Eliminates the "own both sides, throw one match" attack vector.
2. **Per-bet caps in early seasons** — the largest single bet is capped to avoid one whale dictating every pool.
3. **Quality gates for leaderboard drip** — agents must complete a minimum game count and clear a minimum ELO before earning the seasonal drip. Stops spam-registration farms.
4. **Behavior pattern detection** — server logs every action; suspicious mirror behavior (two "opposing" agents that always match each other's moves) is flagged and excluded from rewards.
5. **Settlement is server-authoritative** — the same tick that ends a match settles every market on it. No oracle delay, no off-chain dispute window, no manipulation surface.
6. **No mint function on $WAR** — supply only goes down. Every reward is paid from sinks, fees, or the genesis distribution. No inflationary emissions.

---

## What is live vs planned

We're shipping in three phases. Each phase is a real product, not a roadmap promise.

### Phase 1 — Token launch (target: V1.1)

The minimum viable rewards loop. Goal: **a working bet → settle on Base** with $WAR.

- [x] Game live, matches run 24/7, post-match auto-restart
- [x] Spectator betting state (off-chain, in-server)
- [ ] $WAR ERC-20 deployed on Base, fair launch via Clanker
- [ ] Connect wallet via Coinbase Smart Wallet (one-click, no seed phrases)
- [ ] On-chain prediction market: pre-match Alliance vs Horde stakes
- [ ] Auto-settlement on match end via the existing `state.winner` hook
- [ ] Weekly ELO leaderboard drip (manual distribution v1, automated v2)

### Phase 2 — Spectator economy (target: V2)

The mechanics that make $WAR worth holding instead of just trading.

- [ ] Agent NFTs minted on registration, performance royalties active
- [ ] Live in-match prop markets (first tower, MVP, kill streaks)
- [ ] Cheer-to-burn rally buffs
- [ ] Cosmetic shop (hero skins, victory animations)
- [ ] Streak prediction rewards
- [ ] Tournament brackets (weekly Champions of Agents)

### Phase 3 — Author economy & moat (target: V3)

The mechanics no other game has.

- [ ] Strategy submission API + sandbox bracket
- [ ] Strategy NFTs with author royalties
- [ ] Faction staking with seasonal payouts
- [ ] Sponsored tournaments (anyone funds a bracket, anyone enters)
- [ ] Agent rental marketplace
- [ ] Replay-staking (bet on archived matches with hidden outcomes)

### Phase 4 — Governance & ecosystem (target: V4)

- [ ] $WAR-weighted snapshot voting on balance changes, new heroes
- [ ] Treasury grants for community-built tools, bots, analysis dashboards
- [ ] Cross-chain bridges to Ethereum mainnet, Optimism, Solana
- [ ] Mobile spectator app with push notifications for high-stakes matches
- [ ] Partner integrations (Coinbase Smart Wallet, Farcaster frames, embedded Base apps)

---

## Honest tradeoffs

We owe readers honesty about what could go wrong and how we're addressing it.

| Risk | Mitigation |
|---|---|
| Prediction markets can be classified as gambling in some jurisdictions | Parimutuel structure (no house, no order book) reduces classification risk; geofencing for specific regions if required; framed as skill-prediction on autonomous outcomes |
| Whales dominate pools and crowd out small players | Per-bet caps in early seasons; separate small-stakes pools; parimutuel decay curves favor smaller bets |
| Match collusion (one entity owns multiple agents and throws matches) | Random agent assignment; behavior pattern detection; rake-based filtering of suspicious patterns |
| Bot farming the leaderboard | Minimum game count + ELO gate before earning; rate-limited registration; ELO decay on inactive agents |
| Token-launch hype without product | Game is already live and playable. We launch the token *after* the bet→settle loop is wired up, not before. |

---

## Why we believe this is better than Dota

Dota has 10 players per match. War of Agents has 10 agents per match plus an unbounded number of spectators, bettors, owners, and code authors. Dota's economy rewards human reflexes. Ours rewards strategy at every level — from owning the right agents to writing the right code to predicting the right outcomes.

The intersection of autonomous AI agents, on-chain settlement, and persistent spectator stakes is a product that couldn't have existed five years ago. We're building it in the open, on Base, with $WAR as the connective tissue.

---

*This document is canonical. If anything in `whitepaper.md`, `roadmap.md`, or the landing pages contradicts it, this is the source of truth. Last updated: April 2026.*
