# War of Agents Docs

War of Agents is a Warcraft-inspired AI battle arena where spectators watch AI commanders lead autonomous armies in a Fight Club series format, or play head-to-head PvP MOBA matches. Earn $WOA tokens by watching and participating.

## Sections

- `game/how-to-play.md` - Run the project locally, spectate rounds, submit predictions, or play PvP.
- `game/gameplay-mechanics.md` - Tick system, lane combat, round flow, series structure, win logic.
- `game/heroes-units-abilities.md` - Hero classes (2-3 abilities each), unit archetypes, status effects.
- `tokenomics.md` - $WOA token mechanics, reward formula, daily caps, claim system.
- `developers/api.md` - REST API + WebSocket contract.
- `developers/tech-stack.md` - Architecture and tech stack.

## Game Modes

### Fight Club (Spectator) — Main Mode
Watch AI commanders lead armies in a best-of series:

- **4 themed rounds** rotate through (Human Legion vs Orc Horde, Elves vs Trolls, Death Knights vs Ogres, Grand Siege)
- **AI Commanders** — each faction gets a random commander personality (aggressive, balanced, defensive, siege) that changes each series
- **Series format** — first faction to 3 round wins takes the series
- **MVP tracking** — best-performing hero highlighted each round
- **Predictions** — vote on which faction will win each round
- **$WOA rewards** — earn tokens for watching (35% presence required)

### PvP Arena (Playable)
Head-to-head MOBA where you control a hero:
- Enter your name to join queue
- Get matched with an opponent (or practice vs AI bot)
- Choose your hero (Warrior, Mage, Ranger, Healer)
- Use WASD keys to move, attack, and cast abilities
- Creeps spawn and fight alongside you
- Destroy enemy stronghold to win
- Earn $WOA tokens based on performance

## Running Locally

```bash
npm install
npm start          # Fight Club spectator (port 3000)
npm run pvp        # PvP arena (port 3001)
```

Then open:
- http://localhost:3000 — Fight Club spectator
- http://localhost:3000/pvp — PvP arena
- http://localhost:3000/docs — Documentation

## Audio

Procedural Warcraft-style battle music and sound effects via Web Audio API — no external audio files needed:
- **Battle Music** — war drums, brass drone, heroic melody, string pad
- **Combat SFX** — attacks, abilities (per-type), kills, tower destruction
- **Round transitions** — horn fanfare on round start
- **Series events** — victory/defeat stingers

## Key Features

- Multi-ability heroes (stun, slow, DoT, AOE, armor buff, heal)
- AI-driven ability selection based on combat context
- 16 unit types with distinct stats
- Per-player tokenomics with daily caps and claim system
- Canvas battlefield with ambient particles, screen shake, dynamic lighting
- Social panel with live stats (FPS, match timer, unit counts)
- Kill feed overlay and match history table
