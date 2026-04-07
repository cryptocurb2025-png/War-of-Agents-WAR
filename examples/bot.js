/**
 * War of Agents — JavaScript Agent Bot Example
 * Connects to the game server, registers a hero, and plays autonomously.
 *
 * Usage:
 *   npm install ws
 *   node bot.js
 */

const WebSocket = require('ws');
const http = require('http');
const https = require('https');

const SERVER = process.env.SERVER || 'http://localhost:3001';
const WS_SERVER = SERVER.replace('http', 'ws');

const AGENT_ID = `js-bot-${Math.floor(Math.random() * 9000) + 1000}`;
const AGENT_NAME = 'JSBot';
const FACTION = Math.random() > 0.5 ? 'alliance' : 'horde';
const HERO_CLASS = ['knight', 'ranger', 'mage', 'priest', 'siegemaster'][Math.floor(Math.random() * 5)];

let gameState = null;

// ─── HTTP helpers ────────────────────────────────────────────
function post(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER);
    const mod = url.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = mod.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Register ────────────────────────────────────────────────
async function register() {
  const res = await post('/api/agents/register', {
    agentId: AGENT_ID,
    name: AGENT_NAME,
    faction: FACTION,
    heroClass: HERO_CLASS,
  });
  if (res.success) {
    console.log(`Registered: ${AGENT_NAME} (${FACTION} ${HERO_CLASS}) -> ${res.heroId}`);
  } else {
    console.error('Registration failed:', res);
    process.exit(1);
  }
}

// ─── Find our hero ───────────────────────────────────────────
function getMyHero() {
  if (!gameState) return null;
  return gameState.heroes.find(h => h.agentId === AGENT_ID) || null;
}

// ─── Deploy command ──────────────────────────────────────────
async function deploy(action, extra = {}) {
  return post('/api/strategy/deployment', { agentId: AGENT_ID, action, ...extra });
}

// ─── Find nearest enemy ─────────────────────────────────────
function findNearestEnemy(hero) {
  let best = null, bestDist = Infinity;
  const check = (list) => {
    for (const e of list) {
      if (e.faction === FACTION || !e.alive) continue;
      const dx = e.x - hero.x, dy = e.y - hero.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; best = e; }
    }
  };
  check(gameState.units || []);
  check(gameState.heroes || []);
  return { enemy: best, dist: bestDist };
}

// ─── AI Think Loop ───────────────────────────────────────────
async function think() {
  const hero = getMyHero();
  if (!hero || !hero.alive) return;

  // Retreat if low HP
  if (hero.hp < hero.maxHp * 0.25) {
    const baseX = FACTION === 'alliance' ? 150 : 4650;
    await deploy('move', { targetX: baseX, targetY: 1200 });
    console.log(`[${AGENT_NAME}] Retreating! HP: ${hero.hp}/${hero.maxHp}`);
    return;
  }

  // Find nearest enemy
  const { enemy, dist } = findNearestEnemy(hero);

  if (enemy) {
    await deploy('move', { targetX: enemy.x, targetY: enemy.y });

    // Use abilities
    for (const ab of (hero.abilities || [])) {
      if (ab.cd === 0) {
        await deploy('ability', { abilityId: ab.id });
        console.log(`[${AGENT_NAME}] Cast ${ab.name}!`);
        break;
      }
    }
  }

  // Buy items
  if (hero.gold >= 300) {
    for (const itemId of ['boots', 'sword', 'shield', 'cloak', 'relic']) {
      const res = await deploy('buy', { itemId });
      if (res.success) {
        console.log(`[${AGENT_NAME}] Bought ${res.item || itemId}!`);
        break;
      }
    }
  }
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log('=== War of Agents — JS Bot ===');
  console.log(`Server: ${SERVER}`);

  await register();

  // WebSocket for state updates
  const ws = new WebSocket(WS_SERVER);
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'state') gameState = msg.data;
  });
  ws.on('open', () => console.log('WebSocket connected'));
  ws.on('error', (e) => console.error('WS error:', e.message));

  // Wait for first state
  await new Promise(r => setTimeout(r, 1500));

  console.log(`Bot running as ${FACTION} ${HERO_CLASS}...`);

  // Think loop every second
  setInterval(async () => {
    try { await think(); } catch (e) { console.error('Error:', e.message); }
  }, 1000);
}

main();
