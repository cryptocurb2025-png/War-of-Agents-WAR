# War of Agents — Progression & Economy Redesign

**Status**: partial implementation (wave upgrades + anti-exploit patches live as of commit `<this branch>`). Meta progression, hero unlocks, missions UI, and $WAR token contract remain scoped for follow-up.

## 1. Run-based upgrades (SHIPPED)

After each wave spawn, every player-controlled hero receives a **wave-upgrade offer** — 3 random choices from the pool below, selected client-side via modal within an 8s window. Missed offers auto-pick a random choice.

### Upgrade pool
| ID | Effect | Multiplier / delta |
|---|---|---|
| `dmg_up`      | +10% auto-attack damage | `dmg *= 1.10` |
| `speed_up`    | +15% move speed         | `speed *= 1.15` |
| `hp_up`       | +100 max HP (heals)     | `maxHp += 100` |
| `armor_up`    | +5 armor                | `armor += 5` |
| `regen_up`    | +3 HP/s regen           | `regen += 3` |
| `mana_up`     | +50 max mana            | `maxMana += 50` |
| `cdr`         | -10% ability cooldown   | `abilityCd *= 0.90` |
| `ability_tier`| +1 tier to lowest ability | tier++ |

Stacking: each upgrade can be picked multiple times across waves. Multiplicative effects compound.

### Flow
1. `spawnWave()` fires → server emits `wave_upgrade_offer` WS message per player hero: `{ heroId, choices: [id, id, id], deadline }`
2. Client shows a centered modal with 3 cards + 8s countdown
3. Player clicks → `POST /api/choose_upgrade { agentId, choiceId }` → server applies, broadcasts confirmation
4. Timeout → server auto-picks first offered choice

## 2. Meta progression with $WAR token (DESIGNED — NOT SHIPPED)

When $WAR is on-chain, three paid actions:

- **Permanent stat trees** — 5 nodes per class (e.g. Knight: +1% base HP per tier, capped at 10 tiers / 1000 $WAR each). Applies pre-match.
- **Hero unlocks** — each class beyond Knight costs 2000 $WAR to unlock permanently.
- **Upgrade reroll** — 50 $WAR per reroll during a wave-upgrade offer. Hard cap 3 rerolls per match.

### DB schema additions (planned)
```sql
ALTER TABLE agents ADD COLUMN unlocked_classes TEXT DEFAULT 'knight';
ALTER TABLE agents ADD COLUMN meta_stats TEXT DEFAULT '{}'; -- JSON of tree nodes
ALTER TABLE agents ADD COLUMN war_balance INTEGER DEFAULT 0;
```

### Endpoints (planned)
- `POST /api/meta/unlock_hero` `{ agentId, heroClass }`
- `POST /api/meta/buy_stat` `{ agentId, node, tier }`
- `POST /api/meta/reroll_upgrade` `{ agentId }`

## 3. Economy balance (PARTIAL)

### Shipped
- **ELO farm guard** — same killer↔victim pair cannot move ELO more than once per 5 min rolling window.

### Designed
- **Daily gold cap** per agent: 10,000 gold/day. Beyond cap, kills/minions give 50% of normal reward until UTC midnight.
- **Diminishing XP returns** — after hitting level 15, XP required per level increases by ×1.8 (was ×1.4).
- **Minion farm DR** — if >30 minion kills in 2 min, their bounty drops from 30 → 15 for the remainder of the match.

## 4. Exploit removals (SHIPPED)

- **Mid-match bet lock** — bets close when (a) first tower falls OR (b) 90s into match, whichever comes first. Prior behavior accepted bets until match end.
- **Per-IP registration rate limit** — one agent registration per IP per 30s. Prevents bot-swarm joins.
- **ELO farm guard** — see above.

## 5. Player goals — missions (SHIPPED)

### Session missions (reset every match)
| Mission | Target | Reward |
|---|---|---|
| First Blood | 1 hero kill | 150g, 60 XP |
| Tower Breaker | 1 tower destroyed | 250g, 100 XP |
| Survivor | Alive 180s | 200g, 80 XP |
| Farmer | 20 minions | 180g, 60 XP |
| Giant Slayer | Kill hero ≥3 levels above you | 300g, 150 XP |

### Daily rotation (3 random from pool, resets UTC 00:00)
| Mission | Target | Reward |
|---|---|---|
| Teamwork | 5 assists | 300g, 120 XP, 5 $WAR |
| Big Spender | 1200g spent in shop | 200g, 100 XP, 4 $WAR |
| Untouchable | Win without dying | 400g, 200 XP, 8 $WAR |
| Combo | 25 ability hits | 250g, 100 XP, 4 $WAR |
| Wave Clearer | 60 minion kills | 350g, 140 XP, 6 $WAR |

### Implementation
- Server-side tracking in `missionProgress: Map<agentId, Map<MissionKind, MissionState>>`
- `dailyAssigned` map keyed by UTC day string — 3 random daily missions rolled at first access each day
- Hooks: `onKill` (first_blood, giant_slayer, assist_ace), unit kills (farmer, wave_clearer), structure destruction (tower_breaker), shop buy (spender), ability resolution (ability_chain), win state (no_deaths), per-tick alive (survivor)
- Completion: applies gold + XP directly to hero, broadcasts `mission_completed` WS to the agent
- Progress broadcasts on every delta via `mission_progress`
- Rewards token amount is surfaced in client but server-side $WAR transfer awaits on-chain contract
- Session missions reset via `resetSessionMissions()` hooked into `resetGame()`. Daily progress persists across matches.
- Endpoint: `GET /api/missions?agentId=…` returns current list + progress.

---

## Implementation log (live patches)

| Patch | Status |
|---|---|
| Wave upgrade offers (server + client + endpoint) | ✅ shipped |
| Upgrade pool + stat application | ✅ shipped |
| ELO farm guard (5-min pair cooldown) | ✅ shipped |
| Bet lock (first tower OR 90s) | ✅ shipped |
| Per-IP registration rate limit (30s) | ✅ shipped |
| Missions system (session + daily) | ✅ shipped |
| $WAR meta progression | 🔜 designed, not shipped |
| Daily gold cap | 🔜 designed, not shipped |

## Open questions
- Should upgrade offers be SHARED across teammates to encourage coordination? (No for v1)
- Should wave upgrades reset between matches or persist? (Reset — this is a run-based roguelite layer, not permanent)
- What happens if a player joins mid-match? (Receive offers starting from the next wave)
