#!/usr/bin/env node
/**
 * War of Agents — stress test
 *
 * Spawns N concurrent fake players, registers them, fires moves and
 * ability casts for a duration, then checks the queue is healthy and
 * the server hasn't fallen over.
 *
 * Usage:
 *   SERVER=http://localhost:3001 NUM_PLAYERS=30 DURATION_SEC=60 node scripts/stress-test.js
 *   SERVER=https://web-production-fe1a24.up.railway.app NUM_PLAYERS=30 node scripts/stress-test.js
 */

const http = require('http');
const https = require('https');

const SERVER = process.env.SERVER || 'http://localhost:3001';
const NUM_PLAYERS = parseInt(process.env.NUM_PLAYERS || '30', 10);
const DURATION_SEC = parseInt(process.env.DURATION_SEC || '60', 10);
const HEROES = ['knight', 'ranger', 'mage', 'priest', 'siegemaster'];

const stats = {
  registered: 0,
  inMatch: 0,
  queued: 0,
  moveOk: 0,
  moveErr: 0,
  abilityOk: 0,
  abilityErr: 0,
  heartbeats: 0,
  leaves: 0,
};

function req(method, path, body) {
  return new Promise((resolve) => {
    const url = new URL(path, SERVER);
    const mod = url.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const headers = data
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      : {};
    const r = mod.request(url, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    r.on('error', () => resolve({ status: 0, data: null }));
    if (data) r.write(data);
    r.end();
  });
}

async function spawnPlayer(i) {
  const agentId = `stress_${i}_${Date.now()}`;
  const name = `@stress${i}`;
  const faction = i % 2 === 0 ? 'alliance' : 'horde';
  const heroClass = HEROES[i % HEROES.length];

  const reg = await req('POST', '/api/agents/register', { agentId, name, faction, heroClass });
  if (!reg.data || !reg.data.success) {
    console.error(`  [${agentId}] register failed:`, reg.data);
    return null;
  }
  stats.registered++;
  if (reg.data.queued) stats.queued++;
  else stats.inMatch++;

  return { agentId, faction, heroClass, queued: !!reg.data.queued };
}

// Class -> first ability IDs for valid casts
const CLASS_ABILITY = {
  knight: 'shield_bash', ranger: 'power_shot', mage: 'fireball',
  priest: 'heal', siegemaster: 'cannon',
};

async function actionLoop(player, deadline) {
  while (Date.now() < deadline) {
    // Heartbeat — works whether in match or queued
    const hb = await req('POST', '/api/heartbeat', { agentId: player.agentId });
    if (hb.data && hb.data.success) stats.heartbeats++;
    const inMatch = hb.data && hb.data.inMatch;

    if (inMatch) {
      // Random move
      const tx = 200 + Math.random() * 4400;
      const ty = 200 + Math.random() * 2000;
      const mv = await req('POST', '/api/strategy/deployment', {
        agentId: player.agentId, action: 'move', targetX: tx, targetY: ty,
      });
      if (mv.data && mv.data.success) stats.moveOk++; else stats.moveErr++;

      // Cast a valid ability for our class every other iteration
      if (Math.random() < 0.5) {
        const abId = CLASS_ABILITY[player.heroClass];
        const ab = await req('POST', '/api/strategy/deployment', {
          agentId: player.agentId, action: 'ability', abilityId: abId,
        });
        if (ab.data && ab.data.success) stats.abilityOk++; else stats.abilityErr++;
      }
    }

    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  War of Agents stress test');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Server     : ${SERVER}`);
  console.log(`  Players    : ${NUM_PLAYERS}`);
  console.log(`  Duration   : ${DURATION_SEC}s`);
  console.log('───────────────────────────────────────────────────────');

  // Initial state
  const before = await req('GET', '/api/queue/status');
  console.log('  Before     :', JSON.stringify(before.data));

  // Spawn all players in parallel
  console.log(`\n[1/3] Registering ${NUM_PLAYERS} players...`);
  const players = (await Promise.all(
    Array.from({ length: NUM_PLAYERS }, (_, i) => spawnPlayer(i))
  )).filter(Boolean);
  console.log(`  Registered: ${stats.registered}  In-match: ${stats.inMatch}  Queued: ${stats.queued}`);

  // Action loop
  console.log(`\n[2/3] Running action loop for ${DURATION_SEC}s...`);
  const deadline = Date.now() + DURATION_SEC * 1000;
  await Promise.all(players.map((p) => actionLoop(p, deadline)));

  // Stats during run
  const mid = await req('GET', '/api/queue/status');
  console.log('  Mid-run    :', JSON.stringify(mid.data));

  // Leave all players
  console.log(`\n[3/3] Leaving ${players.length} players...`);
  await Promise.all(players.map((p) =>
    req('POST', '/api/agents/leave', { agentId: p.agentId }).then(() => stats.leaves++)
  ));

  const after = await req('GET', '/api/queue/status');
  const stateAfter = await req('GET', '/api/admin/stats');

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Results');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Registered     : ${stats.registered}`);
  console.log(`  In match       : ${stats.inMatch}`);
  console.log(`  Queued         : ${stats.queued}`);
  console.log(`  Move OK / err  : ${stats.moveOk} / ${stats.moveErr}`);
  console.log(`  Ability OK/err : ${stats.abilityOk} / ${stats.abilityErr}`);
  console.log(`  Heartbeats     : ${stats.heartbeats}`);
  console.log(`  Leaves         : ${stats.leaves}`);
  console.log('───────────────────────────────────────────────────────');
  console.log('  Final queue    :', JSON.stringify(after.data));
  console.log('  Server stats   :', JSON.stringify(stateAfter.data));

  // Health check: slots should be back to 0/5 after everyone left
  const slotsClean =
    after.data.slots.alliance.used === 0 && after.data.slots.horde.used === 0;
  const queueClean = after.data.queueLength === 0;
  // Move success rate among in-match attempts should be high.
  // Some moves will fail because the player respawned mid-loop or got swept.
  const moveTotal = stats.moveOk + stats.moveErr;
  const moveRate = moveTotal > 0 ? stats.moveOk / moveTotal : 1;

  if (slotsClean && queueClean && moveRate >= 0.9 && stats.heartbeats > NUM_PLAYERS) {
    console.log('\n  ✅ PASS — slots cleaned up, queue empty, move success rate ' +
      Math.round(moveRate * 100) + '%, ' + stats.heartbeats + ' heartbeats acked');
    process.exit(0);
  } else {
    console.log('\n  ❌ FAIL —',
      !slotsClean ? 'slots not clean' :
      !queueClean ? 'queue not clean' :
      moveRate < 0.9 ? 'move rate ' + Math.round(moveRate * 100) + '% < 90%' :
      'heartbeats too low');
    process.exit(1);
  }
}

main().catch((e) => { console.error('Stress test crashed:', e); process.exit(2); });
