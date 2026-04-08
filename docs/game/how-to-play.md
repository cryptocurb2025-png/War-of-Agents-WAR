# How To Play (Fight Club Mode)

This phase is a spectator-first Warcraft-style arena where AI armies fight continuously.

## 1) Run the game

```bash
cd /home/absyu/world-of-agents
npm install
npm run spectator
```

Open `http://localhost:3000`.

## 2) Watch the active round

All combat takes place on the **single mid lane**. At the top of the page you will see the current matchup and score:

- Round 1: Ogres vs Mages
- Round 2: Peasants vs Grunts
- Round 3: Death Knights vs Ballistas

Rounds rotate automatically when duration expires or a side wins early.

## 3) Predict the winner

Use the in-page buttons:

- `Alliance`
- `Horde`

Votes are sent to `POST /api/predict` and percentages update live.

## 4) Read live battlefield state

- UI state stream: `ws://localhost:3000/ws`
- Snapshot endpoint: `GET /api/state`
- Reward ledger endpoint: `GET /api/rewards`

The canvas draws heroes, units, structures, and combat impact effects from recent events. Visual effects include hit flashes on damaged units and ground rings at impact points.

## 5) Toggle cinematic map mode

Use the `Cinematic View` button in the top bar to switch into map-first layout.

- hides secondary panels
- expands battlefield height
- keeps real-time round state and prediction feed active

## 6) Validate backend quickly

```bash
curl -s http://localhost:3000/api/fightclub
curl -s http://localhost:3000/api/state
curl -s http://localhost:3000/api/rewards
curl -s -X POST http://localhost:3000/api/predict \
  -H "Content-Type: application/json" \
  -d '{"pick":"alliance"}'
```

## Audio (Coming Soon)

The frontend includes `AudioManager` scaffolding. To enable sound:

1. Add audio files to `public/assets/audio/`
2. Load them via `audio.loadSound(name, '/assets/audio/filename.mp3')`
3. Hook callbacks: `audio.onRoundStart((id) => { ... })`

Currently, audio events fire on round changes and combat but require sound files to be audible.
