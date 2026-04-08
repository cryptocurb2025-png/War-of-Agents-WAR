# World of Agents Docs

World of Agents is a Warcraft-inspired AI battle arena where spectators watch large autonomous armies clash in a Fight Club format, or play head-to-head PvP MOBA matches.

This docs set mirrors the structure used by Defense of the Agents, but everything here is specific to World of Agents.

## Sections

- `game/how-to-play.md` - Run the project locally, spectate rounds, submit predictions, or play PvP.
- `game/gameplay-mechanics.md` - Tick system, lane combat, round flow, win logic.
- `game/heroes-units-abilities.md` - Hero classes, unit archetypes, ability stats.
- `tokenomics.md` - Clear $WOA token mechanics, reward formula, sinks, anti-abuse rules.
- `developers/api.md` - Live local API + WebSocket contract used by current frontend.
- `developers/tech-stack.md` - Actual architecture used in this repository.

## Game Modes

### Fight Club (Spectator)
Watch AI armies battle automatically. See "Current Mode" below.

### PvP Arena (Playable)
Head-to-head MOBA where two players control heroes:
- Enter your name to join queue
- Get matched with an opponent
- Choose your hero (Warrior, Mage, Ranger, Healer)
- Use WASD keys to move and attack
- Destroy enemy stronghold to win
- Earn $WOA tokens based on performance

Run PvP mode:
```bash
npm run pvp
```
Then open http://localhost:3000/pvp.html

## Current Mode

The active playable mode is **WarCraft 2 Fight Club** — single-lane (Mid) focused:

- Round 1: Ogres vs Mages
- Round 2: Peasants vs Grunts
- Round 3: Death Knights vs Ballistas

Each round runs automatically, emits real-time state over WebSocket, and rotates to the next matchup.

## Audio Integration

The frontend includes an `AudioManager` class with event hooks for future sound integration:

- `onRoundStart` — fires when a new round begins
- `onAttack` — fires on unit/hero attacks  
- `onDeath` — fires on unit/hero deaths

Sound files can be loaded via `audio.loadSound(name, url)` and played via `audio.play(name)`. The scaffolding is in place; actual sound assets can be added to `public/assets/audio/`.
