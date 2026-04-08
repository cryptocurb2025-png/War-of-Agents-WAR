/**
 * GameState Module - World of Agents Phase 3
 * Central game state management
 */

import { createAllLanes, assignHeroToLane, getLaneStatus, LANE_NAMES } from "./Lane.js";
import { createAllTowers, getAllTowerStatus } from "./Tower.js";
import { createStrongholds, getStrongholdStatus, checkVictory } from "./Stronghold.js";

export function createGameState(gameId = null) {
  return {
    gameId: gameId || `game_${Date.now()}`,
    tick: 0,
    phase: "active", // waiting, active, ended
    lanes: createAllLanes(),
    towers: createAllTowers(),
    strongholds: createStrongholds(),
    heroes: {
      alliance: [],
      horde: [],
    },
    events: [],
    winner: null,
    startedAt: new Date().toISOString(),
  };
}

export function addHeroToGame(gameState, hero, faction, lane = "mid") {
  hero.faction = faction;
  hero.lane = lane;
  
  gameState.heroes[faction].push(hero);
  assignHeroToLane(gameState.lanes, hero, lane, faction);
  
  logEvent(gameState, "hero_joined", {
    hero: hero.name,
    faction,
    lane,
    class: hero.class,
  });
}

export function moveHeroToLane(gameState, hero, newLane) {
  const oldLane = hero.lane;
  
  if (oldLane === newLane) return false;
  if (!LANE_NAMES.includes(newLane)) return false;
  
  assignHeroToLane(gameState.lanes, hero, newLane, hero.faction);
  
  logEvent(gameState, "hero_moved", {
    hero: hero.name,
    from: oldLane,
    to: newLane,
  });
  
  return true;
}

export function logEvent(gameState, type, data) {
  const event = {
    tick: gameState.tick,
    type,
    ...data,
  };
  
  gameState.events.push(event);
  
  // Keep only last 50 events
  if (gameState.events.length > 50) {
    gameState.events.shift();
  }
}

export function advanceTick(gameState) {
  gameState.tick++;
}

export function setWinner(gameState, winner) {
  gameState.winner = winner;
  gameState.phase = "ended";
  
  logEvent(gameState, "game_over", {
    winner,
    tick: gameState.tick,
  });
}

export function getFullGameStatus(gameState) {
  const laneStatuses = {};
  for (const laneName of LANE_NAMES) {
    laneStatuses[laneName] = getLaneStatus(gameState.lanes[laneName]);
    // Add a compact unit snapshot for rendering (cap payload size).
    const lane = gameState.lanes[laneName];
    laneStatuses[laneName].units = {
      alliance: lane.units.alliance.slice(-30).map((u) => ({ pos: u.pos, hp: u.hp, type: u.type })),
      horde: lane.units.horde.slice(-30).map((u) => ({ pos: u.pos, hp: u.hp, type: u.type })),
    };
  }
  
  return {
    gameId: gameState.gameId,
    tick: gameState.tick,
    phase: gameState.phase,
    lanes: laneStatuses,
    towers: getAllTowerStatus(gameState.towers),
    strongholds: {
      alliance: getStrongholdStatus(gameState.strongholds.alliance),
      horde: getStrongholdStatus(gameState.strongholds.horde),
    },
    heroes: {
      alliance: gameState.heroes.alliance.map(h => ({
        name: h.name,
        class: h.class,
        lane: h.lane,
        hp: h.hp,
        maxHp: h.maxHp,
        mana: h.mana,
        maxMana: h.maxMana,
        gold: h.gold,
        alive: h.hp > 0,
      })),
      horde: gameState.heroes.horde.map(h => ({
        name: h.name,
        class: h.class,
        lane: h.lane,
        hp: h.hp,
        maxHp: h.maxHp,
        mana: h.mana,
        maxMana: h.maxMana,
        gold: h.gold,
        alive: h.hp > 0,
      })),
    },
    recentEvents: gameState.events.slice(-10),
    winner: gameState.winner,
  };
}

export function printGameStatus(gameState) {
  const status = getFullGameStatus(gameState);
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`GAME: ${status.gameId} | Tick: ${status.tick} | Phase: ${status.phase}`);
  console.log("=".repeat(60));
  
  // Strongholds
  const aBase = status.strongholds.alliance;
  const hBase = status.strongholds.horde;
  console.log(`\nSTRONGHOLDS:`);
  console.log(`  Alliance: ${aBase.hp}/${aBase.maxHp} HP (${aBase.condition})`);
  console.log(`  Horde:    ${hBase.hp}/${hBase.maxHp} HP (${hBase.condition})`);
  
  // Lanes
  console.log(`\nLANES:`);
  for (const laneName of LANE_NAMES) {
    const lane = status.lanes[laneName];
    const frontlineBar = renderFrontline(lane.frontline);
    console.log(`  ${lane.name}: ${frontlineBar} [${lane.status}]`);
    console.log(`    Alliance: Power ${lane.alliance.power} | Hero: ${lane.alliance.hero || "none"}`);
    console.log(`    Horde:    Power ${lane.horde.power} | Hero: ${lane.horde.hero || "none"}`);
  }
  
  // Towers
  const aliveTowers = status.towers.filter(t => t.alive);
  const allianceTowers = aliveTowers.filter(t => t.faction === "alliance").length;
  const hordeTowers = aliveTowers.filter(t => t.faction === "horde").length;
  console.log(`\nTOWERS: Alliance ${allianceTowers}/6 | Horde ${hordeTowers}/6`);
  
  // Heroes
  console.log(`\nHEROES:`);
  for (const faction of ["alliance", "horde"]) {
    for (const hero of status.heroes[faction]) {
      const hpBar = renderHpBar(hero.hp, hero.maxHp);
      console.log(`  [${faction.toUpperCase()}] ${hero.name} (${hero.class}) @ ${hero.lane}`);
      console.log(`    HP: ${hpBar} ${hero.hp}/${hero.maxHp} | Mana: ${hero.mana}/${hero.maxMana} | Gold: ${hero.gold}`);
    }
  }
  
  if (status.winner) {
    console.log(`\n${"*".repeat(60)}`);
    console.log(`  VICTORY: ${status.winner.toUpperCase()}!`);
    console.log("*".repeat(60));
  }
}

function renderFrontline(frontline) {
  // Render a visual bar: [A====|====H]
  const width = 20;
  const center = Math.floor(width / 2);
  const position = Math.round(((frontline + 100) / 200) * width);
  
  let bar = "";
  for (let i = 0; i < width; i++) {
    if (i === position) bar += "|";
    else if (i < center) bar += "-";
    else bar += "-";
  }
  
  return `[A${bar}H]`;
}

function renderHpBar(hp, maxHp) {
  const width = 10;
  const filled = Math.round((hp / maxHp) * width);
  return "[" + "#".repeat(filled) + ".".repeat(width - filled) + "]";
}
