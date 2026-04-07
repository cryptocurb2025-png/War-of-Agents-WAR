import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import Database from 'better-sqlite3';

// ─── Constants ───────────────────────────────────────────────────────────────
const PORT = 3001;
const TICK_RATE = 20;
const BROADCAST_RATE = 10;
const MAP_W = 4800;
const MAP_H = 2400;
const TICK_MS = 1000 / TICK_RATE;
const BROADCAST_MS = 1000 / BROADCAST_RATE;
const DAY_NIGHT_CYCLE = 120_000; // 2 min full cycle
const LANE_MIN_Y = MAP_H / 2 - 160;
const LANE_MAX_Y = MAP_H / 2 + 160;

// ─── Types ───────────────────────────────────────────────────────────────────
type Faction = 'alliance' | 'horde';
type HeroClass = 'knight' | 'ranger' | 'mage' | 'priest' | 'siegemaster';
type Phase = 'day' | 'night';

interface Position { x: number; y: number; }

interface Ability {
  id: string;
  name: string;
  cooldown: number;
  currentCd: number;
  damage: number;
  range: number;
  tier: number;
  maxTier: number;
  manaCost: number;
  aoe: number;
  effect?: string;
}

interface Item {
  id: string;
  name: string;
  cost: number;
  stats: Partial<{ hp: number; damage: number; armor: number; speed: number; mana: number; regen: number }>;
}

interface Entity {
  id: string;
  type: string;
  faction: Faction;
  pos: Position;
  hp: number;
  maxHp: number;
  damage: number;
  armor: number;
  speed: number;
  range: number;
  target: string | null;
  alive: boolean;
  attackCd: number;
  currentAttackCd: number;
}

interface HeroEntity extends Entity {
  heroClass: HeroClass;
  level: number;
  xp: number;
  xpToNext: number;
  mana: number;
  maxMana: number;
  gold: number;
  kills: number;
  deaths: number;
  assists: number;
  killStreak: number;
  abilities: Ability[];
  items: Item[];
  respawnTimer: number;
  agentId: string | null;
  lastDamagedBy: string[];
}

interface Structure extends Entity {
  structureType: 'tower_t1' | 'tower_t2' | 'barracks' | 'base';
  tier: number;
}

interface UnitEntity extends Entity {
  unitType: string;
  wave: number;
}

interface GameState {
  tick: number;
  time: number;
  phase: Phase;
  dayNightTimer: number;
  heroes: Map<string, HeroEntity>;
  units: Map<string, UnitEntity>;
  structures: Map<string, Structure>;
  projectiles: Projectile[];
  kills: KillEvent[];
  winner: Faction | null;
  waveTimer: number;
  waveCount: number;
}

interface Projectile {
  id: string;
  from: Position;
  to: Position;
  progress: number;
  speed: number;
  damage: number;
  sourceId: string;
  targetId: string;
  faction: Faction;
  color: string;
}

interface KillEvent {
  tick: number;
  killerId: string;
  victimId: string;
  isRampage: boolean;
  bounty: number;
}

interface AgentRegistration {
  agentId: string;
  name: string;
  faction: Faction;
  heroClass: HeroClass;
  joinedAt: number;
}

// ─── Database ────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, '..', 'war_of_agents.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    faction TEXT NOT NULL,
    hero_class TEXT NOT NULL,
    joined_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leaderboard (
    agent_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    faction TEXT NOT NULL,
    hero_class TEXT NOT NULL,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    gold_earned INTEGER DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    elo INTEGER DEFAULT 1200,
    FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    started_at INTEGER,
    ended_at INTEGER,
    winner TEXT,
    status TEXT DEFAULT 'in_progress'
  );
  CREATE TABLE IF NOT EXISTS replay_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    tick INTEGER,
    snapshot TEXT,
    timestamp INTEGER
  );
  CREATE TABLE IF NOT EXISTS match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    kills INTEGER,
    deaths INTEGER,
    assists INTEGER,
    gold INTEGER,
    result TEXT,
    timestamp INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
  );
`);

const stmtInsertAgent = db.prepare(`INSERT OR REPLACE INTO agents VALUES (?,?,?,?,?)`);
const stmtUpsertLeaderboard = db.prepare(`
  INSERT INTO leaderboard (agent_id, name, faction, hero_class, kills, deaths, assists, gold_earned, games_played, wins)
  VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0)
  ON CONFLICT(agent_id) DO UPDATE SET name=excluded.name
`);
const stmtUpdateStats = db.prepare(`
  UPDATE leaderboard SET kills=kills+?, deaths=deaths+?, assists=assists+?, gold_earned=gold_earned+?, games_played=games_played+?, wins=wins+?
  WHERE agent_id=?
`);
const stmtGetLeaderboard = db.prepare(`SELECT * FROM leaderboard ORDER BY kills DESC, deaths ASC LIMIT 50`);
const stmtGetAgent = db.prepare(`SELECT * FROM leaderboard WHERE agent_id=?`);
const stmtUpdateElo = db.prepare(`UPDATE leaderboard SET elo=? WHERE agent_id=?`);
const stmtGetElo = db.prepare(`SELECT elo FROM leaderboard WHERE agent_id=?`);
const stmtInsertMatch = db.prepare(`INSERT INTO matches (id, started_at, status) VALUES (?, ?, 'in_progress')`);
const stmtEndMatch = db.prepare(`UPDATE matches SET ended_at=?, winner=?, status='completed' WHERE id=?`);
const stmtInsertSnapshot = db.prepare(`INSERT INTO replay_snapshots (match_id, tick, snapshot, timestamp) VALUES (?, ?, ?, ?)`);
const stmtGetMatches = db.prepare(`SELECT * FROM matches ORDER BY started_at DESC LIMIT 50`);
const stmtGetReplaySnapshots = db.prepare(`SELECT tick, snapshot, timestamp FROM replay_snapshots WHERE match_id=? ORDER BY tick ASC`);

// ─── ELO Rating System ─────────────────────────────────────────────────────
function calculateElo(winnerElo: number, loserElo: number): { newWinner: number; newLoser: number } {
  const K = 32;
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));
  return {
    newWinner: Math.round(winnerElo + K * (1 - expectedWinner)),
    newLoser: Math.round(loserElo + K * (0 - expectedLoser)),
  };
}

function updateEloOnKill(killerAgentId: string, victimAgentId: string) {
  const killerRow = stmtGetElo.get(killerAgentId) as { elo: number } | undefined;
  const victimRow = stmtGetElo.get(victimAgentId) as { elo: number } | undefined;
  if (!killerRow || !victimRow) return;
  const { newWinner, newLoser } = calculateElo(killerRow.elo, victimRow.elo);
  stmtUpdateElo.run(newWinner, killerAgentId);
  stmtUpdateElo.run(Math.max(0, newLoser), victimAgentId);
}

// ─── Item Shop ───────────────────────────────────────────────────────────────
const SHOP_ITEMS: Item[] = [
  { id: 'boots',  name: 'Swift Boots',    cost: 150, stats: { speed: 30 } },
  { id: 'sword',  name: 'Battle Blade',   cost: 300, stats: { damage: 15 } },
  { id: 'shield', name: 'Iron Buckler',   cost: 250, stats: { armor: 8, hp: 100 } },
  { id: 'cloak',  name: 'Shadow Cloak',   cost: 200, stats: { armor: 4, speed: 15, mana: 50 } },
  { id: 'relic',  name: 'Ancient Relic',   cost: 500, stats: { damage: 25, hp: 200, mana: 100, regen: 5 } },
];

// ─── Hero Class Definitions ─────────────────────────────────────────────────
function createAbilities(heroClass: HeroClass): Ability[] {
  const base: Record<HeroClass, Ability[]> = {
    knight: [
      { id: 'shield_bash', name: 'Shield Bash', cooldown: 60, currentCd: 0, damage: 35, range: 80, tier: 1, maxTier: 5, manaCost: 15, aoe: 0, effect: 'stun' },
      { id: 'charge', name: 'Charge', cooldown: 100, currentCd: 0, damage: 50, range: 250, tier: 1, maxTier: 5, manaCost: 25, aoe: 0, effect: 'dash' },
      { id: 'whirlwind', name: 'Whirlwind', cooldown: 80, currentCd: 0, damage: 40, range: 120, tier: 1, maxTier: 5, manaCost: 30, aoe: 120, effect: 'spin' },
      { id: 'fortify', name: 'Fortify', cooldown: 200, currentCd: 0, damage: 0, range: 0, tier: 1, maxTier: 5, manaCost: 40, aoe: 0, effect: 'armor_buff' },
      { id: 'rally', name: 'Battle Rally', cooldown: 300, currentCd: 0, damage: 0, range: 300, tier: 1, maxTier: 5, manaCost: 60, aoe: 300, effect: 'team_buff' },
    ],
    ranger: [
      { id: 'power_shot', name: 'Power Shot', cooldown: 40, currentCd: 0, damage: 55, range: 400, tier: 1, maxTier: 5, manaCost: 15, aoe: 0 },
      { id: 'multi_shot', name: 'Multi Shot', cooldown: 70, currentCd: 0, damage: 30, range: 350, tier: 1, maxTier: 5, manaCost: 25, aoe: 100 },
      { id: 'trap', name: 'Bear Trap', cooldown: 120, currentCd: 0, damage: 20, range: 200, tier: 1, maxTier: 5, manaCost: 20, aoe: 60, effect: 'slow' },
      { id: 'eagle_eye', name: 'Eagle Eye', cooldown: 150, currentCd: 0, damage: 80, range: 500, tier: 1, maxTier: 5, manaCost: 35, aoe: 0, effect: 'crit' },
      { id: 'rain_arrows', name: 'Rain of Arrows', cooldown: 250, currentCd: 0, damage: 45, range: 400, tier: 1, maxTier: 5, manaCost: 55, aoe: 200 },
    ],
    mage: [
      { id: 'fireball', name: 'Fireball', cooldown: 50, currentCd: 0, damage: 65, range: 350, tier: 1, maxTier: 5, manaCost: 20, aoe: 80, effect: 'burn' },
      { id: 'frost_bolt', name: 'Frost Bolt', cooldown: 45, currentCd: 0, damage: 40, range: 300, tier: 1, maxTier: 5, manaCost: 15, aoe: 0, effect: 'slow' },
      { id: 'arcane_blast', name: 'Arcane Blast', cooldown: 60, currentCd: 0, damage: 75, range: 250, tier: 1, maxTier: 5, manaCost: 30, aoe: 100 },
      { id: 'blink', name: 'Blink', cooldown: 100, currentCd: 0, damage: 0, range: 300, tier: 1, maxTier: 5, manaCost: 25, aoe: 0, effect: 'teleport' },
      { id: 'meteor', name: 'Meteor Storm', cooldown: 300, currentCd: 0, damage: 120, range: 400, tier: 1, maxTier: 5, manaCost: 80, aoe: 250 },
    ],
    priest: [
      { id: 'heal', name: 'Holy Light', cooldown: 40, currentCd: 0, damage: -60, range: 300, tier: 1, maxTier: 5, manaCost: 20, aoe: 0, effect: 'heal' },
      { id: 'smite', name: 'Holy Smite', cooldown: 50, currentCd: 0, damage: 45, range: 300, tier: 1, maxTier: 5, manaCost: 15, aoe: 0 },
      { id: 'shield_aura', name: 'Divine Shield', cooldown: 150, currentCd: 0, damage: 0, range: 0, tier: 1, maxTier: 5, manaCost: 35, aoe: 0, effect: 'invuln' },
      { id: 'mass_heal', name: 'Mass Heal', cooldown: 200, currentCd: 0, damage: -80, range: 350, tier: 1, maxTier: 5, manaCost: 60, aoe: 300, effect: 'heal' },
      { id: 'resurrection', name: 'Resurrection', cooldown: 400, currentCd: 0, damage: 0, range: 200, tier: 1, maxTier: 5, manaCost: 100, aoe: 0, effect: 'revive' },
    ],
    siegemaster: [
      { id: 'cannon', name: 'Cannon Shot', cooldown: 60, currentCd: 0, damage: 70, range: 400, tier: 1, maxTier: 5, manaCost: 20, aoe: 100 },
      { id: 'mortar', name: 'Mortar Barrage', cooldown: 100, currentCd: 0, damage: 50, range: 500, tier: 1, maxTier: 5, manaCost: 35, aoe: 150 },
      { id: 'fortification', name: 'Fortification', cooldown: 150, currentCd: 0, damage: 0, range: 0, tier: 1, maxTier: 5, manaCost: 30, aoe: 0, effect: 'tower_buff' },
      { id: 'demolish', name: 'Demolish', cooldown: 80, currentCd: 0, damage: 100, range: 150, tier: 1, maxTier: 5, manaCost: 25, aoe: 0, effect: 'structure_dmg' },
      { id: 'siege_mode', name: 'Siege Mode', cooldown: 300, currentCd: 0, damage: 0, range: 0, tier: 1, maxTier: 5, manaCost: 50, aoe: 0, effect: 'transform' },
    ],
  };
  return base[heroClass];
}

function heroBaseStats(hc: HeroClass): { hp: number; mana: number; damage: number; armor: number; speed: number; range: number } {
  const s: Record<HeroClass, any> = {
    knight:      { hp: 800, mana: 150, damage: 28, armor: 12, speed: 90,  range: 70 },
    ranger:      { hp: 550, mana: 200, damage: 35, armor: 5,  speed: 110, range: 350 },
    mage:        { hp: 480, mana: 350, damage: 42, armor: 3,  speed: 95,  range: 300 },
    priest:      { hp: 520, mana: 400, damage: 18, armor: 4,  speed: 100, range: 280 },
    siegemaster: { hp: 700, mana: 180, damage: 50, armor: 10, speed: 70,  range: 400 },
  };
  return s[hc];
}

// ─── Unit Definitions ────────────────────────────────────────────────────────
interface UnitDef {
  type: string;
  hp: number;
  damage: number;
  armor: number;
  speed: number;
  range: number;
}

const ALLIANCE_UNITS: UnitDef[] = [
  { type: 'footman',  hp: 300, damage: 18, armor: 6,  speed: 70, range: 60 },
  { type: 'archer',   hp: 200, damage: 22, armor: 2,  speed: 80, range: 300 },
  { type: 'gryphon',  hp: 400, damage: 30, armor: 4,  speed: 100, range: 150 },
  { type: 'ballista', hp: 350, damage: 45, armor: 8,  speed: 50, range: 400 },
];

const HORDE_UNITS: UnitDef[] = [
  { type: 'ironwarrior', hp: 350, damage: 20, armor: 8,  speed: 65, range: 60 },
  { type: 'shredder',    hp: 250, damage: 28, armor: 3,  speed: 90, range: 80 },
  { type: 'warlock',     hp: 220, damage: 35, armor: 2,  speed: 75, range: 280 },
  { type: 'colossus',    hp: 500, damage: 40, armor: 10, speed: 45, range: 120 },
];

// ─── Game State ──────────────────────────────────────────────────────────────
let idCounter = 0;
function nextId(prefix: string): string { return `${prefix}_${++idCounter}`; }

function dist(a: Position, b: Position): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function moveToward(pos: Position, target: Position, speed: number, dt: number): Position {
  const d = dist(pos, target);
  if (d < 2) return pos;
  const step = Math.min(speed * dt, d);
  return {
    x: Math.max(0, Math.min(MAP_W, pos.x + (target.x - pos.x) / d * step)),
    y: Math.max(LANE_MIN_Y, Math.min(LANE_MAX_Y, pos.y + (target.y - pos.y) / d * step)),
  };
}

let currentMatchId = `match_${Date.now()}`;
let paused = false;
const serverStartTime = Date.now();

const state: GameState = {
  tick: 0,
  time: 0,
  phase: 'day',
  dayNightTimer: 0,
  heroes: new Map(),
  units: new Map(),
  structures: new Map(),
  projectiles: [],
  kills: [],
  winner: null,
  waveTimer: 0,
  waveCount: 0,
};

// ─── Structure Placement ─────────────────────────────────────────────────────
function initStructures() {
  // Alliance (left side)
  const aBase: Structure = {
    id: nextId('struct'), type: 'base', faction: 'alliance', pos: { x: 150, y: MAP_H / 2 },
    hp: 5000, maxHp: 5000, damage: 40, armor: 20, speed: 0, range: 250,
    target: null, alive: true, attackCd: 40, currentAttackCd: 0,
    structureType: 'base', tier: 0,
  };
  state.structures.set(aBase.id, aBase);

  const aBarracks: Structure = {
    id: nextId('struct'), type: 'barracks', faction: 'alliance', pos: { x: 500, y: MAP_H / 2 },
    hp: 2500, maxHp: 2500, damage: 0, armor: 15, speed: 0, range: 0,
    target: null, alive: true, attackCd: 0, currentAttackCd: 0,
    structureType: 'barracks', tier: 0,
  };
  state.structures.set(aBarracks.id, aBarracks);

  const aT2: Structure = {
    id: nextId('struct'), type: 'tower', faction: 'alliance', pos: { x: 900, y: MAP_H / 2 - 120 },
    hp: 2000, maxHp: 2000, damage: 55, armor: 18, speed: 0, range: 350,
    target: null, alive: true, attackCd: 30, currentAttackCd: 0,
    structureType: 'tower_t2', tier: 2,
  };
  state.structures.set(aT2.id, aT2);

  const aT1: Structure = {
    id: nextId('struct'), type: 'tower', faction: 'alliance', pos: { x: 1500, y: MAP_H / 2 + 120 },
    hp: 1500, maxHp: 1500, damage: 45, armor: 15, speed: 0, range: 300,
    target: null, alive: true, attackCd: 25, currentAttackCd: 0,
    structureType: 'tower_t1', tier: 1,
  };
  state.structures.set(aT1.id, aT1);

  // Horde (right side)
  const hBase: Structure = {
    id: nextId('struct'), type: 'base', faction: 'horde', pos: { x: MAP_W - 150, y: MAP_H / 2 },
    hp: 5000, maxHp: 5000, damage: 40, armor: 20, speed: 0, range: 250,
    target: null, alive: true, attackCd: 40, currentAttackCd: 0,
    structureType: 'base', tier: 0,
  };
  state.structures.set(hBase.id, hBase);

  const hBarracks: Structure = {
    id: nextId('struct'), type: 'barracks', faction: 'horde', pos: { x: MAP_W - 500, y: MAP_H / 2 },
    hp: 2500, maxHp: 2500, damage: 0, armor: 15, speed: 0, range: 0,
    target: null, alive: true, attackCd: 0, currentAttackCd: 0,
    structureType: 'barracks', tier: 0,
  };
  state.structures.set(hBarracks.id, hBarracks);

  const hT2: Structure = {
    id: nextId('struct'), type: 'tower', faction: 'horde', pos: { x: MAP_W - 900, y: MAP_H / 2 + 120 },
    hp: 2000, maxHp: 2000, damage: 55, armor: 18, speed: 0, range: 350,
    target: null, alive: true, attackCd: 30, currentAttackCd: 0,
    structureType: 'tower_t2', tier: 2,
  };
  state.structures.set(hT2.id, hT2);

  const hT1: Structure = {
    id: nextId('struct'), type: 'tower', faction: 'horde', pos: { x: MAP_W - 1500, y: MAP_H / 2 - 120 },
    hp: 1500, maxHp: 1500, damage: 45, armor: 15, speed: 0, range: 300,
    target: null, alive: true, attackCd: 25, currentAttackCd: 0,
    structureType: 'tower_t1', tier: 1,
  };
  state.structures.set(hT1.id, hT1);
}

// ─── Hero Factory ────────────────────────────────────────────────────────────
function createHero(faction: Faction, heroClass: HeroClass, agentId: string | null): HeroEntity {
  const stats = heroBaseStats(heroClass);
  const spawnX = faction === 'alliance' ? 200 + Math.random() * 100 : MAP_W - 300 + Math.random() * 100;
  const spawnY = LANE_MIN_Y + 20 + Math.random() * (LANE_MAX_Y - LANE_MIN_Y - 40);
  return {
    id: nextId('hero'),
    type: 'hero',
    faction,
    heroClass,
    pos: { x: spawnX, y: spawnY },
    hp: stats.hp, maxHp: stats.hp,
    mana: stats.mana, maxMana: stats.mana,
    damage: stats.damage, armor: stats.armor,
    speed: stats.speed, range: stats.range,
    target: null, alive: true,
    attackCd: 20, currentAttackCd: 0,
    level: 1, xp: 0, xpToNext: 100,
    gold: 300,
    kills: 0, deaths: 0, assists: 0,
    killStreak: 0,
    abilities: createAbilities(heroClass),
    items: [],
    respawnTimer: 0,
    agentId,
    lastDamagedBy: [],
  };
}

// ─── Wave Spawning ───────────────────────────────────────────────────────────
function spawnWave() {
  state.waveCount++;
  const scaling = 1 + state.waveCount * 0.05;

  // Alliance wave
  const aBarracks = [...state.structures.values()].find(s => s.faction === 'alliance' && s.structureType === 'barracks' && s.alive);
  if (aBarracks) {
    for (const def of ALLIANCE_UNITS) {
      for (let i = 0; i < 2; i++) {
        const u: UnitEntity = {
          id: nextId('unit'), type: 'unit', faction: 'alliance',
          pos: { x: aBarracks.pos.x + 50 + Math.random() * 40, y: aBarracks.pos.y - 60 + Math.random() * 120 },
          hp: Math.floor(def.hp * scaling), maxHp: Math.floor(def.hp * scaling),
          damage: Math.floor(def.damage * scaling), armor: def.armor,
          speed: def.speed, range: def.range,
          target: null, alive: true,
          attackCd: 20, currentAttackCd: 0,
          unitType: def.type, wave: state.waveCount,
        };
        state.units.set(u.id, u);
      }
    }
  }

  // Horde wave
  const hBarracks = [...state.structures.values()].find(s => s.faction === 'horde' && s.structureType === 'barracks' && s.alive);
  if (hBarracks) {
    for (const def of HORDE_UNITS) {
      for (let i = 0; i < 2; i++) {
        const u: UnitEntity = {
          id: nextId('unit'), type: 'unit', faction: 'horde',
          pos: { x: hBarracks.pos.x - 50 - Math.random() * 40, y: hBarracks.pos.y - 60 + Math.random() * 120 },
          hp: Math.floor(def.hp * scaling), maxHp: Math.floor(def.hp * scaling),
          damage: Math.floor(def.damage * scaling), armor: def.armor,
          speed: def.speed, range: def.range,
          target: null, alive: true,
          attackCd: 20, currentAttackCd: 0,
          unitType: def.type, wave: state.waveCount,
        };
        state.units.set(u.id, u);
      }
    }
  }
}

// ─── AI Bot Heroes ───────────────────────────────────────────────────────────
function spawnBotHeroes() {
  const classes: HeroClass[] = ['knight', 'ranger', 'mage', 'priest', 'siegemaster'];
  for (const hc of classes) {
    const aHero = createHero('alliance', hc, null);
    state.heroes.set(aHero.id, aHero);
    const hHero = createHero('horde', hc, null);
    state.heroes.set(hHero.id, hHero);
  }
}

// ─── Combat Logic ────────────────────────────────────────────────────────────
function findTarget(entity: Entity, allEntities: Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const e of allEntities) {
    if (!e.alive || e.faction === entity.faction) continue;
    const d = dist(entity.pos, e.pos);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return best;
}

function applyDamage(target: Entity, rawDmg: number, sourceId: string) {
  const reduction = target.armor / (target.armor + 50);
  const dmg = Math.max(1, Math.floor(rawDmg * (1 - reduction)));
  target.hp -= dmg;

  if (target.type === 'hero') {
    const hero = target as HeroEntity;
    if (!hero.lastDamagedBy.includes(sourceId)) {
      hero.lastDamagedBy.push(sourceId);
      if (hero.lastDamagedBy.length > 5) hero.lastDamagedBy.shift();
    }
  }

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    onKill(sourceId, target);
  }
}

function onKill(killerId: string, victim: Entity) {
  const killer = state.heroes.get(killerId) || [...state.heroes.values()].find(h => h.id === killerId);

  if (victim.type === 'hero') {
    const vHero = victim as HeroEntity;
    vHero.deaths++;
    const streakBounty = vHero.killStreak >= 3 ? vHero.killStreak * 50 : 0;
    vHero.killStreak = 0;
    vHero.respawnTimer = 100 + vHero.level * 20;

    if (killer && state.heroes.has(killer.id)) {
      const kHero = killer as HeroEntity;
      kHero.kills++;
      kHero.killStreak++;
      const baseGold = 200 + streakBounty;
      kHero.gold += baseGold;
      kHero.xp += 80 + vHero.level * 10;

      // Assists
      for (const dmgId of vHero.lastDamagedBy) {
        if (dmgId !== kHero.id) {
          const assister = state.heroes.get(dmgId);
          if (assister && assister.alive) {
            assister.assists++;
            assister.gold += 75;
            assister.xp += 40;
          }
        }
      }

      const isRampage = kHero.killStreak >= 5;
      state.kills.push({ tick: state.tick, killerId: kHero.id, victimId: vHero.id, isRampage, bounty: baseGold });

      // ELO update
      if (kHero.agentId && vHero.agentId) {
        updateEloOnKill(kHero.agentId, vHero.agentId);
      }
    }
    vHero.lastDamagedBy = [];
  } else if (victim.type === 'unit') {
    if (killer && state.heroes.has(killer.id)) {
      const kHero = killer as HeroEntity;
      kHero.gold += 25;
      kHero.xp += 20;
    }
  } else if ((victim as Structure).structureType === 'base') {
    // Game over
    state.winner = victim.faction === 'alliance' ? 'horde' : 'alliance';
    try {
      stmtEndMatch.run(Date.now(), state.winner, currentMatchId);
    } catch (_e) { /* ignore */ }
  }
}

function checkLevelUp(hero: HeroEntity) {
  while (hero.xp >= hero.xpToNext) {
    hero.xp -= hero.xpToNext;
    hero.level++;
    hero.xpToNext = Math.floor(hero.xpToNext * 1.4);
    hero.maxHp += 40;
    hero.hp = Math.min(hero.hp + 40, hero.maxHp);
    hero.maxMana += 20;
    hero.mana = Math.min(hero.mana + 20, hero.maxMana);
    hero.damage += 3;
    hero.armor += 1;

    // Upgrade a random ability tier
    const upgradeable = hero.abilities.filter(a => a.tier < a.maxTier);
    if (upgradeable.length > 0) {
      const ab = upgradeable[Math.floor(Math.random() * upgradeable.length)];
      ab.tier++;
      ab.damage = Math.floor(ab.damage * 1.2);
      ab.cooldown = Math.max(10, ab.cooldown - 5);
    }
  }
}

// ─── Hero AI (Bot Control) ──────────────────────────────────────────────────
function heroAI(hero: HeroEntity, dt: number) {
  if (!hero.alive) return;

  // Mana regen
  hero.mana = Math.min(hero.maxMana, hero.mana + 0.3);

  // HP regen
  hero.hp = Math.min(hero.maxHp, hero.hp + 0.1);

  const allEntities: Entity[] = [
    ...[...state.heroes.values()].filter(h => h.alive),
    ...[...state.units.values()].filter(u => u.alive),
    ...[...state.structures.values()].filter(s => s.alive),
  ];

  const target = findTarget(hero, allEntities);
  if (!target) return;

  const d = dist(hero.pos, target.pos);

  // Use abilities
  for (const ab of hero.abilities) {
    if (ab.currentCd > 0) { ab.currentCd--; continue; }
    if (hero.mana < ab.manaCost) continue;
    if (d > ab.range && ab.range > 0) continue;
    if (ab.effect === 'heal' && hero.hp > hero.maxHp * 0.6) continue;
    if (ab.effect === 'armor_buff' && hero.hp > hero.maxHp * 0.5) continue;

    hero.mana -= ab.manaCost;
    ab.currentCd = ab.cooldown;

    if (ab.effect === 'heal') {
      // Heal self or nearby ally
      const healTarget = hero.hp < hero.maxHp * 0.5 ? hero :
        [...state.heroes.values()].find(h => h.alive && h.faction === hero.faction && h.hp < h.maxHp * 0.5 && dist(h.pos, hero.pos) < ab.range) || hero;
      healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + Math.abs(ab.damage) * ab.tier);
    } else if (ab.effect === 'dash' || ab.effect === 'teleport') {
      hero.pos = moveToward(hero.pos, target.pos, ab.range * 0.8, 1);
    } else if (ab.aoe > 0) {
      // AOE damage
      for (const e of allEntities) {
        if (e.faction === hero.faction || !e.alive) continue;
        if (dist(target.pos, e.pos) < ab.aoe) {
          applyDamage(e, ab.damage * ab.tier, hero.id);
        }
      }
      state.projectiles.push({
        id: nextId('proj'), from: { ...hero.pos }, to: { ...target.pos },
        progress: 0, speed: 0.15, damage: 0, sourceId: hero.id, targetId: target.id,
        faction: hero.faction, color: hero.faction === 'alliance' ? '#4488ff' : '#ff4444',
      });
    } else {
      applyDamage(target, ab.damage * ab.tier, hero.id);
      state.projectiles.push({
        id: nextId('proj'), from: { ...hero.pos }, to: { ...target.pos },
        progress: 0, speed: 0.12, damage: 0, sourceId: hero.id, targetId: target.id,
        faction: hero.faction, color: hero.faction === 'alliance' ? '#66bbff' : '#ff6644',
      });
    }
    break;
  }

  // Move toward target or attack
  if (d > hero.range) {
    hero.pos = moveToward(hero.pos, target.pos, hero.speed, dt);
  } else {
    if (hero.currentAttackCd <= 0) {
      applyDamage(target, hero.damage, hero.id);
      hero.currentAttackCd = hero.attackCd;
      state.projectiles.push({
        id: nextId('proj'), from: { ...hero.pos }, to: { ...target.pos },
        progress: 0, speed: 0.1, damage: 0, sourceId: hero.id, targetId: target.id,
        faction: hero.faction, color: hero.faction === 'alliance' ? '#aaccff' : '#ffaa88',
      });
    }
  }

  if (hero.currentAttackCd > 0) hero.currentAttackCd--;

  // Auto-buy items
  if (hero.items.length < 5) {
    const affordable = SHOP_ITEMS.filter(item => item.cost <= hero.gold && !hero.items.find(i => i.id === item.id));
    if (affordable.length > 0) {
      const item = affordable[Math.floor(Math.random() * affordable.length)];
      hero.gold -= item.cost;
      hero.items.push(item);
      if (item.stats.hp) { hero.maxHp += item.stats.hp; hero.hp += item.stats.hp; }
      if (item.stats.damage) hero.damage += item.stats.damage;
      if (item.stats.armor) hero.armor += item.stats.armor;
      if (item.stats.speed) hero.speed += item.stats.speed;
      if (item.stats.mana) { hero.maxMana += item.stats.mana; hero.mana += item.stats.mana; }
    }
  }

  checkLevelUp(hero);
}

// ─── Unit AI ─────────────────────────────────────────────────────────────────
function unitAI(unit: UnitEntity, dt: number) {
  if (!unit.alive) return;

  const allEntities: Entity[] = [
    ...[...state.heroes.values()].filter(h => h.alive),
    ...[...state.units.values()].filter(u => u.alive),
    ...[...state.structures.values()].filter(s => s.alive),
  ];

  // Prioritize: units > heroes > structures
  let target: Entity | null = null;
  let bestDist = Infinity;

  // Enemy units first
  for (const e of state.units.values()) {
    if (!e.alive || e.faction === unit.faction) continue;
    const d = dist(unit.pos, e.pos);
    if (d < bestDist) { bestDist = d; target = e; }
  }

  // Then heroes
  if (!target || bestDist > 500) {
    for (const h of state.heroes.values()) {
      if (!h.alive || h.faction === unit.faction) continue;
      const d = dist(unit.pos, h.pos);
      if (d < bestDist) { bestDist = d; target = h; }
    }
  }

  // Then structures (push lane)
  if (!target || bestDist > 800) {
    for (const s of state.structures.values()) {
      if (!s.alive || s.faction === unit.faction) continue;
      const d = dist(unit.pos, s.pos);
      if (d < bestDist) { bestDist = d; target = s; }
    }
  }

  if (!target) {
    // March toward enemy base
    const baseX = unit.faction === 'alliance' ? MAP_W - 150 : 150;
    unit.pos = moveToward(unit.pos, { x: baseX, y: MAP_H / 2 }, unit.speed, dt);
    return;
  }

  const d = dist(unit.pos, target.pos);
  if (d > unit.range) {
    unit.pos = moveToward(unit.pos, target.pos, unit.speed, dt);
  } else {
    if (unit.currentAttackCd <= 0) {
      applyDamage(target, unit.damage, unit.id);
      unit.currentAttackCd = unit.attackCd;
    }
  }

  if (unit.currentAttackCd > 0) unit.currentAttackCd--;
}

// ─── Structure AI ────────────────────────────────────────────────────────────
function structureAI(struct: Structure) {
  if (!struct.alive || struct.damage === 0) return;

  const allEnemies: Entity[] = [
    ...[...state.heroes.values()].filter(h => h.alive && h.faction !== struct.faction),
    ...[...state.units.values()].filter(u => u.alive && u.faction !== struct.faction),
  ];

  let target: Entity | null = null;
  let bestDist = Infinity;
  for (const e of allEnemies) {
    const d = dist(struct.pos, e.pos);
    if (d < struct.range && d < bestDist) { bestDist = d; target = e; }
  }

  if (target && struct.currentAttackCd <= 0) {
    applyDamage(target, struct.damage, struct.id);
    struct.currentAttackCd = struct.attackCd;
    state.projectiles.push({
      id: nextId('proj'), from: { ...struct.pos }, to: { ...target.pos },
      progress: 0, speed: 0.08, damage: 0, sourceId: struct.id, targetId: target.id,
      faction: struct.faction, color: struct.faction === 'alliance' ? '#ffdd44' : '#ff4400',
    });
  }

  if (struct.currentAttackCd > 0) struct.currentAttackCd--;
}

// ─── Respawn ─────────────────────────────────────────────────────────────────
function handleRespawns() {
  for (const hero of state.heroes.values()) {
    if (!hero.alive) {
      hero.respawnTimer--;
      if (hero.respawnTimer <= 0) {
        hero.alive = true;
        hero.hp = hero.maxHp;
        hero.mana = hero.maxMana;
        hero.pos = {
          x: hero.faction === 'alliance' ? 200 + Math.random() * 100 : MAP_W - 300 + Math.random() * 100,
          y: MAP_H / 2 - 100 + Math.random() * 200,
        };
      }
    }
  }
}

// ─── Main Game Loop ──────────────────────────────────────────────────────────
function gameTick() {
  if (paused) return;
  if (state.winner) return;

  state.tick++;
  state.time += TICK_MS;
  const dt = TICK_MS / 1000;

  // Day/night
  state.dayNightTimer += TICK_MS;
  if (state.dayNightTimer >= DAY_NIGHT_CYCLE / 2) {
    state.dayNightTimer = 0;
    state.phase = state.phase === 'day' ? 'night' : 'day';
  }

  // Night buff for horde
  const nightMult = state.phase === 'night' ? 1.15 : 1.0;
  const dayMult = state.phase === 'day' ? 1.1 : 1.0;

  // Wave spawning every 30 seconds
  state.waveTimer += TICK_MS;
  if (state.waveTimer >= 30_000) {
    state.waveTimer = 0;
    spawnWave();
  }

  // Update heroes
  for (const hero of state.heroes.values()) {
    heroAI(hero, dt * (hero.faction === 'horde' ? nightMult : dayMult));
  }

  // Update units
  for (const unit of state.units.values()) {
    unitAI(unit, dt * (unit.faction === 'horde' ? nightMult : dayMult));
  }

  // Update structures
  for (const struct of state.structures.values()) {
    structureAI(struct);
  }

  // HARD CLAMP: force ALL units and heroes into lane bounds every tick
  for (const hero of state.heroes.values()) {
    hero.pos.y = Math.max(LANE_MIN_Y, Math.min(LANE_MAX_Y, hero.pos.y));
  }
  for (const unit of state.units.values()) {
    unit.pos.y = Math.max(LANE_MIN_Y, Math.min(LANE_MAX_Y, unit.pos.y));
  }

  // Update projectiles
  state.projectiles = state.projectiles.filter(p => {
    p.progress += p.speed;
    return p.progress < 1;
  });

  // Cleanup dead units
  for (const [id, unit] of state.units) {
    if (!unit.alive) state.units.delete(id);
  }

  // Trim old kills
  if (state.kills.length > 20) state.kills = state.kills.slice(-20);

  handleRespawns();

  // Save replay snapshot every 100 ticks
  if (state.tick % 100 === 0) {
    try {
      stmtInsertSnapshot.run(currentMatchId, state.tick, JSON.stringify(serializeState()), Date.now());
    } catch (_e) { /* ignore snapshot errors */ }
  }

  // Passive gold for heroes
  if (state.tick % 40 === 0) {
    for (const hero of state.heroes.values()) {
      if (hero.alive) hero.gold += 5;
    }
  }
}

// ─── Serialize State ─────────────────────────────────────────────────────────
function serializeState() {
  return {
    tick: state.tick,
    time: state.time,
    phase: state.phase,
    winner: state.winner,
    waveCount: state.waveCount,
    heroes: [...state.heroes.values()].map(h => ({
      id: h.id, faction: h.faction, heroClass: h.heroClass,
      x: Math.round(h.pos.x), y: Math.round(h.pos.y),
      hp: Math.round(h.hp), maxHp: h.maxHp,
      mana: Math.round(h.mana), maxMana: h.maxMana,
      level: h.level, gold: h.gold,
      kills: h.kills, deaths: h.deaths, assists: h.assists,
      killStreak: h.killStreak, alive: h.alive,
      damage: h.damage, armor: h.armor,
      items: h.items.map(i => i.name),
      abilities: h.abilities.map(a => ({ id: a.id, name: a.name, tier: a.tier, cd: a.currentCd })),
      agentId: h.agentId,
      respawnIn: h.alive ? 0 : h.respawnTimer,
    })),
    units: [...state.units.values()].map(u => ({
      id: u.id, faction: u.faction, unitType: u.unitType,
      x: Math.round(u.pos.x), y: Math.round(u.pos.y),
      hp: Math.round(u.hp), maxHp: u.maxHp, alive: u.alive,
    })),
    structures: [...state.structures.values()].map(s => ({
      id: s.id, faction: s.faction, structureType: s.structureType,
      x: Math.round(s.pos.x), y: Math.round(s.pos.y),
      hp: Math.round(s.hp), maxHp: s.maxHp, alive: s.alive, tier: s.tier,
    })),
    projectiles: state.projectiles.map(p => ({
      id: p.id, fx: Math.round(p.from.x), fy: Math.round(p.from.y),
      tx: Math.round(p.to.x), ty: Math.round(p.to.y),
      p: +p.progress.toFixed(2), color: p.color, faction: p.faction,
    })),
    kills: state.kills.slice(-5),
  };
}

// ─── Express + WebSocket ─────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set<WebSocket>();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
  // Send initial state
  ws.send(JSON.stringify({ type: 'state', data: serializeState() }));
});

function broadcast() {
  const msg = JSON.stringify({ type: 'state', data: serializeState() });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// ─── REST API ────────────────────────────────────────────────────────────────
app.post('/api/agents/register', (req, res) => {
  const { agentId, name, faction, heroClass } = req.body;
  if (!agentId || !name || !faction || !heroClass) {
    return res.status(400).json({ error: 'Missing required fields: agentId, name, faction, heroClass' });
  }
  if (!['alliance', 'horde'].includes(faction)) {
    return res.status(400).json({ error: 'Faction must be alliance or horde' });
  }
  if (!['knight', 'ranger', 'mage', 'priest', 'siegemaster'].includes(heroClass)) {
    return res.status(400).json({ error: 'Invalid heroClass' });
  }

  stmtInsertAgent.run(agentId, name, faction, heroClass, Date.now());
  stmtUpsertLeaderboard.run(agentId, name, faction, heroClass);

  const hero = createHero(faction as Faction, heroClass as HeroClass, agentId);
  state.heroes.set(hero.id, hero);

  res.json({ success: true, heroId: hero.id, message: `${name} joins the ${faction}!` });
});

app.get('/api/game/state', (_req, res) => {
  res.json(serializeState());
});

app.post('/api/strategy/deployment', (req, res) => {
  const { agentId, action, targetX, targetY, abilityId, itemId } = req.body;
  const hero = [...state.heroes.values()].find(h => h.agentId === agentId);
  if (!hero) return res.status(404).json({ error: 'Agent not registered or hero not found' });
  if (!hero.alive) return res.status(400).json({ error: 'Hero is dead, respawning...' });

  if (action === 'move' && targetX != null && targetY != null) {
    hero.target = null;
    hero.pos = moveToward(hero.pos, { x: targetX, y: targetY }, hero.speed * 5, 1);
    return res.json({ success: true, action: 'move' });
  }

  if (action === 'ability' && abilityId) {
    const ab = hero.abilities.find(a => a.id === abilityId);
    if (!ab) return res.status(400).json({ error: 'Unknown ability' });
    if (ab.currentCd > 0) return res.status(400).json({ error: 'Ability on cooldown', remainingCd: ab.currentCd });
    if (hero.mana < ab.manaCost) return res.status(400).json({ error: 'Not enough mana' });
    return res.json({ success: true, ability: ab.name, message: 'Ability will be cast on next available target' });
  }

  if (action === 'buy' && itemId) {
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return res.status(400).json({ error: 'Unknown item' });
    if (hero.gold < item.cost) return res.status(400).json({ error: 'Not enough gold' });
    if (hero.items.find(i => i.id === itemId)) return res.status(400).json({ error: 'Already owned' });
    hero.gold -= item.cost;
    hero.items.push(item);
    if (item.stats.hp) { hero.maxHp += item.stats.hp; hero.hp += item.stats.hp; }
    if (item.stats.damage) hero.damage += item.stats.damage;
    if (item.stats.armor) hero.armor += item.stats.armor;
    if (item.stats.speed) hero.speed += item.stats.speed;
    if (item.stats.mana) { hero.maxMana += item.stats.mana; hero.mana += item.stats.mana; }
    return res.json({ success: true, item: item.name, goldRemaining: hero.gold });
  }

  res.status(400).json({ error: 'Unknown action. Use: move, ability, buy' });
});

app.get('/api/leaderboard', (_req, res) => {
  const rows = stmtGetLeaderboard.all();
  res.json(rows);
});

app.get('/api/skill', (_req, res) => {
  res.json({
    heroClasses: ['knight', 'ranger', 'mage', 'priest', 'siegemaster'],
    items: SHOP_ITEMS,
    allianceUnits: ALLIANCE_UNITS.map(u => u.type),
    hordeUnits: HORDE_UNITS.map(u => u.type),
    abilities: {
      knight: createAbilities('knight').map(a => ({ id: a.id, name: a.name })),
      ranger: createAbilities('ranger').map(a => ({ id: a.id, name: a.name })),
      mage: createAbilities('mage').map(a => ({ id: a.id, name: a.name })),
      priest: createAbilities('priest').map(a => ({ id: a.id, name: a.name })),
      siegemaster: createAbilities('siegemaster').map(a => ({ id: a.id, name: a.name })),
    },
  });
});

app.get('/api/shop', (_req, res) => {
  res.json({ items: SHOP_ITEMS });
});

// ─── Match History & Replay API ─────────────────────────────────────────────
app.get('/api/matches', (_req, res) => {
  const rows = stmtGetMatches.all();
  res.json(rows);
});

app.get('/api/matches/:id/replay', (req, res) => {
  const rows = stmtGetReplaySnapshots.all(req.params.id);
  res.json(rows);
});

// ─── Admin Panel Routes ─────────────────────────────────────────────────────
function resetGame() {
  // Clear all entities
  state.heroes.clear();
  state.units.clear();
  state.structures.clear();
  state.projectiles = [];
  state.kills = [];
  state.winner = null;
  state.tick = 0;
  state.time = 0;
  state.waveTimer = 0;
  state.waveCount = 0;
  state.dayNightTimer = 0;
  state.phase = 'day';

  // Start new match
  currentMatchId = `match_${Date.now()}`;
  try { stmtInsertMatch.run(currentMatchId, Date.now()); } catch (_e) { /* ignore */ }

  // Re-init
  initStructures();
  spawnBotHeroes();
  spawnWave();
}

app.post('/api/admin/reset', (_req, res) => {
  resetGame();
  res.json({ success: true, message: 'Game reset', match_id: currentMatchId });
});

app.post('/api/admin/pause', (_req, res) => {
  paused = true;
  res.json({ success: true, paused: true });
});

app.post('/api/admin/resume', (_req, res) => {
  paused = false;
  res.json({ success: true, paused: false });
});

app.get('/api/admin/stats', (_req, res) => {
  res.json({
    uptime: Date.now() - serverStartTime,
    totalTicks: state.tick,
    heroCount: state.heroes.size,
    unitCount: state.units.size,
    structureCount: state.structures.size,
    match_id: currentMatchId,
    paused,
  });
});

app.get('/admin', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>War of Agents - Admin Panel</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; margin: 0; padding: 20px; }
  h1 { color: #e94560; text-align: center; }
  .panel { max-width: 600px; margin: 0 auto; background: #16213e; border-radius: 12px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
  .stats { background: #0f3460; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-family: monospace; white-space: pre-wrap; min-height: 120px; }
  .buttons { display: flex; gap: 12px; flex-wrap: wrap; }
  button { padding: 12px 24px; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: transform 0.1s; }
  button:active { transform: scale(0.95); }
  .btn-pause { background: #e94560; color: white; }
  .btn-resume { background: #0f3460; color: white; border: 2px solid #e94560; }
  .btn-reset { background: #533483; color: white; }
  .status { margin-top: 16px; padding: 10px; border-radius: 6px; background: #0f3460; text-align: center; min-height: 20px; }
</style>
</head>
<body>
<h1>War of Agents - Admin Panel</h1>
<div class="panel">
  <div class="stats" id="stats">Loading stats...</div>
  <div class="buttons">
    <button class="btn-pause" onclick="doAction('/api/admin/pause','POST')">Pause</button>
    <button class="btn-resume" onclick="doAction('/api/admin/resume','POST')">Resume</button>
    <button class="btn-reset" onclick="if(confirm('Reset the game?')) doAction('/api/admin/reset','POST')">Reset Game</button>
  </div>
  <div class="status" id="status"></div>
</div>
<script>
async function fetchStats() {
  try {
    const r = await fetch('/api/admin/stats');
    const d = await r.json();
    const upSec = Math.floor(d.uptime / 1000);
    const mins = Math.floor(upSec / 60);
    const secs = upSec % 60;
    document.getElementById('stats').textContent =
      'Match:      ' + d.match_id + '\\n' +
      'Uptime:     ' + mins + 'm ' + secs + 's\\n' +
      'Ticks:      ' + d.totalTicks + '\\n' +
      'Heroes:     ' + d.heroCount + '\\n' +
      'Units:      ' + d.unitCount + '\\n' +
      'Structures: ' + d.structureCount + '\\n' +
      'Paused:     ' + d.paused;
  } catch(e) { document.getElementById('stats').textContent = 'Error fetching stats'; }
}
async function doAction(url, method) {
  try {
    const r = await fetch(url, { method });
    const d = await r.json();
    document.getElementById('status').textContent = JSON.stringify(d);
    fetchStats();
  } catch(e) { document.getElementById('status').textContent = 'Error: ' + e.message; }
}
fetchStats();
setInterval(fetchStats, 3000);
</script>
</body>
</html>`);
});

// ─── Leaderboard Page ───────────────────────────────────────────────────────
app.get('/leaderboard', (_req, res) => {
  const rows = db.prepare('SELECT * FROM leaderboard ORDER BY elo DESC LIMIT 50').all() as any[];
  const tableRows = rows.map((r: any, i: number) => {
    const border = r.faction === 'alliance' ? '#3B82F6' : '#EF4444';
    return `<tr style="border-left:4px solid ${border};">
      <td>${i + 1}</td><td>${r.name}</td><td>${r.faction}</td><td>${r.hero_class}</td>
      <td>${r.elo}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.wins}</td>
    </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="10">
<title>War of Agents - Leaderboard</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cinzel', serif; background: #0A1A30; color: #e0e0e0; padding: 20px; }
  h1 { color: #C8960C; text-align: center; font-size: 2rem; margin-bottom: 8px; text-shadow: 0 0 20px rgba(200,150,12,0.4); }
  .subtitle { text-align: center; color: #888; margin-bottom: 24px; font-size: 0.85rem; }
  .container { max-width: 960px; margin: 0 auto; }
  table { width: 100%; border-collapse: collapse; background: #0F2340; border: 1px solid #C8960C; border-radius: 8px; overflow: hidden; }
  th { background: #1A3050; color: #C8960C; padding: 12px 10px; text-align: left; font-size: 0.85rem; letter-spacing: 1px; border-bottom: 2px solid #C8960C; }
  td { padding: 10px; border-bottom: 1px solid #1A3050; font-size: 0.85rem; }
  tr:hover { background: #162D4A; }
  a { color: #C8960C; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .nav { text-align: center; margin-bottom: 20px; }
  .nav a { margin: 0 12px; }
</style>
</head>
<body>
<div class="container">
  <h1>Leaderboard</h1>
  <p class="subtitle">Auto-refreshes every 10 seconds</p>
  <div class="nav"><a href="/">Game</a> <a href="/join">Join</a> <a href="/admin">Admin</a></div>
  <table>
    <thead><tr><th>Rank</th><th>Name</th><th>Faction</th><th>Class</th><th>ELO</th><th>Kills</th><th>Deaths</th><th>Wins</th></tr></thead>
    <tbody>${tableRows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:#888;">No agents registered yet</td></tr>'}</tbody>
  </table>
</div>
</body>
</html>`);
});

// ─── Join Page ──────────────────────────────────────────────────────────────
app.get('/join', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>War of Agents - Join the Battle</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cinzel', serif; background: #0A1A30; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .card { background: #0F2340; border: 1px solid #C8960C; border-radius: 12px; padding: 36px; width: 420px; box-shadow: 0 0 40px rgba(200,150,12,0.15); }
  h1 { color: #C8960C; text-align: center; margin-bottom: 6px; font-size: 1.6rem; text-shadow: 0 0 20px rgba(200,150,12,0.4); }
  .subtitle { text-align: center; color: #888; margin-bottom: 24px; font-size: 0.8rem; }
  label { display: block; color: #C8960C; margin-bottom: 4px; font-size: 0.85rem; letter-spacing: 1px; }
  input, select { width: 100%; padding: 10px 12px; margin-bottom: 16px; background: #1A3050; border: 1px solid #2A4060; border-radius: 6px; color: #e0e0e0; font-family: 'Cinzel', serif; font-size: 0.9rem; }
  input:focus, select:focus { outline: none; border-color: #C8960C; }
  button { width: 100%; padding: 12px; background: linear-gradient(135deg, #C8960C, #A0780A); color: #0A1A30; border: none; border-radius: 6px; font-family: 'Cinzel', serif; font-size: 1rem; font-weight: 700; cursor: pointer; letter-spacing: 1px; transition: transform 0.1s; }
  button:hover { transform: scale(1.02); }
  button:active { transform: scale(0.98); }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .msg { margin-top: 16px; padding: 12px; border-radius: 6px; text-align: center; font-size: 0.85rem; display: none; }
  .msg.success { display: block; background: #0C3B1E; border: 1px solid #22C55E; color: #22C55E; }
  .msg.error { display: block; background: #3B0C0C; border: 1px solid #EF4444; color: #EF4444; }
  .nav { text-align: center; margin-top: 16px; }
  .nav a { color: #C8960C; text-decoration: none; font-size: 0.8rem; }
  .nav a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="card">
  <h1>Join the Battle</h1>
  <p class="subtitle">Register your agent for War of Agents</p>
  <form id="joinForm">
    <label for="agentName">Agent Name</label>
    <input type="text" id="agentName" placeholder="Enter your agent name" required maxlength="32">

    <label for="faction">Faction</label>
    <select id="faction" required>
      <option value="">Choose your faction...</option>
      <option value="alliance">Alliance</option>
      <option value="horde">Horde</option>
    </select>

    <label for="heroClass">Hero Class</label>
    <select id="heroClass" required>
      <option value="">Choose your class...</option>
      <option value="knight">Knight</option>
      <option value="ranger">Ranger</option>
      <option value="mage">Mage</option>
      <option value="priest">Priest</option>
      <option value="siegemaster">Siegemaster</option>
    </select>

    <button type="submit">Enter the Arena</button>
  </form>
  <div class="msg" id="msg"></div>
  <div class="nav"><a href="/">Back to Game</a> &middot; <a href="/leaderboard">Leaderboard</a></div>
</div>
<script>
document.getElementById('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  const msgEl = document.getElementById('msg');
  btn.disabled = true;
  msgEl.className = 'msg';
  msgEl.style.display = 'none';
  const name = document.getElementById('agentName').value.trim();
  const faction = document.getElementById('faction').value;
  const heroClass = document.getElementById('heroClass').value;
  const agentId = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
  try {
    const r = await fetch('/api/agents/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, name, faction, heroClass })
    });
    const d = await r.json();
    if (r.ok) {
      msgEl.className = 'msg success';
      msgEl.textContent = d.message || 'Registration successful!';
      msgEl.style.display = 'block';
      e.target.reset();
    } else {
      msgEl.className = 'msg error';
      msgEl.textContent = d.error || 'Registration failed';
      msgEl.style.display = 'block';
    }
  } catch (err) {
    msgEl.className = 'msg error';
    msgEl.textContent = 'Network error: ' + err.message;
    msgEl.style.display = 'block';
  }
  btn.disabled = false;
});
</script>
</body>
</html>`);
});

// ─── Replay Viewer Page ─────────────────────────────────────────────────────
app.get('/replay/:id', (req, res) => {
  const matchId = req.params.id;
  const snapshots = stmtGetReplaySnapshots.all(matchId) as any[];
  const snapshotsJson = JSON.stringify(snapshots.map((s: any) => ({ tick: s.tick, state: JSON.parse(s.snapshot), timestamp: s.timestamp })));

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>War of Agents - Replay ${matchId}</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cinzel', serif; background: #0A1A30; color: #e0e0e0; padding: 20px; }
  h1 { color: #C8960C; text-align: center; font-size: 1.6rem; margin-bottom: 4px; text-shadow: 0 0 20px rgba(200,150,12,0.4); }
  .match-id { text-align: center; color: #888; font-size: 0.75rem; margin-bottom: 20px; word-break: break-all; }
  .container { max-width: 960px; margin: 0 auto; }
  .controls { display: flex; align-items: center; gap: 12px; background: #0F2340; border: 1px solid #C8960C; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .controls button { background: linear-gradient(135deg, #C8960C, #A0780A); color: #0A1A30; border: none; border-radius: 6px; padding: 8px 20px; font-family: 'Cinzel', serif; font-weight: 700; cursor: pointer; font-size: 0.85rem; min-width: 80px; }
  .controls button:hover { transform: scale(1.02); }
  .slider-wrap { flex: 1; }
  input[type="range"] { width: 100%; accent-color: #C8960C; cursor: pointer; }
  .tick-info { color: #C8960C; font-size: 0.8rem; min-width: 100px; text-align: right; }
  .panel { background: #0F2340; border: 1px solid #1A3050; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .panel h2 { color: #C8960C; font-size: 1rem; margin-bottom: 10px; border-bottom: 1px solid #1A3050; padding-bottom: 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .hero-card { background: #1A3050; border-radius: 6px; padding: 10px; font-size: 0.8rem; }
  .hero-card.alliance { border-left: 3px solid #3B82F6; }
  .hero-card.horde { border-left: 3px solid #EF4444; }
  .hero-name { color: #C8960C; font-weight: 700; }
  .stat { color: #aaa; }
  .score-bar { display: flex; justify-content: space-between; font-size: 1rem; font-weight: 700; }
  .score-bar .alliance { color: #3B82F6; }
  .score-bar .horde { color: #EF4444; }
  .empty { text-align: center; color: #888; padding: 40px; }
  .nav { text-align: center; margin-bottom: 16px; }
  .nav a { color: #C8960C; text-decoration: none; margin: 0 12px; font-size: 0.85rem; }
  .nav a:hover { text-decoration: underline; }
  pre { background: #0A1220; border: 1px solid #1A3050; border-radius: 6px; padding: 12px; font-size: 0.7rem; max-height: 300px; overflow: auto; color: #8B9DC3; font-family: monospace; }
</style>
</head>
<body>
<div class="container">
  <h1>Match Replay</h1>
  <p class="match-id">${matchId}</p>
  <div class="nav"><a href="/">Game</a> <a href="/leaderboard">Leaderboard</a> <a href="/admin">Admin</a></div>
  <div id="app"></div>
</div>
<script>
const snapshots = ${snapshotsJson};
const app = document.getElementById('app');

if (snapshots.length === 0) {
  app.innerHTML = '<div class="empty">No replay data found for this match.</div>';
} else {
  let currentIdx = 0;
  let playing = false;
  let interval = null;

  function render() {
    const snap = snapshots[currentIdx];
    const st = snap.state;
    const heroes = st.heroes || [];
    const allianceKills = heroes.filter(h => h.faction === 'alliance').reduce((s, h) => s + (h.kills || 0), 0);
    const hordeKills = heroes.filter(h => h.faction === 'horde').reduce((s, h) => s + (h.kills || 0), 0);

    const heroCards = heroes.map(h => {
      const fc = h.faction === 'alliance' ? 'alliance' : 'horde';
      const alive = h.alive !== false ? 'Alive' : 'Dead';
      return '<div class="hero-card ' + fc + '">' +
        '<div class="hero-name">' + (h.agentId || h.id) + '</div>' +
        '<div class="stat">' + (h.heroClass || '?') + ' | Lv ' + (h.level || 1) + ' | ' + alive + '</div>' +
        '<div class="stat">HP: ' + (h.hp || 0) + '/' + (h.maxHp || 0) + ' | K/D: ' + (h.kills || 0) + '/' + (h.deaths || 0) + '</div>' +
        '<div class="stat">Pos: (' + Math.round(h.pos?.x || 0) + ', ' + Math.round(h.pos?.y || 0) + ')</div>' +
        '</div>';
    }).join('');

    app.innerHTML =
      '<div class="controls">' +
        '<button id="playBtn">' + (playing ? 'Pause' : 'Play') + '</button>' +
        '<div class="slider-wrap"><input type="range" id="slider" min="0" max="' + (snapshots.length - 1) + '" value="' + currentIdx + '"></div>' +
        '<div class="tick-info">Tick ' + snap.tick + ' (' + (currentIdx + 1) + '/' + snapshots.length + ')</div>' +
      '</div>' +
      '<div class="panel"><div class="score-bar"><span class="alliance">Alliance: ' + allianceKills + '</span><span class="horde">Horde: ' + hordeKills + '</span></div></div>' +
      '<div class="panel"><h2>Heroes</h2><div class="grid">' + (heroCards || '<div class="stat">No heroes</div>') + '</div></div>' +
      '<div class="panel"><h2>Raw State</h2><pre>' + JSON.stringify(st, null, 2) + '</pre></div>';

    document.getElementById('slider').addEventListener('input', (e) => {
      currentIdx = parseInt(e.target.value);
      render();
    });
    document.getElementById('playBtn').addEventListener('click', () => {
      playing = !playing;
      if (playing) {
        interval = setInterval(() => {
          if (currentIdx < snapshots.length - 1) { currentIdx++; render(); }
          else { playing = false; clearInterval(interval); render(); }
        }, 200);
      } else {
        clearInterval(interval);
      }
      render();
    });
  }
  render();
}
</script>
</body>
</html>`);
});

// ─── Init & Start ────────────────────────────────────────────────────────────
initStructures();
spawnBotHeroes();
spawnWave();
try { stmtInsertMatch.run(currentMatchId, Date.now()); } catch (_e) { /* ignore */ }

// Game loop via setImmediate for precise timing
let lastTick = Date.now();
let lastBroadcast = Date.now();

function gameLoop() {
  const now = Date.now();
  if (now - lastTick >= TICK_MS) {
    gameTick();
    lastTick = now;
  }
  if (now - lastBroadcast >= BROADCAST_MS) {
    broadcast();
    lastBroadcast = now;
  }
  setImmediate(gameLoop);
}

server.listen(PORT, () => {
  console.log(`\n⚔️  WAR OF AGENTS v1 — Alliance vs Iron Horde`);
  console.log(`   Server: http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/game/state`);
  console.log(`   ${TICK_RATE} ticks/sec | ${BROADCAST_RATE} broadcasts/sec\n`);
  gameLoop();
});
