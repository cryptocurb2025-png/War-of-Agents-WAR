# Heroes & Abilities

War of Agents features five hero classes, each with a distinct role and five unique abilities. Heroes level up through combat, gaining stat bonuses and ability upgrades.

---

## Hero Classes Overview

| Class | Role | HP | Mana | Damage | Armor | Speed | Range |
|-------|------|---:|-----:|-------:|------:|------:|------:|
| **Knight** | Tank / Frontline | 800 | 150 | 28 | 12 | 90 | 70 |
| **Ranger** | Ranged DPS | 550 | 200 | 35 | 5 | 110 | 350 |
| **Mage** | Burst Caster | 480 | 350 | 42 | 3 | 95 | 300 |
| **Priest** | Healer / Support | 520 | 400 | 18 | 4 | 100 | 280 |
| **Siegemaster** | Structure Destroyer | 700 | 180 | 50 | 10 | 70 | 400 |

All heroes start at **Level 1** with **300 starting gold**.

---

## Knight

The Knight is a durable frontline tank who excels at crowd control and protecting allies. With the highest base HP and armor, the Knight leads charges and disrupts enemy formations.

### Abilities

| Ability | Cooldown | Damage | Range | AoE | Mana | Effect |
|---------|----------|-------:|------:|----:|-----:|--------|
| **Shield Bash** | 60 ticks (3s) | 35 | 80 | -- | 15 | Stun |
| **Charge** | 100 ticks (5s) | 50 | 250 | -- | 25 | Dash |
| **Whirlwind** | 80 ticks (4s) | 40 | 120 | 120 | 30 | Spin (AoE) |
| **Fortify** | 200 ticks (10s) | -- | -- | -- | 40 | Armor buff |
| **Battle Rally** | 300 ticks (15s) | -- | 300 | 300 | 60 | Team buff (AoE) |

### Playstyle

Knights should lead pushes and initiate team fights. **Shield Bash** provides reliable stun for locking down targets. **Charge** closes gaps to reach ranged enemies. **Whirlwind** deals AoE damage in melee range. **Fortify** and **Battle Rally** are defensive ultimates -- save them for crucial fights.

---

## Ranger

The Ranger is a high-mobility ranged attacker with the longest base attack range among damage dealers. Fast movement speed allows the Ranger to kite enemies and control spacing.

### Abilities

| Ability | Cooldown | Damage | Range | AoE | Mana | Effect |
|---------|----------|-------:|------:|----:|-----:|--------|
| **Power Shot** | 40 ticks (2s) | 55 | 400 | -- | 15 | Single target |
| **Multi Shot** | 70 ticks (3.5s) | 30 | 350 | 100 | 25 | AoE |
| **Bear Trap** | 120 ticks (6s) | 20 | 200 | 60 | 20 | Slow |
| **Eagle Eye** | 150 ticks (7.5s) | 80 | 500 | -- | 35 | Critical hit |
| **Rain of Arrows** | 250 ticks (12.5s) | 45 | 400 | 200 | 55 | AoE ultimate |

### Playstyle

Rangers excel at sustained ranged damage. **Power Shot** is the bread-and-butter ability with a short cooldown and long range. **Eagle Eye** at 500 range is the longest-reach ability in the game. **Rain of Arrows** devastates clustered enemies. Use **Bear Trap** to slow pursuers when retreating.

---

## Mage

The Mage deals the highest burst damage in the game with powerful AoE spells. Low HP and armor make positioning critical -- one mistake can be fatal.

### Abilities

| Ability | Cooldown | Damage | Range | AoE | Mana | Effect |
|---------|----------|-------:|------:|----:|-----:|--------|
| **Fireball** | 50 ticks (2.5s) | 65 | 350 | 80 | 20 | Burn |
| **Frost Bolt** | 45 ticks (2.25s) | 40 | 300 | -- | 15 | Slow |
| **Arcane Blast** | 60 ticks (3s) | 75 | 250 | 100 | 30 | AoE |
| **Blink** | 100 ticks (5s) | -- | 300 | -- | 25 | Teleport |
| **Meteor Storm** | 300 ticks (15s) | 120 | 400 | 250 | 80 | AoE ultimate |

### Playstyle

The Mage is a glass cannon. **Meteor Storm** at 120 base damage with a 250px AoE is the most devastating ability in the game. **Blink** provides essential mobility for escaping or repositioning. **Frost Bolt** slows enemies to maintain distance. Lead engagements with **Fireball** for burn damage, follow up with **Arcane Blast** for AoE burst.

---

## Priest

The Priest is the only healing class. With the highest mana pool and unique support abilities, the Priest keeps allies alive through extended fights.

### Abilities

| Ability | Cooldown | Damage | Range | AoE | Mana | Effect |
|---------|----------|-------:|------:|----:|-----:|--------|
| **Holy Light** | 40 ticks (2s) | 60 heal | 300 | -- | 20 | Single-target heal |
| **Holy Smite** | 50 ticks (2.5s) | 45 | 300 | -- | 15 | Damage |
| **Divine Shield** | 150 ticks (7.5s) | -- | -- | -- | 35 | Invulnerability |
| **Mass Heal** | 200 ticks (10s) | 80 heal | 350 | 300 | 60 | AoE heal |
| **Resurrection** | 400 ticks (20s) | -- | 200 | -- | 100 | Revive ally |

### Playstyle

The Priest's healing output can swing fights decisively. **Holy Light** is a short-cooldown single-target heal -- use it on any ally below 50% HP. **Mass Heal** covers a 300px radius, ideal for grouped team fights. **Divine Shield** grants invulnerability in emergencies. **Resurrection** has the longest cooldown in the game (20s) but can bring back a fallen ally. **Holy Smite** provides modest damage when healing is not needed.

### Healing Behavior

The bot AI prioritizes healing as follows:
- If self HP is below 50%, heal self
- Otherwise, heal the nearest allied hero below 50% HP within range
- If no one needs healing, heal self as a default

---

## Siegemaster

The Siegemaster deals extreme damage to structures and excels in siege scenarios. The highest base damage and longest attack range make the Siegemaster a late-game threat, but low speed makes positioning a challenge.

### Abilities

| Ability | Cooldown | Damage | Range | AoE | Mana | Effect |
|---------|----------|-------:|------:|----:|-----:|--------|
| **Cannon Shot** | 60 ticks (3s) | 70 | 400 | 100 | 20 | AoE |
| **Mortar Barrage** | 100 ticks (5s) | 50 | 500 | 150 | 35 | AoE |
| **Fortification** | 150 ticks (7.5s) | -- | -- | -- | 30 | Tower buff |
| **Demolish** | 80 ticks (4s) | 100 | 150 | -- | 25 | Structure damage |
| **Siege Mode** | 300 ticks (15s) | -- | -- | -- | 50 | Transform |

### Playstyle

The Siegemaster is built to destroy buildings. **Demolish** deals 100 base damage specifically designed for structures. **Mortar Barrage** has 500 range (the longest ability range tied with Eagle Eye) and 150px AoE. **Cannon Shot** provides reliable damage. **Fortification** buffs nearby towers defensively. **Siege Mode** transforms the hero for enhanced capabilities. The Siegemaster's low speed (70) means it relies on positioning and allied protection.

---

## Ability Upgrade System

Each ability starts at **Tier 1** and can be upgraded to a **maximum of Tier 5**. On every hero level-up, one random ability that has not reached max tier is selected for upgrade.

### Upgrade Effects

| Tier | Damage Multiplier | Cooldown Reduction |
|------|------------------:|--------------------|
| 1 | 1.0x (base) | 0 ticks |
| 2 | 1.2x | -5 ticks |
| 3 | 1.44x | -10 ticks |
| 4 | 1.73x | -15 ticks |
| 5 | 2.07x | -20 ticks |

The damage multiplier compounds: each tier applies a 1.2x multiplier to the previous tier's damage. Cooldown reduction subtracts 5 ticks per tier from the base cooldown (minimum 10 ticks).

### Practical Example

A Mage's **Fireball** (65 base damage, 50 tick cooldown):

| Tier | Damage | Cooldown |
|------|-------:|---------:|
| 1 | 65 | 50 ticks (2.5s) |
| 2 | 78 | 45 ticks (2.25s) |
| 3 | 93 | 40 ticks (2.0s) |
| 4 | 112 | 35 ticks (1.75s) |
| 5 | 134 | 30 ticks (1.5s) |

## Level-Up Stat Gains

Every level-up provides the following flat bonuses:

| Stat | Per Level |
|------|-----------|
| Max HP | +40 |
| Max Mana | +20 |
| Damage | +3 |
| Armor | +1 |

HP and Mana are immediately restored by the bonus amount (not a full heal).
