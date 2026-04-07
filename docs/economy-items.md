# Economy & Items

Gold is the primary resource in War of Agents. Heroes earn gold through combat, passive income, and jungle clearing, then spend it at the item shop to gain permanent stat bonuses.

---

## Gold Sources

| Source | Gold Amount | Frequency |
|--------|:----------:|-----------|
| **Passive income** | 5 gold | Every 2 seconds (40 ticks) |
| **Unit kill** | 25 gold | Per kill |
| **Hero kill** | 200 gold (base) | Per kill |
| **Hero kill assist** | 75 gold | Per assist (up to 5 assisters) |
| **Kill streak bounty** | streak * 50 gold | Added to base hero kill gold |
| **Regular jungle camp** | 100 gold | Per monster killed |
| **Boss jungle camp** | 200 gold | Per monster killed |
| **Starting gold** | 300 gold | At hero creation |

### Kill Streak Bounties

When a hero accumulates consecutive kills without dying, a bounty builds on their head:

| Streak | Bounty Bonus | Total Kill Gold |
|:------:|:------------:|:---------------:|
| 0-2 | 0 | 200 |
| 3 | 150 | 350 |
| 4 | 200 | 400 |
| 5 (Rampage) | 250 | 450 |
| 10 | 500 | 700 |

The bounty resets to 0 when the hero dies. This creates a catch-up mechanic: the losing team can earn massive gold by killing a hero on a long streak.

### XP Sources

| Source | XP Amount |
|--------|:---------:|
| Hero kill | 80 + (victim_level * 10) |
| Hero kill assist | 40 |
| Unit kill | 20 |
| Regular jungle monster | 50 |
| Boss jungle monster | 100 |

---

## Item Shop

The item shop contains five items. Heroes can carry a **maximum of 5 items**. Each item can only be purchased once.

### Items Catalog

| Item | Cost | HP | Damage | Armor | Speed | Mana | Regen |
|------|-----:|---:|-------:|------:|------:|-----:|------:|
| **Swift Boots** | 150 | -- | -- | -- | +30 | -- | -- |
| **Battle Blade** | 300 | -- | +15 | -- | -- | -- | -- |
| **Iron Buckler** | 250 | +100 | -- | +8 | -- | -- | -- |
| **Shadow Cloak** | 200 | -- | -- | +4 | +15 | +50 | -- |
| **Ancient Relic** | 500 | +200 | +25 | -- | -- | +100 | +5 |

**Total cost for all 5 items: 1400 gold**

### Item Details

#### Swift Boots (150 gold)
The cheapest and most universally useful item. +30 speed improves chasing, retreating, and lane rotation. Should typically be the first purchase for any hero class.

#### Battle Blade (300 gold)
Pure damage item. +15 damage is a significant boost, especially on high-attack heroes like Ranger and Mage. Best for heroes focused on killing.

#### Iron Buckler (250 gold)
Defensive item providing +100 HP and +8 armor. Ideal for tanks (Knight, Siegemaster) or for heroes dying frequently. The HP bonus applies immediately on purchase.

#### Shadow Cloak (200 gold)
Hybrid utility item. +4 armor, +15 speed, and +50 mana covers multiple needs. Good second or third item for mana-hungry casters (Mage, Priest).

#### Ancient Relic (500 gold)
The premium item. +25 damage, +200 HP, +100 mana, and +5 regen make it the strongest single item. Its 500 gold cost means it is typically a late-game purchase.

### Item Application

When purchased, item stats are applied immediately:
- HP bonus increases both current and max HP
- Mana bonus increases both current and max mana
- Damage, armor, and speed bonuses are added to base stats

Items are permanent and cannot be sold.

---

## Bot AI Purchase Strategy

The built-in bot AI follows this priority order when buying items:

| Priority | Condition | Item |
|:--------:|-----------|------|
| 1 | Always first | Swift Boots (150g) |
| 2 | If deaths > kills | Iron Buckler (250g) |
| 3 | Default second | Battle Blade (300g) |
| 4 | Third item | Shadow Cloak (200g) |
| 5 | Late game | Ancient Relic (500g) |

The bot checks if it can afford items after each combat action and purchases the highest-priority item it does not already own.

---

## Gold Efficiency Analysis

When evaluating items, consider gold-per-stat ratios:

| Stat | Best Source | Cost per Point |
|------|-----------|:--------------:|
| Speed | Swift Boots | 5.0g per speed |
| Damage | Battle Blade | 20.0g per damage |
| Armor | Shadow Cloak | 50.0g per armor |
| HP | Iron Buckler | 2.5g per HP |
| Mana | Shadow Cloak | 4.0g per mana |

Ancient Relic offers the best combined value but requires significant gold accumulation.

## Economy Timeline

A typical gold income curve for an active hero:

| Time | Passive Gold | Estimated Kill Gold | Total (Approx) |
|------|:------------:|:-------------------:|:---------------:|
| 0:00 | 300 (start) | 0 | 300 |
| 1:00 | 150 | 100 | 550 |
| 2:00 | 300 | 250 | 850 |
| 5:00 | 750 | 750 | 1800 |
| 10:00 | 1500 | 2000 | 3800 |

Most heroes can purchase all 5 items within 5-8 minutes of active play.
