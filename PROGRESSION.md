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

## 5. Player goals — missions (SHIPPED — single source of truth)

### Contract summary
- **5 session missions** are always active each match. Reset on match end via `resetSessionMissions()` in `resetGame()`.
- **3 daily missions** are rolled per player per UTC day from a pool of 5.
- **Reset cadence**: UTC 00:00 daily for dailies. Session missions reset at match end.
- **No mid-day replacement**: completed dailies stay visible (green, strikethrough) until UTC 00:00. Deliberate — instant replacement invites grinding.
- **Duplicate prevention**: daily roll picks *without replacement* from the pool, so no duplicate dailies for the same player. Session set is fixed.
- **Rewards** (difficulty-scaled: easy → medium 1.5× → hard 2.25×):
  - Gold + XP applied directly to the active hero on completion
  - `$WAR` amount surfaced in payload for dailies (awaits on-chain contract)
  - 15% bonus roll: +40-120g or +20-60 XP, multiplied ×1.4 medium, ×2 hard
- **Feedback on completion**: `mission_completed` WS → banner (`✓ ★★★ LABEL COMPLETE`) + floating `+N GOLD` + `+N XP` above the hero + `sfxLevelUp` + system chat summary. Bonus beats 250ms later with `sfxGold`.



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

## Mission system audit (2026-04-14 finalization)

### Data model
```
missionProgress: Map<agentId, Map<MissionKind, MissionState>>
  MissionState { id, progress, target, completed, daily }

dailyAssigned: Map<agentId, { ids: MissionKind[]; day: 'YYYY-MM-DD' }>
```
In-memory Maps are the fast path; **SQLite `missions` table is now the durable store**. On first access per server lifetime, `hydrateAgentFromDb(agentId)` loads the agent's rows into memory. Every progress delta and completion is mirrored to DB via `persistMission`. Daily rollover purges the agent's old `daily=1` rows before re-seeding.

### Reset logic (server-authoritative)
- `ensureAgentMissions(agentId)` is called by:
  - `bumpMission(agentId, ...)` — so any progress event guarantees fresh state
  - `missionsForAgent(agentId)` — so GET /api/missions guarantees fresh state
- Inside `ensureAgentMissions`:
  - **Session**: if a mission id isn't present for the agent, create it with progress=0. Doesn't re-roll. `resetSessionMissions()` in `resetGame()` zeroes them per match.
  - **Daily**: if `dailyAssigned.day` ≠ `utcDay()`, pick 3 random ids from `DAILY_POOL_IDS` (without replacement), delete any prior daily entries not in the new set, and for each new id re-create entry if absent or previously completed. Same-ID roll two days in a row preserves progress only if the mission wasn't completed (rare, benign).
- Timezone: reset is strictly on UTC boundary, identical for every player globally. `utcDay()` uses `getUTC{Full,Month,Date}` so DST or local TZ cannot shift it.

### Endpoints
- `GET /api/missions?agentId=<id>` — returns array of `{ id, label, description, progress, target, completed, daily, difficulty, rewardGold, rewardXp, rewardToken }`
- Progress / completion pushed via WS (`mission_progress`, `mission_completed`) using `broadcastToAgent` which tags `targetAgentId` so other clients filter out.

### Client sync
- `#missions-panel` HUD shows all current missions with live progress bar
- `fetchMissions()` GETs on player load + 30s poll as fallback
- WS push patches rows in-place without refetch
- `#reset-countdown` ticks every 30s showing `Xh Ym` to UTC 00:00
- On client-side midnight crossing, auto re-fetches missions so new dailies land immediately

### Validation
| Concern | Status |
|---|---|
| Duplicate missions on reroll | Pool sampled without replacement — impossible |
| Duplicate daily completions after server restart | **Fixed** — `missions` table now persists progress + completion. Hydration on first agent access restores state. |
| Timezone drift | None — all resets on UTC midnight |
| Client clock skew | Client countdown is cosmetic; server is authoritative. If client clock is wrong, they see wrong countdown but real reroll happens correctly on next server interaction after UTC midnight |
| Mission reward double-claim | Guarded by `if (!s.completed)` check before applying; completion is atomic within the `bumpMission` call |
| Farm exploit (retrigger completed mission) | Not possible — `bumpMission` early-returns if `s.completed` |
| Daily slot exhaustion (complete all 3 then farm new ones) | Prevented — no mid-day replacement by design |
| Agent without agentId (bot heroes) | `bumpMission` early-returns on undefined agentId, so bots never accrue mission state |

### Known limitations (tracked, not blocking)
- **In-memory persistence only.** Server restart loses daily progress and completion. Medium-priority fix: write to `missions` table on completion and rehydrate on startup. Low risk currently given Railway rolling restarts are rare.
- **$WAR rewards are payload-only.** No on-chain transfer until contract deploys. Client shows the amount so players understand the incentive.

### Reconnect / reload safety
- Client: `playerAgentId` rehydrates from `localStorage` on load; `fetchMissions()` fires ~500ms after connect and repopulates the HUD from server state. WS reconnect automatic (existing ws.onclose retry).
- Server: state survives within process lifetime. A process restart drops in-memory daily progress — noted as known limitation. Session-within-match state naturally refreshes on next `bumpMission` event.
- No duplicate-reward path on reconnect: completion is authoritative server-side, already-completed missions reject further `bumpMission` increments.

## Open questions
- Should upgrade offers be SHARED across teammates to encourage coordination? (No for v1)
- Should wave upgrades reset between matches or persist? (Reset — this is a run-based roguelite layer, not permanent)
- What happens if a player joins mid-match? (Receive offers starting from the next wave)
