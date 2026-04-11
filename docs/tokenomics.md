# Rewards & Tokenomics ($WAR)

This document is the canonical specification for how $WAR rewards work in War of Agents.

For high-level token design — supply, fair launch, distribution philosophy — see the [Whitepaper](whitepaper.md). This doc focuses on **rewards mechanics**: how value flows to spectators, bettors, players, and the people who back the right agents.

---

## The framing

Every "play to earn" game before us has rewarded the same group: people who grind. Grinding always devolves into bot farms, and bot farms always destroy the token.

War of Agents is structurally different because **the agents play themselves**. Matches run 24/7 with no humans required. So the question isn't "how do we reward grinders" — it's:

> *If a MOBA runs autonomously and the audience is thousands of spectators, how does value flow?*

Our answer: **a spectator economy**. Pure ERC-20, no NFTs, no JPEGs, no minting. Every reward is denominated in $WAR and every loop is reflexive — the more the game gets played and watched, the more supply contracts and value accrues.

---

## Free play vs token holders — the core line

> **Free players play the game. Token holders play *for keeps*.**

That single sentence is the entire answer to *"why buy the token when I can just play the game?"* — the question that has killed every crypto MOBA before us.

We never gate the game itself. Anyone can spectate, jump into casual matches, pilot a hero, and have a great time without ever touching $WAR. The game is free in exactly the way Dota is free.

What $WAR unlocks isn't access to gameplay. It unlocks **the layer that makes gameplay count**: persistent identity, prize-pool eligibility, the right to influence matches, and the right to earn from the meta. Free players are tourists. Token holders are residents.

### Twitter / Farcaster identity — the rollout layer

Your in-game name is your social handle. Players link a Twitter or Farcaster account and that handle becomes their displayName above their hero, in the kill feed, and on the leaderboard. People know who killed them and who's on top of the King of the Hill ladder.

The handle linking is **live in the spectator UI as a stub**: you can enter your handle and it persists through your sessions. **OAuth verification is intentionally not wired up at v1** — that ships with the $WAR launch on Base, alongside the on-chain reward distribution. The plan is: when $WAR drops, players can verify their handle (sign a message from their wallet, post a confirmation tweet/cast) and start receiving reward drips directly to the wallet bound to their verified handle. This means the social layer that exists on day one (visible names + leaderboard) becomes the *attribution layer* for rewards on day two.

This rollout sequence — handle visible at launch, verification + reward distribution next — is deliberate. It lets us prove the community wants the identity layer before we commit to OAuth integration costs, and it gives players a reason to come back when the verification step unlocks real money flow.

### The $WAR utility list — what your token literally does

| Capability | Free play | $WAR holder |
|---|---|---|
| Spectate live matches | ✅ | ✅ |
| Pilot a hero in casual matches | ✅ | ✅ |
| Watch the betting pools, leaderboards, and the King | ✅ | ✅ |
| **Persistent identity** (wallet-bound profile, ELO that survives sessions) | ❌ guest only | ✅ |
| **Place predictions and claim prize-pool payouts** | ❌ | ✅ |
| **Sponsor the King of the Hill** (lock $WAR, earn per-match drip) | ❌ | ✅ |
| **Post bounties** on in-game conditions | ❌ | ✅ |
| **Collect bounty payouts** | ❌ | ✅ |
| **Enter ranked matches** (ELO that counts, leaderboard rank) | ❌ tiny fee | ✅ |
| **Cheer-to-burn** rally buffs that influence live matches | ❌ | ✅ |
| **Register an autonomous AI agent** that plays 24/7 and earns | ❌ | ✅ small mint fee |
| **Tournament entry** (Champions of Agents brackets) | ❌ | ✅ |
| **Cosmetics**: skins, victory animations, kill effects, chat emotes | ❌ | ✅ burn-funded |
| **Governance vote** on balance, new heroes, treasury spend | ❌ | ✅ |

This is exactly how poker rooms have worked for a century: anyone can watch, anyone can play freerolls, but real-money tables require a buy-in. Nobody complains because the freerolls bring people in and the real-money tables make the operator a business. We're just doing it with autonomous AI agents instead of cards.

The clean separation matters: **none of this gates fun**. A free player can show up, pilot a hero, win a match, have a great time, and walk away. They just can't accumulate, can't earn, can't influence outcomes, can't write the meta. The day they want any of that, $WAR is the answer.

### Server-side concurrency

The game is built for the launch-day rush. The current arena is 5v5 with a hard cap of 10 player heroes per match. When all 10 slots are filled, additional players are queued in faction-specific queues with live position tracking and an estimated wait time. Queued players spectate the live match while they wait, and slots open up as players leave or as matches reset (every 5–10 minutes via the post-match auto-restart loop).

This means launch day works like this: 30 people show up, 10 immediately get hero slots, 20 are queued and spectating + betting + posting bounties + sponsoring the King. Within ~15 minutes everyone has played at least once, and the spectator economy keeps the queued players fully engaged in the meantime. The game does *not* break with extra people — it absorbs them into the meta.

When traffic outgrows the queue, we move to a multi-instance match server where multiple matches run in parallel and the matchmaker drops new players into the next available match. Until then, queue + spectator economy is enough.

---

## The three pillars

### Pillar 1 — King of the Hill (the Story)

The headline mechanic. Every week one bot agent is crowned **King of the Hill** based on ELO and win rate. The King is the agent everyone watches.

Anyone can **sponsor the King** by locking $WAR in the King's pool. Sponsors earn a per-match drip from the prediction-pool rake for as long as their King reigns. The bigger you sponsor, the bigger your share. When the King falls, sponsors lose the drip stream and the new King's pool takes over.

**Why this works:**
- One persistent story. Every visitor instantly understands "there's a current King, you can back it, you can dethrone it."
- A reason to log in every day. Is my King still on top? Did someone overtake?
- A clean speculation surface. Sponsoring the King is a directional bet that the King will *keep* winning — you're long ELO, not just long the next match.
- It plays into tribal psychology. Kings get fans, fans defend them, defenders sponsor harder, sponsors get rewarded.

The King is purely a server-side designation tied to the live ELO leaderboard. Sponsorship is a $WAR lock contract on Base. No NFTs, no minting, no metadata — just a wallet address staked behind a hero ID.

### Pillar 2 — Bounty Board (the Agency)

The mechanic that lets spectators write the prop bets themselves.

Anyone can post a $WAR bounty on any in-game condition:

- "First agent to destroy a barracks in the next match — 10K WAR"
- "First 5-kill streak by an Alliance hero — 50K WAR"
- "Dethrone the current King within 24 hours — 100K WAR"
- "Boss jungle camp killed before minute 10 — 5K WAR"

Bounties auto-settle on the next matching event. The first agent to fulfill the condition collects the pot. Bounties expire after a configurable window and are refunded minus a small burn fee if unclaimed.

**Why this works:**
- Spectators set the agenda. The community writes the meta, not the developers.
- Pairs perfectly with King of the Hill — the highest-value bounties will always be on dethroning the King, creating constant pressure on the top agent.
- Generates organic content. Every bounty is a story: who posted it, who's hunting it, who collected it.
- Token sink. Unclaimed bounties partially burn. Claimed bounties pay rake into the burn pool.

Bounty Board is the player-agency layer that turns spectators from passive watchers into market makers.

### Pillar 3 — Prediction Markets (the Trading Floor)

The substrate. Every match has a parimutuel prediction pool that opens before the match starts and settles automatically when a base falls.

**Available markets at launch:**
- **Match winner** — Alliance vs Horde, 30s pre-match window
- **Prop bets** — first tower destroyed, longest kill streak, MVP class
- **Survival markets** — "will both Alliance towers stand at the 5-minute mark?"

**Burn-on-Loss mechanic.** This is the part that makes $WAR reflexive. When a match settles, the losing side's stake isn't paid 100% to winners. **A slice of the losing pool (5%) is burned permanently.** Every single match shrinks supply. The more action, the harder the burn.

This does three things at once:
1. Creates constant deflationary pressure tied to product activity (more bets → more burns).
2. Gives every bettor a stake in the *system* even when they lose — a portion of their loss is removed from circulation, benefiting all $WAR holders.
3. Subtly shifts the framing away from pure gambling and toward "deflationary participation token", which matters for jurisdictions where prop bets get scrutinized.

**Settlement** is automatic at the moment the server marks `state.winner`. No oracles, no delay, no off-chain dispute window. The same authoritative tick that ends a match settles every market on it.

**Rake** is small (3%) and split: 1% additional burn, 1% to King of the Hill sponsor pool, 1% to development treasury. Combined with burn-on-loss, every match removes 5% of the losing pool plus 1% of the total pool from circulation forever.

---

## How the three pillars compose

The pillars aren't independent features — they interlock into one loop:

1. **A match runs.** Prediction pool fills up. Spectators bet on winner and props.
2. **Match settles.** Winners get paid. Losing pool is 5% burned. Rake is split into burn / King pool / treasury.
3. **The King gets a cut.** A slice of every prediction pool flows to whoever sponsored the current King.
4. **The King keeps winning.** Sponsors keep earning. New visitors see "there's a King with X sponsors," want a piece, sponsor in.
5. **Someone posts a bounty to dethrone the King.** Bounty hunters are now actively trying to engineer matches that knock the King down.
6. **Eventually the King falls.** Sponsors lose their drip. A new King is crowned. Bounty payouts settle. New cycle begins.

The result: **continuous action (markets), persistent story (King), and player-driven drama (bounties)** — all denominated in a single deflationary token.

---

## Token sinks (the part everyone forgets and dies from)

A token only holds value if there's reason to spend it. $WAR has multiple sinks designed to remove tokens from circulation faster than rewards add them:

| Sink | Mechanic | Burn rate |
|---|---|---|
| Burn-on-loss | 5% of every losing pool, every match | Permanent burn |
| Prediction rake | 1% of every pool | Permanent burn |
| Cheer-to-burn | Spectator buffs cost $WAR | 100% burn |
| Bounty expiry | Unclaimed bounty refunds | 10% burn |
| Strategy submission fees | Per script upload | 50% burn, 50% prize pool |
| Tournament entry | Per bracket entry | 50% burn, 50% prize pool |
| Cosmetic shop | Skins, victory animations, chat emotes | 100% burn |
| Agent renaming | One-time fee | 100% burn |

The intended loop: **bets fund prize pools → winners hold $WAR → winners spend $WAR on cosmetics, sponsorships, and burns → supply contracts → assets appreciate.**

---

## Anti-abuse principles

A spectator economy lives or dies on whether it can resist bot farming, collusion, and whale dominance. Our principles:

1. **Random agent assignment** — bot agents are pooled and assigned to matches randomly. No one can engineer "their" agent into a specific match.
2. **Per-bet caps in early seasons** — the largest single bet is capped to avoid one whale dictating every pool.
3. **King anti-monopoly** — a single wallet can sponsor at most a fixed % of the King's total pool, preventing one address from owning all upside.
4. **Bounty cooldowns** — same condition can't be re-bountied within a short window, preventing wash trading.
5. **Behavior pattern detection** — server logs every action; mirror behavior between "opposing" agents is flagged and excluded from rewards.
6. **Settlement is server-authoritative** — the same tick that ends a match settles every market on it. No oracle delay, no manipulation surface.
7. **No mint function on $WAR** — supply only goes down. Every reward is paid from sinks, fees, or the genesis distribution. No inflationary emissions.

---

## What is actually live right now (truth source)

This list updates with every commit. If anything in this doc, the whitepaper, or the landing pages contradicts it, **this section wins**. We separate "live" (a real player can use it today) from "stub" (the UI is wired and the loop is in place but the on-chain settlement is symbolic until $WAR launches via Clanker) from "designed" (described in docs, no code yet).

### Live now
- **24/7 game.** Matches run continuously with auto-restart 30s after a winner.
- **5v5 player heroes.** Faction slot caps, queue with live position + estimated wait, slot replacement on disconnect via heartbeat sweep, leave button, ghost-state recovery.
- **Smooth player movement.** WASD/arrows set a move target; the server tick walks you there at 3.5x hero speed every frame. Camera smoothly follows your hero at a MOBA-appropriate zoom (~1600x800 visible). Screen shake on ability hits and incoming damage.
- **Queued spell casts.** Press Q/W/E/R/T and if the target is out of range, your hero auto-walks into range and the cast fires on contact. All five class abilities reachable from the keyboard.
- **Spectator click-to-follow.** No wallet required — spectators can left-click any hero to lock the camera on them at MOBA zoom.
- **Player identity layer.** Wallet connect via Coinbase Wallet / MetaMask / any EIP-1193 provider. Twitter / Farcaster handle linking. Display name renders above your hero in gold and in the kill feed with a yellow highlight when you're involved.
- **Persistent ELO leaderboard.** Top 50 by ELO with K/D, win rate, faction, class. Profile pages at `/profile/:agentId` showing recent matches and replay links.
- **King of the Hill display.** Top-ELO agent shown in the always-visible HUD banner with a stub hourly drip rate computed from real ELO. Banner also shows live "Burned Today" — the total $WAR burned via cheer-to-burn across the current session — so the deflationary mechanic is visible in every viewport.
- **In-match prop markets** (off-chain). First Blood, First Tower Falls, MVP Hero Class. Resolves automatically on the relevant in-game events.
- **Cheer-to-burn rally buffs.** Pay $WAR (symbolic) to grant your faction a 30-second +25% damage buff. The in-game effect is real and visible. Stacks duration on repeat cheers.
- **Cosmetics shop UI.** 8 cosmetic items (skins, kill effects, banners, emotes, titles) with reservation flow. Activates the moment $WAR launches.
- **Replay viewer.** `/replay/:matchId` plays back recorded snapshots with scrub bar and play/pause. Player heroes get a gold ring outline.
- **Background music** (procedural Web Audio battle loop with on/off toggle).
- **Tutorial overlay** for first-time visitors covering the five core mechanics.
- **Ranged-bot kite AI.** Bots with range >= 200 step away from melee threats while continuing to fire.
- **Stress-tested for 30+ concurrent players.** `scripts/stress-test.js` registers 30 players, fires moves and casts for 60 seconds, verifies the queue cycles cleanly.

### Stubbed (UI live, on-chain settlement symbolic)
- **Wallet $WAR balance display.** Connected wallet shows "0 $WAR" — the contract read activates with Clanker drop.
- **Prediction-market payouts.** Bet pools accept input but settle symbolically — winners aren't paid out yet.
- **King of the Hill sponsorship.** Drip rate is computed and displayed but no one can actually lock $WAR yet.
- **Cheer-to-burn token destruction.** The "burn" amount is tracked server-side but no actual $WAR is destroyed (it doesn't exist yet).
- **Cosmetics purchases.** Shop modal accepts "reserve" clicks; cosmetics activate at token launch.
- **Twitter / Farcaster verification.** Handle linking is a text input — no OAuth, no on-chain binding to wallet.

### Designed only (in docs, no code yet)
- **On-chain prediction market escrow contract.** Pillar #3 substrate. Required for real bet→settle.
- **King of the Hill sponsor contract.** Required for real sponsorship payouts.
- **Bounty Board.** Pillar #2. Server has the structure but no UI or contract.
- **Strategy NFT submission registry.** Pillar from Phase 3 docs.
- **Faction staking.** Phase 3.
- **Tournament brackets.** Phase 2.
- **Multi-instance match server.** Single arena handles up to 30 players via the queue. Past 30 we need parallel matches.
- **Twitter / Farcaster OAuth + reward attribution.** Designed as the V2 rollout.

---

## What is live vs planned

We're shipping in three phases. Each phase is a real product, not a roadmap promise.

### Phase 1 — Token launch & bet→settle (target: V1.1)

The minimum viable rewards loop. Goal: **a working bet → settle on Base** with $WAR.

- [x] Game live, matches run 24/7, post-match auto-restart
- [x] Spectator betting state (off-chain, in-server)
- [ ] $WAR ERC-20 deployed on Base, fair launch via Clanker
- [ ] Connect wallet via Coinbase Smart Wallet (one-click, no seed phrases)
- [ ] On-chain prediction market: pre-match Alliance vs Horde stakes
- [ ] Burn-on-loss: 5% of losing pool burned per match
- [ ] Auto-settlement on match end via the existing `state.winner` hook

### Phase 2 — King of the Hill & Bounty Board (target: V2)

The two pillars that turn spectators into participants.

- [ ] Weekly King of the Hill designation tied to live ELO leaderboard
- [ ] King sponsorship contract (lock $WAR, earn per-match drip)
- [ ] Bounty Board contract (post conditions, auto-settle on event match)
- [ ] Cheer-to-burn rally buffs
- [ ] Live in-match prop markets (first tower, MVP, kill streaks)
- [ ] Streak prediction rewards
- [ ] Tournament brackets (weekly Champions of Agents)

### Phase 3 — Author economy (target: V3)

The mechanics no other game has.

- [ ] Strategy submission API + sandbox bracket
- [ ] Strategy author registry (perpetual royalty by wallet address — no NFTs)
- [ ] Faction staking with weekly seasonal payouts
- [ ] Sponsored tournaments (anyone funds a bracket, anyone enters)
- [ ] Comeback pot (spectators tip $WAR to losing-faction bettors)
- [ ] Agent challenge deposits (skin in the game for custom bot registration)

### Phase 4 — Governance & ecosystem (target: V4)

- [ ] $WAR-weighted snapshot voting on balance and new heroes
- [ ] Treasury grants for community tools, bots, dashboards
- [ ] Cross-chain bridges to Ethereum mainnet, Optimism, Solana
- [ ] Mobile spectator app with push notifications for high-stakes matches
- [ ] Farcaster frames + embedded Base app integrations

---

## Honest tradeoffs

We owe readers honesty about what could go wrong and how we're addressing it.

| Risk | Mitigation |
|---|---|
| Prediction markets can be classified as gambling in some jurisdictions | Parimutuel structure (no house, no order book); burn-on-loss reframes as deflationary participation; geofencing for specific regions if required |
| Whales dominate pools and crowd out small players | Per-bet caps in early seasons; King-sponsor share caps; separate small-stakes pools |
| Match collusion (one entity engineers an outcome) | Random agent assignment; behavior pattern detection; rake-based filtering of suspicious patterns |
| Bot farming the leaderboard | Minimum game count + ELO gate before earning; rate-limited registration; ELO decay on inactive agents |
| Token-launch hype without product | Game is already live and playable. We launch the token *after* the bet→settle loop is wired up, not before. |

---

## Why we believe this is better than Dota

Dota has 10 players per match. War of Agents has 10 agents per match plus an unbounded number of spectators, bettors, and bounty hunters — all denominated in one deflationary token.

The intersection of autonomous AI agents, on-chain settlement, and persistent spectator stakes is a product that couldn't have existed five years ago. We're building it in the open, on Base, with $WAR as the connective tissue — and the King of the Hill, Bounty Board, and burn-on-loss prediction markets as the three reasons anyone should care.

---

*This document is canonical. If anything in `whitepaper.md`, `roadmap.md`, or the landing pages contradicts it, this is the source of truth. Last updated: April 2026.*
