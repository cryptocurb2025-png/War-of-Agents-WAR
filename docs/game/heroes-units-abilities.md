# Heroes, Units, and Abilities

## Hero classes

Hero base stats (from `Agent.js`):

| Class | HP | Mana | Damage | Mana Regen | Abilities |
|---|---:|---:|---:|---:|---|
| Warrior | 120 | 60 | 15 | 8 | Shield Slam, Thunder Clap, Battle Shout |
| Mage | 75 | 100 | 8 | 12 | Fireball, Blizzard, Frost Bolt |
| Ranger | 90 | 50 | 18 | 6 | Multi-Shot, Poison Arrow |
| Healer | 70 | 120 | 6 | 15 | Holy Light, Chain Heal, War Stomp |

Each hero has 2-3 abilities. AI selects the best ability based on context (heal when low HP, stun enemies, AOE for groups).

Fight Club rounds apply additional multipliers per hero to create dramatic matchups.

## Abilities

Ability definitions (from `Ability.js`):

| Ability | Type | Value | Mana | CD | Effect |
|---|---|---:|---:|---:|---|
| Shield Slam | Damage | 20 | 25 | 3 | Direct damage |
| Thunder Clap | AOE Damage | 15 | 30 | 4 | Hits hero + nearby creeps |
| Battle Shout | Armor Buff | - | 20 | 5 | +10 armor for 3 ticks |
| Fireball | Damage | 35 | 30 | 2 | Direct damage |
| Blizzard | AOE Damage | 18 | 40 | 4 | Area damage + 8/tick DoT for 2 ticks |
| Frost Bolt | Slow | 25 | 25 | 3 | Damage + 50% slow for 3 ticks |
| Multi-Shot | Damage | 28 | 20 | 2 | Direct damage |
| Poison Arrow | DoT | 20 | 15 | 2 | Initial hit + 8/tick for 3 ticks |
| Holy Light | Heal | 50 | 35 | 3 | Heals self |
| Chain Heal | Heal | 35 | 40 | 4 | Heals self |
| War Stomp | Stun | 10 | 35 | 5 | Damage + stun for 2 ticks |

## Status effects

| Effect | Description |
|---|---|
| Stun | Target skips their action for duration |
| Slow | Target damage output halved for duration |
| DoT | Target takes damage each tick for duration |
| Armor Buff | Reduces incoming damage by effect value for duration |

## Unit archetypes

Unit stats (from `Unit.js`):

| Unit | HP | Damage | Speed |
|---|---:|---:|---:|
| Footman | 50 | 6 | 4 |
| Grunt | 50 | 6 | 4 |
| Rifleman | 35 | 5 | 4 |
| Axethrower | 35 | 5 | 4 |
| Ogre | 88 | 13 | 3 |
| Ogre Lord | 150 | 25 | 2 |
| Forest Troll | 60 | 8 | 4 |
| Troll Axer | 45 | 12 | 4 |
| Battle Mage | 45 | 16 | 3 |
| Peasant | 36 | 4 | 4 |
| Death Knight | 90 | 12 | 3 |
| Knight | 100 | 15 | 5 |
| Elven Archer | 40 | 10 | 4 |
| Wolf Rider | 55 | 9 | 6 |
| Ballista | 55 | 20 | 2 |
| Catapult | 80 | 30 | 1 |

## Fight Club roster flavor

To keep the Warcraft vibe while staying original:

- **Alliance** side frequently fields human-like order units (Warriors, Healers, Peasants).
- **Horde** side fields heavy brutish pressure and siege options (Ogres, Grunts, Ballistas).
- **Mage variants** provide high burst but low durability.

## Art style constraints

- Pixel-style sprites with clear silhouettes.
- High readability over photorealism.
- Low render weight for browser performance.
- Distinct faction colors for instant recognition.
