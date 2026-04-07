# Units & Factions

Each faction fields a roster of four distinct unit types that spawn in waves from their barracks. Neutral jungle camps occupy the spaces between lanes, offering gold and XP to heroes who clear them.

---

## Alliance Units

The Alliance fields a balanced army with strong ranged options and aerial superiority.

| Unit | HP | Damage | Armor | Speed | Range | Role |
|------|---:|-------:|------:|------:|------:|------|
| **Footman** | 300 | 18 | 6 | 70 | 60 | Melee tank |
| **Archer** | 200 | 22 | 2 | 80 | 300 | Ranged DPS |
| **Gryphon** | 400 | 30 | 4 | 100 | 150 | Fast assault |
| **Ballista** | 350 | 45 | 8 | 50 | 400 | Siege ranged |

### Unit Roles

- **Footman** -- The frontline infantry. Moderate HP and armor absorb tower hits, allowing ranged units to deal damage safely.
- **Archer** -- Long-range damage dealer. Fragile but effective at 300 range, picking off enemies from behind the Footman line.
- **Gryphon** -- The fastest Alliance unit at 100 speed. High HP (400) and solid damage make it an aggressive flanker.
- **Ballista** -- Extreme range (400) and highest unit damage (45) at the cost of being the slowest unit (50 speed). Excellent for sieging towers.

## Horde Units

The Horde fields a heavier army with more HP, higher damage, and stronger armor at the cost of speed.

| Unit | HP | Damage | Armor | Speed | Range | Role |
|------|---:|-------:|------:|------:|------:|------|
| **Ironwarrior** | 350 | 20 | 8 | 65 | 60 | Heavy melee |
| **Shredder** | 250 | 28 | 3 | 90 | 80 | Fast melee DPS |
| **Warlock** | 220 | 35 | 2 | 75 | 280 | Ranged caster |
| **Colossus** | 500 | 40 | 10 | 45 | 120 | Siege tank |

### Unit Roles

- **Ironwarrior** -- Tougher than the Alliance Footman with 50 more HP and 2 more armor, but slower (65 vs 70 speed).
- **Shredder** -- The fastest Horde unit (90 speed) with high melee damage (28). Glass cannon with only 250 HP.
- **Warlock** -- Ranged caster dealing 35 damage at 280 range. Low survivability but strong ranged pressure.
- **Colossus** -- The tankiest unit in the game at 500 HP and 10 armor. Devastating 40 damage at 120 range. Extremely slow (45 speed).

## Faction Comparison

| Stat | Alliance Average | Horde Average |
|------|:----------------:|:-------------:|
| HP | 312 | 330 |
| Damage | 28.75 | 30.75 |
| Armor | 5.0 | 5.75 |
| Speed | 75.0 | 68.75 |
| Range | 227.5 | 130.0 |

**Alliance** has the edge in speed and range -- better for kiting and poking. **Horde** is tankier with higher raw damage -- better for sustained brawling. This asymmetry is further amplified by the day/night cycle (Alliance buffed during day, Horde at night).

---

## Wave Spawning

Waves spawn from each faction's barracks every **30 seconds**:

- Each wave contains **2 copies** of each unit type per lane
- Units are distributed across all 3 lanes (top, mid, bot)
- Each faction spawns **8 units per lane per wave** (24 total per faction)
- Waves scale with a **5% multiplier per wave number**:

```
scaling = 1 + (waveCount * 0.05)
scaledHP = floor(baseHP * scaling)
scaledDamage = floor(baseDamage * scaling)
```

### Wave Scaling Examples

| Wave | Scaling | Footman HP | Ironwarrior HP |
|------|--------:|-----------:|---------------:|
| 1 | 1.05x | 315 | 367 |
| 5 | 1.25x | 375 | 437 |
| 10 | 1.50x | 450 | 525 |
| 20 | 2.00x | 600 | 700 |

Armor and speed are **not scaled** -- only HP and damage increase with wave count.

### Spawn Conditions

Waves only spawn if the faction's barracks is alive. Destroying an enemy barracks stops their wave production entirely, giving a massive strategic advantage.

| Structure | HP | Armor |
|-----------|---:|------:|
| Barracks | 2500 | 15 |

---

## Jungle Camps

Five neutral jungle camps are spread across the map between lanes. Clearing camps provides gold and XP rewards to the hero who lands the killing blow.

### Camp Locations

| Camp | Position | Type | Monsters | HP Each | Damage |
|------|----------|------|:--------:|--------:|-------:|
| Upper-Left | x:1200, y:800 | Regular | 2 | 400 | 15 |
| Upper-Right | x:3600, y:800 | Regular | 2 | 400 | 15 |
| Lower-Left | x:1200, y:1600 | Regular | 2 | 400 | 15 |
| Lower-Right | x:3600, y:1600 | Regular | 2 | 400 | 15 |
| **Center Boss** | **x:2400, y:1200** | **Boss** | **3** | **600** | **25** |

### Rewards

| Camp Type | Gold per Monster | XP per Monster |
|-----------|:----------------:|:--------------:|
| Regular | 100 | 50 |
| Boss | 200 | 100 |

### Respawn

Once all monsters in a camp are killed, the camp enters a **60-second respawn timer** (1200 ticks). After the timer expires, all monsters respawn at full HP.

### Combat Behavior

- Jungle monsters have **no armor** (damage is applied at full value)
- Monsters fight back when a hero is within **100px**, dealing their damage to the hero
- Monsters do not chase -- they only retaliate when engaged
- Heroes attack jungle monsters when within `hero.range + 50` pixels

### Boss Camp Strategy

The center boss camp at x:2400, y:1200 sits at the exact midpoint of the map on the river/divider line. It contains 3 monsters with 600 HP each (1800 total HP) dealing 25 damage. Clearing it yields 600 gold and 300 XP total -- a significant power spike. The boss camp is highly contested territory.
