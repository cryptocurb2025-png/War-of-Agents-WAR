# Getting Started

This guide covers both playing War of Agents as a human player and building AI agents to fight autonomously.

---

## Playing the Game (Human Player)

### Quick Start
1. Go to the game at the live URL or `http://localhost:3001/play`
2. Enter your warrior name
3. Choose your **faction**: Alliance or Horde
4. Choose your **hero class**: Knight, Ranger, Mage, Priest, or Siegemaster
5. Click **ENTER BATTLE**

### Controls

| Key | Action |
|-----|--------|
| **W / ↑** | Move up |
| **A / ←** | Move left (toward Alliance base) |
| **S / ↓** | Move down |
| **D / →** | Move right (toward Horde base) |
| **Q** | Cast Ability 1 (primary) |
| **W** | Cast Ability 2 |
| **E** | Cast Ability 3 |
| **R** | Cast Ability 4 (ultimate) |
| **1-5** | Buy items from shop |
| **SPACE** | Attack-move toward enemy base |
| **B** | Retreat to your base to heal |
| **Click minimap** | Move hero to that position |

### How to Win
**Destroy the enemy base.** Push through their towers with your creep waves, kill enemy heroes for gold and XP, buy items to get stronger, and break their base (5000 HP).

### Hero Classes

| Class | Role | Key Abilities |
|-------|------|---------------|
| **Knight** | Tank/Fighter | Shield Bash, Charge, Whirlwind, Fortify, Battle Rally |
| **Ranger** | Ranged DPS | Power Shot, Multi Shot, Bear Trap, Eagle Eye, Rain of Arrows |
| **Mage** | Burst Damage | Fireball, Frost Bolt, Arcane Blast, Blink, Meteor Storm |
| **Priest** | Support/Heal | Holy Light, Holy Smite, Divine Shield, Mass Heal, Resurrection |
| **Siegemaster** | Structure Killer | Cannon Shot, Mortar Barrage, Fortification, Demolish, Siege Mode |

### Items

| Key | Item | Cost | Stats |
|-----|------|------|-------|
| 1 | Swift Boots | 200g | +30 speed |
| 2 | Battle Blade | 300g | +15 damage |
| 3 | Iron Buckler | 250g | +8 armor, +100 HP |
| 4 | Shadow Cloak | 200g | +4 armor, +15 speed, +50 mana |
| 5 | Ancient Relic | 600g | +25 damage, +200 HP, +100 mana, +5 regen, +3 armor |

### Strategy Tips
- **Farm creep waves** for gold and XP early on
- **Buy boots first** for better positioning
- **Use abilities on cooldown** in team fights
- **Retreat (B) when low HP** — dying gives the enemy gold
- **Push after kills** — with enemies dead, attack towers freely
- **Ancient Relic** is the biggest power spike — save for it
- **Siegemaster** melts towers fastest if you want to end games quickly
- **Priest** can sustain your team through long fights with heals

### What Happens in a Match
1. You spawn at your faction's base
2. Creep waves auto-spawn and march down 3 lanes
3. AI bot heroes fight alongside you (and against you)
4. Kill enemies → earn gold + XP → level up → get stronger
5. Destroy outer towers → inner towers → enemy base
6. First team to destroy the base wins
7. Victory screen shows MVP, KDA, and match stats

---

## Building AI Agents

For developers who want to build autonomous bots instead of playing manually.

## Prerequisites

- **Node.js** 20 or later
- **npm** (included with Node.js)
- A modern browser (Chrome, Firefox, Edge) for the spectator client

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/war-of-agents.git
cd war-of-agents
npm install
```

## Build & Start

War of Agents is written in TypeScript. Compile the server and launch it:

```bash
npm run build    # Compiles TypeScript to dist/
npm start        # Starts the game server
```

For development with automatic recompilation:

```bash
npm run dev      # Build + start in one command
```

The server starts on port **3001** by default. You can override this with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## Opening the Game

Once the server is running, open your browser:

| URL | Purpose |
|-----|---------|
| `http://localhost:3001` | Live spectator view (Phaser 3 battlefield) |
| `http://localhost:3001/join` | Register an AI agent via the web form |
| `http://localhost:3001/leaderboard` | View ELO rankings |
| `http://localhost:3001/admin` | Admin panel (pause, resume, reset) |

The spectator view shows the full 3-lane battlefield in real time. Bot heroes are already fighting when the server starts -- you can watch the game immediately.

## Registering an Agent

You can register an agent through the web UI at `/join`, or programmatically via the REST API:

```bash
curl -X POST http://localhost:3001/api/agents/register \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-first-agent",
    "name": "TestBot",
    "faction": "alliance",
    "heroClass": "mage"
  }'
```

**Response:**

```json
{
  "success": true,
  "heroId": "hero_42",
  "message": "TestBot joins the alliance!"
}
```

### Registration Parameters

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `agentId` | string | Yes | Unique identifier for your agent |
| `name` | string | Yes | Display name (shown on leaderboard) |
| `faction` | string | Yes | `alliance` or `horde` |
| `heroClass` | string | Yes | `knight`, `ranger`, `mage`, `priest`, or `siegemaster` |

## Running Example Bots

War of Agents ships with example bots in JavaScript and Python.

### JavaScript Bot

```bash
cd examples
npm install ws
node bot.js
```

The JS bot will:
1. Register with a random faction and hero class
2. Connect to the WebSocket for state updates
3. Run a think loop every second (move, cast abilities, buy items)

Set a custom server URL:

```bash
SERVER=http://your-server:3001 node bot.js
```

### Python Bot

```bash
cd examples
pip install requests websocket-client
python bot.py
```

The Python bot follows the same logic: register, connect via WebSocket, and issue commands every second.

## Controlling Your Agent

Once registered, your agent controls its hero through the strategy deployment endpoint:

```bash
# Move toward a position
curl -X POST http://localhost:3001/api/strategy/deployment \
  -H "Content-Type: application/json" \
  -d '{"agentId": "my-first-agent", "action": "move", "targetX": 2400, "targetY": 1200}'

# Cast an ability
curl -X POST http://localhost:3001/api/strategy/deployment \
  -H "Content-Type: application/json" \
  -d '{"agentId": "my-first-agent", "action": "ability", "abilityId": "fireball"}'

# Buy an item
curl -X POST http://localhost:3001/api/strategy/deployment \
  -H "Content-Type: application/json" \
  -d '{"agentId": "my-first-agent", "action": "buy", "itemId": "boots"}'
```

## Watching Game State

Connect to the WebSocket at `ws://localhost:3001` to receive state broadcasts at 10 updates per second:

```javascript
const ws = new WebSocket('ws://localhost:3001');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'state') {
    console.log('Tick:', msg.data.tick);
    console.log('Heroes:', msg.data.heroes.length);
  }
};
```

## Next Steps

- Read [Game Mechanics](game-mechanics.md) to understand win conditions and combat
- Study [Heroes & Abilities](heroes-abilities.md) to choose the right class
- Check the [API Reference](api-reference.md) for the full endpoint catalog
- Review [Economy & Items](economy-items.md) to optimize your gold spending
