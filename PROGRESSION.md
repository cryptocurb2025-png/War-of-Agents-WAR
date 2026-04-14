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

## 5. Player goals — missions (DESIGNED)

Missions to add (per-match instance counters, nothing persistent yet):
- **First Blood** — land the first kill of the match → 150 gold bonus
- **Tower Breaker** — destroy 2 enemy towers → 250 gold bonus
- **Survivor** — stay alive 3 consecutive waves → 200 gold bonus
- **Farmer** — reach 2000g total this match → +1 free upgrade reroll (next wave offer)
- **Giant Slayer** — kill a hero at least 3 levels above you → 300 gold bonus

All missions tracked server-side per agentId, checked on kill / tower-destroy / tick events.

---

## Implementation log (live patches)

| Patch | Status |
|---|---|
| Wave upgrade offers (server + client + endpoint) | ✅ shipped |
| Upgrade pool + stat application | ✅ shipped |
| ELO farm guard (5-min pair cooldown) | ✅ shipped |
| Bet lock (first tower OR 90s) | ✅ shipped |
| Per-IP registration rate limit (30s) | ✅ shipped |
| Missions system | 🔜 designed, not shipped |
| $WAR meta progression | 🔜 designed, not shipped |
| Daily gold cap | 🔜 designed, not shipped |

## Open questions
- Should upgrade offers be SHARED across teammates to encourage coordination? (No for v1)
- Should wave upgrades reset between matches or persist? (Reset — this is a run-based roguelite layer, not permanent)
- What happens if a player joins mid-match? (Receive offers starting from the next wave)
