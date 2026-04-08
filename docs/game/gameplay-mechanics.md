# Gameplay Mechanics

## Core loop

The server is authoritative and runs at `TICK_RATE` (default 10 ticks/sec).

Per tick:

1. Advance game tick.
2. Process respawns.
3. Process each lane combat.
4. Regenerate strongholds when not under attack.
5. Check victory.

## Round system (Fight Club)

The server cycles through a fixed set of themed rounds:

1. Human Legion vs Orc Horde (Footmen, Archers, Knights vs Grunts, Trolls, Ogres)
2. High Elves vs Forest Trolls (Archers, Battle Mages vs Trolls, Wolf Riders)
3. Death Knights vs Ogre Warlords (Dark cavalry and siege engines)
4. Grand Siege (All unit types, maximum scale)

Each round defines:

- spawn cadence (`spawnEvery`, `burst`, `maxPerSide`)
- unit types per side
- lane focus (current setup is mid-lane focused)
- hero scaling modifiers (`hpScale`, `damageScale`, `manaScale`)
- duration in ticks

At round end, winner is resolved by:

1. Stronghold HP
2. Alive tower count
3. Combined army power (unit count + hero HP)
4. Draw if equal

## Lane and frontline

- **Single lane (Mid)** — Fight Club mode focuses all combat on the mid lane. Top and bottom lanes are inactive.
- Positions are lane-space from `-100` to `+100`.
- Alliance starts near `-95`, Horde near `+95`.
- Frontline is recomputed from active units and power advantage.

## Creep combat

- Units move every tick based on `speed`.
- Engagement starts when enemies are close enough.
- Units trade attacks using attack cooldowns.
- Dead units are removed from lane arrays.

## Structures

### Towers

- HP: 400
- Damage: 50
- Cooldown: 2 ticks
- Two per side per lane (Outer, Inner)

Towers become vulnerable through lane pressure and are damaged by heroes and unit waves.

### Strongholds

- HP: 1000
- Regen: 5 HP/tick
- Regen delay: 10 ticks after last damage

When a stronghold reaches 0 HP, match winner is set.

## Hero combat model

Heroes auto-act in lane:

- regenerate mana each tick
- process status effects (stun skips turn, DoT deals tick damage, slow halves output)
- AI selects best ability from 2-3 per hero (heal if low HP, stun if available, AOE for groups, highest damage otherwise)
- fall back to basic attack when no ability is ready
- respawn 5 ticks after death with all cooldowns reset

## Economy (in-sim)

Gold rewards in combat engine:

- `floor(damage * 0.5)` per damage contribution
- +50 on hero kill
- +100 on tower destruction
- +200 victory bonus

This gold drives local progression and is the base signal for $WOA reward conversion in token mechanics.
