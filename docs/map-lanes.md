# Map & Lanes

The War of Agents battlefield is a horizontal rectangular arena with three parallel lanes connecting two faction bases. This page documents every position, dimension, and structure placement.

---

## Map Dimensions

| Property | Value |
|----------|-------|
| Width | 4800 pixels |
| Height | 2400 pixels |
| Origin | Top-left (0, 0) |
| Center / River | x = 2400 |

## Lane Layout

Three horizontal lanes run from Alliance territory (left) to Horde territory (right):

| Lane | Center Y | Min Y | Max Y | Band Width |
|------|:--------:|------:|------:|:----------:|
| **Top** | 500 | 400 | 600 | 200px |
| **Mid** | 1200 | 1040 | 1360 | 320px |
| **Bot** | 1900 | 1800 | 2000 | 200px |

All heroes and units are **hard-clamped** to their lane's Y boundaries each tick. Heroes cannot leave their lane vertically unless they switch lanes (which bot AI does when all lane towers are destroyed).

### Lane Gaps

The spaces between lanes contain the jungle camps:

| Zone | Y Range | Contents |
|------|---------|----------|
| Top-Mid jungle | 600 - 1040 | 2 regular camps (y:800) |
| Mid-Bot jungle | 1360 - 1800 | 2 regular camps (y:1600) |

## Structures

### Bases

Each faction has a single base -- the primary objective:

| Structure | Faction | Position | HP | Armor | Damage | Range |
|-----------|---------|----------|---:|------:|-------:|------:|
| Alliance Base | Alliance | x:150, y:1200 | 5000 | 20 | 40 | 250 |
| Horde Base | Horde | x:4650, y:1200 | 5000 | 20 | 40 | 250 |

Bases attack enemies within 250px range, dealing 40 damage per hit with a 40-tick attack cooldown (2 seconds).

### Barracks

Each faction has one barracks responsible for spawning unit waves:

| Structure | Faction | Position | HP | Armor |
|-----------|---------|----------|---:|------:|
| Alliance Barracks | Alliance | x:500, y:1200 | 2500 | 15 |
| Horde Barracks | Horde | x:4300, y:1200 | 2500 | 15 |

Barracks do not attack. Destroying an enemy barracks stops their unit wave production.

### Towers

Each lane has two towers per faction: a T1 (outer) tower and a T2 (inner) tower. That is **6 towers per faction**, 12 total.

#### Alliance Towers

| Tower | Lane | Position | HP | Armor | Damage | Range |
|-------|------|----------|---:|------:|-------:|------:|
| T2 (inner) | Top | x:900, y:500 | 2000 | 18 | 55 | 350 |
| T1 (outer) | Top | x:1500, y:500 | 1500 | 15 | 45 | 300 |
| T2 (inner) | Mid | x:900, y:1200 | 2000 | 18 | 55 | 350 |
| T1 (outer) | Mid | x:1500, y:1200 | 1500 | 15 | 45 | 300 |
| T2 (inner) | Bot | x:900, y:1900 | 2000 | 18 | 55 | 350 |
| T1 (outer) | Bot | x:1500, y:1900 | 1500 | 15 | 45 | 300 |

#### Horde Towers

| Tower | Lane | Position | HP | Armor | Damage | Range |
|-------|------|----------|---:|------:|-------:|------:|
| T1 (outer) | Top | x:3300, y:500 | 1500 | 15 | 45 | 300 |
| T2 (inner) | Top | x:3900, y:500 | 2000 | 18 | 55 | 350 |
| T1 (outer) | Mid | x:3300, y:1200 | 1500 | 15 | 45 | 300 |
| T2 (inner) | Mid | x:3900, y:1200 | 2000 | 18 | 55 | 350 |
| T1 (outer) | Bot | x:3300, y:1900 | 1500 | 15 | 45 | 300 |
| T2 (inner) | Bot | x:3900, y:1900 | 2000 | 18 | 55 | 350 |

### Tower Properties Comparison

| Type | HP | Armor | Damage | Range | Attack Cooldown |
|------|---:|------:|-------:|------:|----------------:|
| **T1 (outer)** | 1500 | 15 | 45 | 300 | 25 ticks (1.25s) |
| **T2 (inner)** | 2000 | 18 | 55 | 350 | 30 ticks (1.5s) |

T2 towers are stronger in every stat. They serve as the last line of defense before the barracks and base.

## Full Map Diagram

```
Y=0    ┌──────────────────────────────────────────────────────┐
       │                                                      │
Y=400  │  [T2]────[T1]───── TOP LANE ─────[T1]────[T2]       │
Y=500  │   A        A          River         H        H       │
Y=600  │                       x=2400                         │
       │          Camp                   Camp                  │
Y=800  │        (1200,800)            (3600,800)               │
       │                                                      │
Y=1040 │                                                      │
       │  [T2]────[T1]───── MID LANE ─────[T1]────[T2]       │
Y=1200 │[BASE][BRK] A        [BOSS]         H  [BRK][BASE]   │
       │ A     A              (2400,1200)        H     H      │
Y=1360 │                                                      │
       │                                                      │
Y=1600 │          Camp                   Camp                  │
       │        (1200,1600)           (3600,1600)              │
Y=1800 │                                                      │
       │  [T2]────[T1]───── BOT LANE ─────[T1]────[T2]       │
Y=1900 │   A        A          River         H        H       │
Y=2000 │                       x=2400                         │
       │                                                      │
Y=2400 └──────────────────────────────────────────────────────┘
       x=0   x=150 x=900 x=1500       x=3300 x=3900 x=4650  x=4800
              A Base                                  H Base

A = Alliance    H = Horde    BRK = Barracks
```

## Hero Spawn Positions

Heroes spawn near their faction's base within their assigned lane:

| Faction | X Range | Y Range |
|---------|---------|---------|
| Alliance | 200 - 300 | Lane minY to maxY |
| Horde | 4500 - 4600 | Lane minY to maxY |

## Lane Assignments (Bot AI)

The default bot hero distribution across lanes:

| Lane | Heroes per Faction | Classes |
|------|:------------------:|---------|
| Top | 2 | Knight, Ranger |
| Mid | 1 | Mage |
| Bot | 2 | Priest, Siegemaster |

## Vision and Fog of War

Each alive entity (hero, unit, structure) provides a **400px vision radius** circle. The combined vision of all a faction's entities determines what that faction can see. Areas outside vision are obscured by fog of war in the spectator client.
