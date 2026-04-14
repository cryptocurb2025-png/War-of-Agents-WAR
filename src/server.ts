import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import initSqlJs from 'sql.js';

// ─── sql.js wrapper mimicking better-sqlite3 API ────────────────────────────
let db: any;
async function initDB() {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, '..', 'war_of_agents.db');
  try {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } catch {
    db = new SQL.Database();
  }
  // Auto-save every 30 seconds
  setInterval(() => {
    try {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch {}
  }, 30000);
  return db;
}

// Wrapper to make sql.js look like better-sqlite3
function prepareStmt(sql: string) {
  return {
    run: (...params: any[]) => { try { db.run(sql, params); } catch {} },
    get: (...params: any[]) => {
      try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
      } catch {}
      return undefined;
    },
    all: (...params: any[]) => {
      try {
        const results: any[] = [];
        const stmt = db.prepare(sql);
        if (params.length) stmt.bind(params);
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
      } catch { return []; }
    },
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '8080', 10);
const TICK_RATE = 20;
const BROADCAST_RATE = 20;
const MAP_W = 4800;
const MAP_H = 2400;
const TICK_MS = 1000 / TICK_RATE;
const BROADCAST_MS = 1000 / BROADCAST_RATE;
const DAY_NIGHT_CYCLE = 120_000; // 2 min full cycle
// Force single lane (mid) for now — multi-lane visuals don't fit zoomed-out camera
const LANE_MIN_Y = 1040;
const LANE_MAX_Y = 1360;

// ─── Multi-Lane Definitions ───────────────────────────────────────────────
type LaneName = 'top' | 'mid' | 'bot';
const LANES: Record<LaneName, { centerY: number; minY: number; maxY: number }> = {
  top: { centerY: 500, minY: 400, maxY: 600 },
  mid: { centerY: 1200, minY: 1040, maxY: 1360 },
  bot: { centerY: 1900, minY: 1800, maxY: 2000 },
};
const LANE_NAMES: LaneName[] = ['top', 'mid', 'bot']; // Units spawn across all 3 lanes
const VISION_RADIUS = 400;

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
  tier: number; // 1, 2, or 3
  abilities: Ability[];
  items: Item[];
  respawnTimer: number;
  agentId: string | null;
  displayName: string | null;
  pendingAbilityId: string | null;
  moveTarget: Position | null;
  lastDamagedBy: string[];
  lane: LaneName;
  focusTargetId: string | null;
  controlMode: 'auto' | 'manual';
}

// Combat events for frontend feedback (cleared each broadcast)
interface CombatEvent {
  type: 'ability_hit' | 'ability_heal' | 'ability_miss' | 'auto_attack';
  sourceId: string;
  targetId: string | null;
  abilityName?: string;
  damage?: number;
  healed?: number;
  effect?: string;
  aoe?: boolean;
  x: number;
  y: number;
}
let combatEvents: CombatEvent[] = [];

interface Structure extends Entity {
  structureType: 'tower_t1' | 'tower_t2' | 'barracks' | 'base';
  tier: number;
  lane?: LaneName;
}

interface UnitEntity extends Entity {
  unitType: string;
  wave: number;
  lane: LaneName;
}

// ─── Jungle Camp Types ────────────────────────────────────────────────────
interface JungleMonster {
  id: string;
  pos: Position;
  hp: number;
  maxHp: number;
  damage: number;
  alive: boolean;
  campId: string;
}

interface JungleCamp {
  id: string;
  pos: Position;
  monsters: JungleMonster[];
  respawnTimer: number;
  isBoss: boolean;
  goldReward: number;
  xpReward: number;
}

interface GameState {
  tick: number;
  time: number;
  phase: Phase;
  dayNightTimer: number;
  heroes: Map<string, HeroEntity>;
  units: Map<string, UnitEntity>;
  structures: Map<string, Structure>;
  camps: JungleCamp[];
  projectiles: Projectile[];
  kills: KillEvent[];
  winner: Faction | null;
  winnerAt: number | null;
  waveTimer: number;
  waveCount: number;
  era: number; // 1=Bronze, 2=Iron, 3=Steel, 4=War
  waveVotes: { alliance: string | null; horde: string | null };
  turrets: {
    alliance: { lastFired: number; cooldown: number };
    horde: { lastFired: number; cooldown: number };
  };
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
  killerName: string;
  victimName: string;
  killerFaction: Faction;
  victimFaction: Faction;
  killerClass: HeroClass;
  victimClass: HeroClass;
  killerIsPlayer: boolean;
  victimIsPlayer: boolean;
  isRampage: boolean;
  bounty: number;
}

interface Bet {
  oddsId: string;
  oddsName: string;
  oddsAmount: number;
  faction: 'alliance' | 'horde';
  timestamp: number;
}

interface BettingState {
  bets: { alliance: number; horde: number };
  betters: Bet[];
}

// ─── Player Slot & Queue ─────────────────────────────────────────────────────
const MAX_PLAYERS_PER_FACTION = 5;
const AVG_MATCH_DURATION_MS = 5 * 60 * 1000;
const PLAYER_IDLE_TIMEOUT_MS = 45_000; // free a player slot after 45s of no heartbeat

interface QueueEntry {
  agentId: string;
  name: string;
  faction: Faction;
  heroClass: HeroClass;
  queuedAt: number;
}
const joinQueue: QueueEntry[] = [];

// Heartbeat: client-side keepalive lets us free slots when players close their tab
// without explicitly leaving. Move/attack/ability commands also bump the heartbeat.
const playerHeartbeats: Map<string, number> = new Map();
function bumpHeartbeat(agentId: string) {
  playerHeartbeats.set(agentId, Date.now());
}

interface AgentRegistration {
  agentId: string;
  name: string;
  faction: Faction;
  heroClass: HeroClass;
  joinedAt: number;
}

// ─── Database ────────────────────────────────────────────────────────────────
// DB initialized async in startServer() below — tables created there
const DB_SCHEMA = `
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
  CREATE TABLE IF NOT EXISTS agent_meta (
    agent_id TEXT PRIMARY KEY,
    war_balance INTEGER DEFAULT 0,
    meta_dmg INTEGER DEFAULT 0,
    meta_hp INTEGER DEFAULT 0,
    meta_gold INTEGER DEFAULT 0,
    meta_xp INTEGER DEFAULT 0,
    unlocked_classes TEXT DEFAULT 'knight,ranger'
  );
  CREATE TABLE IF NOT EXISTS missions (
    agent_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    target INTEGER NOT NULL,
    completed INTEGER DEFAULT 0,
    daily INTEGER DEFAULT 0,
    assigned_at INTEGER,
    completed_at INTEGER,
    PRIMARY KEY (agent_id, mission_id)
  );
`;

// Prepared statements — initialized after DB is ready
let stmtGetMeta: any;
let stmtUpsertMeta: any;
let stmtUpsertMission: any;
let stmtGetMissionsByAgent: any;
let stmtDeleteDailyMissionsForAgent: any;
let stmtInsertAgent: any;
let stmtUpsertLeaderboard: any;
let stmtUpdateStats: any;
let stmtGetLeaderboard: any;
let stmtGetAgentRow: any;
let stmtRecentMatchesForAgent: any;
let stmtGetAgent: any;
let stmtUpdateElo: any;
let stmtGetElo: any;
let stmtInsertMatch: any;
let stmtEndMatch: any;
let stmtInsertSnapshot: any;
let stmtGetMatches: any;
let stmtGetReplaySnapshots: any;

function initStatements() {
  stmtInsertAgent = prepareStmt(`INSERT OR REPLACE INTO agents VALUES (?,?,?,?,?)`);
  stmtUpsertLeaderboard = prepareStmt(`INSERT OR REPLACE INTO leaderboard (agent_id, name, faction, hero_class, kills, deaths, assists, gold_earned, games_played, wins, elo) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 1200)`);
  stmtUpdateStats = prepareStmt(`UPDATE leaderboard SET kills=kills+?, deaths=deaths+?, assists=assists+?, gold_earned=gold_earned+?, games_played=games_played+?, wins=wins+? WHERE agent_id=?`);
  stmtGetLeaderboard = prepareStmt(`SELECT * FROM leaderboard ORDER BY elo DESC, kills DESC, deaths ASC LIMIT 50`);
  stmtGetAgentRow = prepareStmt(`SELECT * FROM leaderboard WHERE agent_id=?`);
  stmtRecentMatchesForAgent = prepareStmt(`SELECT m.id, m.started_at, m.ended_at, m.winner, m.status FROM matches m ORDER BY m.started_at DESC LIMIT 20`);
  stmtGetAgent = prepareStmt(`SELECT * FROM leaderboard WHERE agent_id=?`);
  stmtUpdateElo = prepareStmt(`UPDATE leaderboard SET elo=? WHERE agent_id=?`);
  stmtGetElo = prepareStmt(`SELECT elo FROM leaderboard WHERE agent_id=?`);
  stmtInsertMatch = prepareStmt(`INSERT INTO matches (id, started_at, status) VALUES (?, ?, 'in_progress')`);
  stmtEndMatch = prepareStmt(`UPDATE matches SET ended_at=?, winner=?, status='completed' WHERE id=?`);
  stmtInsertSnapshot = prepareStmt(`INSERT INTO replay_snapshots (match_id, tick, snapshot, timestamp) VALUES (?, ?, ?, ?)`);
  stmtGetMatches = prepareStmt(`SELECT * FROM matches ORDER BY started_at DESC LIMIT 50`);
  stmtGetReplaySnapshots = prepareStmt(`SELECT tick, snapshot, timestamp FROM replay_snapshots WHERE match_id=? ORDER BY tick ASC`);
  stmtGetMeta = prepareStmt(`SELECT * FROM agent_meta WHERE agent_id=?`);
  stmtUpsertMeta = prepareStmt(`INSERT OR REPLACE INTO agent_meta (agent_id, war_balance, meta_dmg, meta_hp, meta_gold, meta_xp, unlocked_classes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  stmtUpsertMission = prepareStmt(`INSERT INTO missions (agent_id, mission_id, progress, target, completed, daily, assigned_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id, mission_id) DO UPDATE SET progress=excluded.progress, completed=excluded.completed, completed_at=excluded.completed_at`);
  stmtGetMissionsByAgent = prepareStmt(`SELECT mission_id, progress, target, completed, daily, assigned_at, completed_at FROM missions WHERE agent_id=?`);
  stmtDeleteDailyMissionsForAgent = prepareStmt(`DELETE FROM missions WHERE agent_id=? AND daily=1`);
}

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

// Farm-guard: same killer→victim pair can only move ELO once per 5 min
const ELO_PAIR_COOLDOWN_MS = 5 * 60 * 1000;
const eloPairCooldown = new Map<string, number>(); // "killerAgent:victimAgent" → timestamp

function updateEloOnKill(killerAgentId: string, victimAgentId: string) {
  const killerRow = stmtGetElo.get(killerAgentId) as { elo: number } | undefined;
  const victimRow = stmtGetElo.get(victimAgentId) as { elo: number } | undefined;
  if (!killerRow || !victimRow) return;
  const pairKey = `${killerAgentId}:${victimAgentId}`;
  const last = eloPairCooldown.get(pairKey) || 0;
  if (Date.now() - last < ELO_PAIR_COOLDOWN_MS) return; // farm-guarded, no update
  eloPairCooldown.set(pairKey, Date.now());
  const { newWinner, newLoser } = calculateElo(killerRow.elo, victimRow.elo);
  stmtUpdateElo.run(newWinner, killerAgentId);
  stmtUpdateElo.run(Math.max(0, newLoser), victimAgentId);
}

// ─── Meta Progression ───────────────────────────────────────────────────────
// Persistent token-spend upgrades, hero unlocks, and per-match rerolls.
// Balanced so active play generates ~10-80 $WAR/day from missions + wins;
// meaningful upgrades cost hundreds to thousands — net spend >> earn late.

const META_STATS = ['dmg', 'hp', 'gold', 'xp'] as const;
type MetaStat = typeof META_STATS[number];
const META_MAX_LEVEL = 10;

// Cost curve per level: 100 × 1.5^(level-1) rounded — 100, 150, 225, 340 … 3847
function metaStatCost(currentLevel: number): number {
  if (currentLevel >= META_MAX_LEVEL) return Infinity;
  return Math.round(100 * Math.pow(1.5, currentLevel));
}
// Per-level bonus: +1% per rank. L10 = +10% of the stat.
function metaBonusPercent(level: number): number { return level * 0.01; }

// Hero unlock costs (0 = starter, always free)
const HERO_UNLOCK_COSTS: Record<HeroClass, number> = {
  knight: 0, ranger: 0,
  mage: 2000, priest: 3000, siegemaster: 5000,
};

// Reroll costs within a single match — escalates
const REROLL_COSTS = [50, 100, 200]; // 1st / 2nd / 3rd; caps at 3 per run

interface MetaProfile {
  agent_id: string;
  war_balance: number;
  meta_dmg: number;
  meta_hp: number;
  meta_gold: number;
  meta_xp: number;
  unlocked_classes: string[];
}

function getMeta(agentId: string): MetaProfile {
  if (!stmtGetMeta) {
    return { agent_id: agentId, war_balance: 0, meta_dmg: 0, meta_hp: 0, meta_gold: 0, meta_xp: 0, unlocked_classes: ['knight', 'ranger'] };
  }
  const row = stmtGetMeta.get(agentId) as any;
  if (!row) {
    const fresh: MetaProfile = { agent_id: agentId, war_balance: 0, meta_dmg: 0, meta_hp: 0, meta_gold: 0, meta_xp: 0, unlocked_classes: ['knight', 'ranger'] };
    try { stmtUpsertMeta.run(agentId, 0, 0, 0, 0, 0, 'knight,ranger'); } catch {}
    return fresh;
  }
  return {
    agent_id: row.agent_id,
    war_balance: row.war_balance || 0,
    meta_dmg: row.meta_dmg || 0,
    meta_hp: row.meta_hp || 0,
    meta_gold: row.meta_gold || 0,
    meta_xp: row.meta_xp || 0,
    unlocked_classes: (row.unlocked_classes || 'knight,ranger').split(','),
  };
}

function saveMeta(m: MetaProfile) {
  if (!stmtUpsertMeta) return;
  try {
    stmtUpsertMeta.run(m.agent_id, m.war_balance, m.meta_dmg, m.meta_hp, m.meta_gold, m.meta_xp, m.unlocked_classes.join(','));
  } catch {}
}

function grantWar(agentId: string, amount: number, reason: string) {
  if (!agentId || amount <= 0) return;
  const m = getMeta(agentId);
  m.war_balance += amount;
  saveMeta(m);
  broadcastToAgent(agentId, { type: 'war_granted', amount, balance: m.war_balance, reason });
}

// Apply permanent meta bonuses to a hero at spawn time
function applyMetaBonuses(hero: HeroEntity, agentId: string) {
  const m = getMeta(agentId);
  const dmgBonus  = metaBonusPercent(m.meta_dmg);
  const hpBonus   = metaBonusPercent(m.meta_hp);
  hero.damage = Math.round(hero.damage * (1 + dmgBonus));
  hero.maxHp  = Math.round(hero.maxHp  * (1 + hpBonus));
  hero.hp     = hero.maxHp;
  // gold / xp bonuses applied at earn time (see hooks)
  (hero as any)._metaGoldMult = 1 + metaBonusPercent(m.meta_gold);
  (hero as any)._metaXpMult   = 1 + metaBonusPercent(m.meta_xp);
}

// Per-match reroll counter: agentId → number of rerolls used this match
const matchRerolls = new Map<string, number>();

// ─── Mission System ──────────────────────────────────────────────────────────
type MissionKind =
  | 'first_blood' | 'tower_breaker' | 'survivor' | 'farmer' | 'giant_slayer'
  | 'assist_ace' | 'spender' | 'no_deaths' | 'ability_chain' | 'wave_clearer';

interface MissionDef {
  id: MissionKind;
  label: string;
  description: string;
  target: number;
  rewardGold: number;
  rewardXp: number;
  rewardToken?: number; // hook for future $WAR
  difficulty: 'easy' | 'medium' | 'hard';
  category: 'session' | 'daily';
}

// Rewards scaled by difficulty:
//   easy   → base
//   medium → 1.5x
//   hard   → 2.25x
// Daily missions additionally include a $WAR token amount.
const MISSION_DEFS: MissionDef[] = [
  // Session
  { id: 'first_blood',   label: 'First Blood',   description: 'Score the first hero kill',       target: 1,   rewardGold: 150, rewardXp: 60,  difficulty: 'easy',   category: 'session' },
  { id: 'farmer',        label: 'Farmer',        description: 'Kill 20 minions',                  target: 20,  rewardGold: 220, rewardXp: 90,  difficulty: 'medium', category: 'session' },
  { id: 'survivor',      label: 'Survivor',      description: 'Stay alive for 180 seconds',       target: 180, rewardGold: 240, rewardXp: 100, difficulty: 'medium', category: 'session' },
  { id: 'tower_breaker', label: 'Tower Breaker', description: 'Destroy an enemy tower',           target: 1,   rewardGold: 320, rewardXp: 140, difficulty: 'medium', category: 'session' },
  { id: 'giant_slayer',  label: 'Giant Slayer',  description: 'Kill a hero 3+ levels above you',  target: 1,   rewardGold: 450, rewardXp: 220, difficulty: 'hard',   category: 'session' },
  // Daily pool
  { id: 'spender',       label: 'Big Spender',   description: 'Spend 1200 gold in shop',          target: 1200, rewardGold: 250, rewardXp: 100, rewardToken: 3, difficulty: 'easy',   category: 'daily' },
  { id: 'assist_ace',    label: 'Teamwork',      description: 'Earn 5 assists',                   target: 5,   rewardGold: 380, rewardXp: 150, rewardToken: 5, difficulty: 'medium', category: 'daily' },
  { id: 'ability_chain', label: 'Combo',         description: 'Land 25 ability hits',             target: 25,  rewardGold: 400, rewardXp: 160, rewardToken: 5, difficulty: 'medium', category: 'daily' },
  { id: 'wave_clearer',  label: 'Wave Clearer',  description: 'Clear 60 minions total',           target: 60,  rewardGold: 520, rewardXp: 210, rewardToken: 7, difficulty: 'medium', category: 'daily' },
  { id: 'no_deaths',     label: 'Untouchable',   description: 'Win a match without dying',        target: 1,   rewardGold: 700, rewardXp: 350, rewardToken: 10, difficulty: 'hard', category: 'daily' },
];

const SESSION_MISSION_IDS: MissionKind[] = ['first_blood', 'tower_breaker', 'survivor', 'farmer', 'giant_slayer'];
const DAILY_POOL_IDS: MissionKind[] = ['assist_ace', 'spender', 'no_deaths', 'ability_chain', 'wave_clearer'];

interface MissionState { id: MissionKind; progress: number; target: number; completed: boolean; daily: boolean; }
const missionProgress = new Map<string, Map<MissionKind, MissionState>>(); // agentId → id → state
const dailyAssigned = new Map<string, { ids: MissionKind[]; day: string }>(); // agentId → {ids, YYYY-MM-DD UTC}

function utcDay(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

// Agents whose persisted mission rows have been hydrated this process lifetime
const hydratedAgents = new Set<string>();

function hydrateAgentFromDb(agentId: string) {
  if (hydratedAgents.has(agentId)) return;
  hydratedAgents.add(agentId);
  if (!stmtGetMissionsByAgent) return;
  try {
    const rows = stmtGetMissionsByAgent.all(agentId) as Array<{
      mission_id: string; progress: number; target: number; completed: number; daily: number;
    }>;
    if (!missionProgress.has(agentId)) missionProgress.set(agentId, new Map());
    const m = missionProgress.get(agentId)!;
    const todayDaily: MissionKind[] = [];
    for (const r of rows) {
      const id = r.mission_id as MissionKind;
      const def = MISSION_DEFS.find(d => d.id === id);
      if (!def) continue;
      m.set(id, {
        id, progress: r.progress, target: r.target,
        completed: r.completed === 1, daily: r.daily === 1,
      });
      if (r.daily === 1) todayDaily.push(id);
    }
    if (todayDaily.length) dailyAssigned.set(agentId, { ids: todayDaily, day: utcDay() });
  } catch (e) { /* ignore — first-run schemas may race */ }
}

function persistMission(agentId: string, state: MissionState) {
  if (!stmtUpsertMission) return;
  try {
    stmtUpsertMission.run(
      agentId, state.id, state.progress, state.target,
      state.completed ? 1 : 0, state.daily ? 1 : 0,
      Date.now(), state.completed ? Date.now() : null,
    );
  } catch (e) { /* ignore */ }
}

function ensureAgentMissions(agentId: string) {
  hydrateAgentFromDb(agentId);
  if (!missionProgress.has(agentId)) missionProgress.set(agentId, new Map());
  const m = missionProgress.get(agentId)!;
  // Session missions: reset if not present or completed (one-shot per match is handled via match reset)
  for (const id of SESSION_MISSION_IDS) {
    if (!m.has(id)) {
      const def = MISSION_DEFS.find(d => d.id === id)!;
      m.set(id, { id, progress: 0, target: def.target, completed: false, daily: false });
    }
  }
  // Daily: assign 3 random ones per UTC day
  const today = utcDay();
  const assigned = dailyAssigned.get(agentId);
  if (!assigned || assigned.day !== today) {
    const pool = [...DAILY_POOL_IDS];
    const ids: MissionKind[] = [];
    while (ids.length < 3 && pool.length) {
      ids.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    dailyAssigned.set(agentId, { ids, day: today });
    // Purge yesterday's daily rows in DB, then re-seed fresh dailies
    try { if (stmtDeleteDailyMissionsForAgent) stmtDeleteDailyMissionsForAgent.run(agentId); } catch {}
    for (const id of DAILY_POOL_IDS) {
      if (!ids.includes(id)) m.delete(id);
    }
    for (const id of ids) {
      const def = MISSION_DEFS.find(d => d.id === id)!;
      if (!m.has(id) || m.get(id)!.completed) {
        const fresh: MissionState = { id, progress: 0, target: def.target, completed: false, daily: true };
        m.set(id, fresh);
        persistMission(agentId, fresh);
      }
    }
  }
}

function bumpMission(agentId: string | undefined, id: MissionKind, delta: number = 1) {
  if (!agentId) return;
  ensureAgentMissions(agentId);
  const m = missionProgress.get(agentId)!;
  const s = m.get(id);
  if (!s || s.completed) return;
  const before = s.progress;
  s.progress = Math.min(s.target, s.progress + delta);
  if (s.progress !== before) {
    broadcastToAgent(agentId, { type: 'mission_progress', missionId: id, progress: s.progress, target: s.target });
    persistMission(agentId, s); // durability across restarts
  }
  if (!s.completed && s.progress >= s.target) {
    s.completed = true;
    const def = MISSION_DEFS.find(d => d.id === id)!;
    // Bonus roll — 15% chance of a small reward sweetener.
    // Scales slightly with difficulty so bigger missions get bigger bonuses.
    const rollChance = 0.15;
    const hit = Math.random() < rollChance;
    let bonusGold = 0;
    let bonusXp = 0;
    let bonusType: string | null = null;
    if (hit) {
      const tierMul = def.difficulty === 'hard' ? 2 : def.difficulty === 'medium' ? 1.4 : 1;
      const kinds = ['gold', 'gold', 'xp']; // gold-heavy
      bonusType = kinds[Math.floor(Math.random() * kinds.length)];
      if (bonusType === 'gold') bonusGold = Math.round((40 + Math.floor(Math.random() * 80)) * tierMul);
      else                       bonusXp = Math.round((20 + Math.floor(Math.random() * 40)) * tierMul);
    }
    // Apply rewards to active hero
    const totalGold = def.rewardGold + bonusGold;
    const totalXp   = def.rewardXp + bonusXp;
    const hero = [...state.heroes.values()].find(h => h.agentId === agentId && h.alive);
    if (hero) {
      hero.gold += totalGold;
      (hero as any).xp = ((hero as any).xp || 0) + totalXp;
    }
    // Mission $WAR reward — credits the persistent meta balance
    if (def.rewardToken && def.rewardToken > 0) {
      grantWar(agentId, def.rewardToken, `Mission: ${def.label}`);
    }
    persistMission(agentId, s); // durability for completed mission
    broadcastToAgent(agentId, {
      type: 'mission_completed',
      missionId: id,
      label: def.label,
      difficulty: def.difficulty,
      rewardGold: def.rewardGold,
      rewardXp: def.rewardXp,
      rewardToken: def.rewardToken || 0,
      bonusGold, bonusXp, bonusHit: hit, bonusType,
      totalGold, totalXp,
      // For client-side floating reward numbers above the hero
      heroX: hero?.pos.x, heroY: hero?.pos.y,
    });
  }
}

function missionsForAgent(agentId: string) {
  ensureAgentMissions(agentId);
  const m = missionProgress.get(agentId)!;
  const out: any[] = [];
  for (const [, s] of m) {
    const def = MISSION_DEFS.find(d => d.id === s.id);
    if (!def) continue;
    out.push({
      id: s.id, label: def.label, description: def.description,
      progress: s.progress, target: s.target, completed: s.completed,
      daily: s.daily, difficulty: def.difficulty,
      rewardGold: def.rewardGold, rewardXp: def.rewardXp, rewardToken: def.rewardToken || 0,
    });
  }
  return out;
}

// Session missions reset on match end
function resetSessionMissions() {
  for (const [, m] of missionProgress) {
    for (const id of SESSION_MISSION_IDS) {
      const s = m.get(id);
      if (s) { s.progress = 0; s.completed = false; }
    }
  }
}

// ─── Item Shop ───────────────────────────────────────────────────────────────
const SHOP_ITEMS: Item[] = [
  { id: 'boots',  name: 'Swift Boots',    cost: 200, stats: { speed: 30 } },
  { id: 'sword',  name: 'Battle Blade',   cost: 300, stats: { damage: 15 } },
  { id: 'shield', name: 'Iron Buckler',   cost: 250, stats: { armor: 8, hp: 100 } },
  { id: 'cloak',  name: 'Shadow Cloak',   cost: 200, stats: { armor: 4, speed: 15, mana: 50 } },
  { id: 'relic',  name: 'Ancient Relic',   cost: 600, stats: { damage: 25, hp: 200, mana: 100, regen: 5, armor: 3 } },
];

// ─── Hero Class Definitions ─────────────────────────────────────────────────
function createAbilities(heroClass: HeroClass): Ability[] {
  const base: Record<HeroClass, Ability[]> = {
    knight: [
      { id: 'shield_bash', name: 'Shield Bash', cooldown: 50, currentCd: 0, damage: 55, range: 200, tier: 1, maxTier: 5, manaCost: 15, aoe: 0, effect: 'stun' },
      { id: 'charge', name: 'Charge', cooldown: 90, currentCd: 0, damage: 75, range: 500, tier: 1, maxTier: 5, manaCost: 25, aoe: 0, effect: 'dash' },
      { id: 'whirlwind', name: 'Whirlwind', cooldown: 70, currentCd: 0, damage: 60, range: 200, tier: 1, maxTier: 5, manaCost: 30, aoe: 200, effect: 'spin' },
      { id: 'fortify', name: 'Fortify', cooldown: 150, currentCd: 0, damage: 0, range: 0, tier: 1, maxTier: 5, manaCost: 40, aoe: 0, effect: 'armor_buff' },
      { id: 'rally', name: 'Battle Rally', cooldown: 220, currentCd: 0, damage: 0, range: 500, tier: 1, maxTier: 5, manaCost: 60, aoe: 500, effect: 'team_buff' },
      { id: 'holy_judgment', name: 'Holy Judgment', cooldown: 1200, currentCd: 0, damage: 500, range: 0, tier: 1, maxTier: 1, manaCost: 100, aoe: 9999, effect: 'ultimate_aoe' },
    ],
    ranger: [
      { id: 'power_shot', name: 'Power Shot', cooldown: 35, currentCd: 0, damage: 80, range: 600, tier: 1, maxTier: 5, manaCost: 15, aoe: 0 },
      { id: 'multi_shot', name: 'Multi Shot', cooldown: 60, currentCd: 0, damage: 45, range: 550, tier: 1, maxTier: 5, manaCost: 25, aoe: 150 },
      { id: 'trap', name: 'Bear Trap', cooldown: 100, currentCd: 0, damage: 35, range: 350, tier: 1, maxTier: 5, manaCost: 20, aoe: 80, effect: 'slow' },
      { id: 'eagle_eye', name: 'Eagle Eye', cooldown: 110, currentCd: 0, damage: 130, range: 800, tier: 1, maxTier: 5, manaCost: 35, aoe: 0, effect: 'crit' },
      { id: 'rain_arrows', name: 'Rain of Arrows', cooldown: 180, currentCd: 0, damage: 70, range: 600, tier: 1, maxTier: 5, manaCost: 55, aoe: 280 },
      { id: 'rain_of_arrows', name: 'Rain of Arrows', cooldown: 1000, currentCd: 0, damage: 100, range: 0, tier: 1, maxTier: 1, manaCost: 80, aoe: 9999, effect: 'ultimate_dot' },
    ],
    mage: [
      { id: 'fireball', name: 'Fireball', cooldown: 40, currentCd: 0, damage: 95, range: 550, tier: 1, maxTier: 5, manaCost: 20, aoe: 120, effect: 'burn' },
      { id: 'frost_bolt', name: 'Frost Bolt', cooldown: 35, currentCd: 0, damage: 60, range: 500, tier: 1, maxTier: 5, manaCost: 15, aoe: 0, effect: 'slow' },
      { id: 'arcane_blast', name: 'Arcane Blast', cooldown: 50, currentCd: 0, damage: 110, range: 450, tier: 1, maxTier: 5, manaCost: 30, aoe: 150 },
      { id: 'blink', name: 'Blink', cooldown: 80, currentCd: 0, damage: 0, range: 600, tier: 1, maxTier: 5, manaCost: 25, aoe: 0, effect: 'teleport' },
      { id: 'meteor', name: 'Meteor Storm', cooldown: 220, currentCd: 0, damage: 220, range: 700, tier: 1, maxTier: 5, manaCost: 80, aoe: 320 },
      { id: 'blizzard_storm', name: 'Blizzard Storm', cooldown: 1400, currentCd: 0, damage: 100, range: 0, tier: 1, maxTier: 1, manaCost: 120, aoe: 9999, effect: 'ultimate_slow' },
    ],
    priest: [
      { id: 'heal', name: 'Holy Light', cooldown: 35, currentCd: 0, damage: -90, range: 500, tier: 1, maxTier: 5, manaCost: 20, aoe: 0, effect: 'heal' },
      { id: 'smite', name: 'Holy Smite', cooldown: 45, currentCd: 0, damage: 70, range: 500, tier: 1, maxTier: 5, manaCost: 15, aoe: 0 },
      { id: 'shield_aura', name: 'Divine Shield', cooldown: 110, currentCd: 0, damage: 0, range: 0, tier: 1, maxTier: 5, manaCost: 35, aoe: 0, effect: 'invuln' },
      { id: 'mass_heal', name: 'Mass Heal', cooldown: 150, currentCd: 0, damage: -150, range: 550, tier: 1, maxTier: 5, manaCost: 60, aoe: 380, effect: 'heal' },
      { id: 'resurrection', name: 'Resurrection', cooldown: 300, currentCd: 0, damage: 0, range: 350, tier: 1, maxTier: 5, manaCost: 100, aoe: 0, effect: 'revive' },
      { id: 'divine_resurrection', name: 'Divine Resurrection', cooldown: 1800, currentCd: 0, damage: 0, range: 0, tier: 1, maxTier: 1, manaCost: 150, aoe: 9999, effect: 'ultimate_revive' },
    ],
    siegemaster: [
      { id: 'cannon', name: 'Cannon Shot', cooldown: 50, currentCd: 0, damage: 100, range: 650, tier: 1, maxTier: 5, manaCost: 20, aoe: 130 },
      { id: 'mortar', name: 'Mortar Barrage', cooldown: 90, currentCd: 0, damage: 75, range: 750, tier: 1, maxTier: 5, manaCost: 35, aoe: 200 },
      { id: 'fortification', name: 'Fortification', cooldown: 110, currentCd: 0, damage: 0, range: 0, tier: 1, maxTier: 5, manaCost: 30, aoe: 0, effect: 'tower_buff' },
      { id: 'demolish', name: 'Demolish', cooldown: 70, currentCd: 0, damage: 150, range: 250, tier: 1, maxTier: 5, manaCost: 25, aoe: 0, effect: 'structure_dmg' },
      { id: 'siege_mode', name: 'Siege Mode', cooldown: 230, currentCd: 0, damage: 0, range: 0, tier: 1, maxTier: 5, manaCost: 50, aoe: 0, effect: 'transform' },
      { id: 'orbital_bombardment', name: 'Orbital Bombardment', cooldown: 1100, currentCd: 0, damage: 300, range: 0, tier: 1, maxTier: 1, manaCost: 90, aoe: 400, effect: 'ultimate_multi' },
    ],
  };
  return base[heroClass];
}

function heroBaseStats(hc: HeroClass): { hp: number; mana: number; damage: number; armor: number; speed: number; range: number } {
  const s: Record<HeroClass, any> = {
    // TTK-tuned baselines. Knight & Priest were the main pacing offenders.
    knight:      { hp: 820, mana: 150, damage: 30, armor: 12, speed: 90,  range: 70 },
    ranger:      { hp: 550, mana: 200, damage: 40, armor: 5,  speed: 120, range: 400 },
    mage:        { hp: 450, mana: 400, damage: 50, armor: 3,  speed: 95,  range: 300 },
    priest:      { hp: 520, mana: 500, damage: 22, armor: 4,  speed: 100, range: 280 },
    siegemaster: { hp: 700, mana: 180, damage: 58, armor: 10, speed: 60,  range: 450 },
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

function moveToward(pos: Position, target: Position, speed: number, dt: number, lane?: LaneName): Position {
  // Guard against NaN inputs — if either position is bad, reset to a safe spot
  // in the caller's lane. Prevents ghost heroes with stuck NaN coordinates.
  if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(target.x) || !isFinite(target.y)) {
    const laneInfo = lane ? LANES[lane] : LANES.mid;
    return { x: MAP_W / 2, y: (laneInfo.minY + laneInfo.maxY) / 2 };
  }
  const d = dist(pos, target);
  if (!isFinite(d) || d < 2) return pos;
  const step = Math.min(speed * dt, d);
  // When a lane is specified, clamp Y to the lane band (bot AI behavior).
  // When no lane is specified, allow free movement across the full map height
  // (player-controlled heroes get this).
  const minY = lane ? LANES[lane].minY : 50;
  const maxY = lane ? LANES[lane].maxY : MAP_H - 50;
  return {
    x: Math.max(0, Math.min(MAP_W, pos.x + (target.x - pos.x) / d * step)),
    y: Math.max(minY, Math.min(maxY, pos.y + (target.y - pos.y) / d * step)),
  };
}

let currentMatchId = `match_${Date.now()}`;
let paused = false;
const serverStartTime = Date.now();

// ─── Betting State ──────────────────────────────────────────────────────────
const bettingState: BettingState = {
  bets: { alliance: 0, horde: 0 },
  betters: [],
};

// ─── In-match prop markets (off-chain stub layer) ──────────────────────────
// Each match has additional markets that resolve on specific in-game events.
// These pools live in memory and "settle" symbolically — the on-chain payout
// goes live with $WAR launch. The pools render in the spectator UI so the
// value prop is visible.
interface PropMarket {
  id: string;
  label: string;
  options: string[];
  pools: Record<string, number>; // option -> total $WAR staked
  resolved: boolean;
  winner: string | null;
}
let propMarkets: PropMarket[] = [];
function resetPropMarkets() {
  propMarkets = [
    { id: 'first_blood', label: 'First Blood', options: ['alliance', 'horde'], pools: { alliance: 0, horde: 0 }, resolved: false, winner: null },
    { id: 'first_tower', label: 'First Tower Falls', options: ['alliance', 'horde'], pools: { alliance: 0, horde: 0 }, resolved: false, winner: null },
    { id: 'mvp_class', label: 'MVP Hero Class', options: ['knight', 'ranger', 'mage', 'priest', 'siegemaster'], pools: { knight: 0, ranger: 0, mage: 0, priest: 0, siegemaster: 0 }, resolved: false, winner: null },
  ];
}
resetPropMarkets();

// Cheer-to-burn buff state. Each cheer grants a 30-second damage+speed buff
// to the receiving faction's heroes. The "burn" is symbolic until $WAR launches.
interface CheerBuff {
  faction: Faction;
  expiresAt: number;
  totalBurned: number; // running total of $WAR burned via cheers (stub number)
}
const cheerBuffs: { alliance: CheerBuff | null; horde: CheerBuff | null } = {
  alliance: null,
  horde: null,
};
let totalWarBurned = 0;

function resetBets() {
  bettingState.bets = { alliance: 0, horde: 0 };
  bettingState.betters = [];
  resetPropMarkets();
  cheerBuffs.alliance = null;
  cheerBuffs.horde = null;
}

function calculateOdds(): { alliance: string; horde: string; display: string } {
  const a = bettingState.bets.alliance || 1;
  const h = bettingState.bets.horde || 1;
  const total = a + h;
  return {
    alliance: (total / a).toFixed(1),
    horde: (total / h).toFixed(1),
    display: `${(total / a).toFixed(1)}:${(total / h).toFixed(1)}`,
  };
}

function calculatePayouts(winner: Faction) {
  const loser: Faction = winner === 'alliance' ? 'horde' : 'alliance';
  const winPool = bettingState.bets[winner];
  const losePool = bettingState.bets[loser];
  const winningBets = bettingState.betters.filter(b => b.faction === winner);

  if (winPool === 0 || winningBets.length === 0) {
    console.log(`[BETTING] No winning bets for ${winner}. Lose pool: ${losePool}`);
    return;
  }

  console.log(`[BETTING] ${winner.toUpperCase()} wins! Win pool: ${winPool}, Lose pool: ${losePool}`);
  for (const bet of winningBets) {
    const share = bet.oddsAmount / winPool;
    const payout = bet.oddsAmount + Math.floor(share * losePool);
    console.log(`[BETTING] ${bet.oddsName} bet ${bet.oddsAmount} on ${bet.faction} => payout ${payout}`);
  }
}

const state: GameState = {
  tick: 0,
  time: 0,
  phase: 'day',
  dayNightTimer: 0,
  heroes: new Map(),
  units: new Map(),
  structures: new Map(),
  camps: [],
  projectiles: [],
  kills: [],
  winner: null,
  winnerAt: null,
  waveTimer: 0,
  waveCount: 0,
  era: 1,
  waveVotes: { alliance: null, horde: null },
  turrets: {
    alliance: { lastFired: 0, cooldown: 200 },
    horde: { lastFired: 0, cooldown: 200 },
  },
};

// ─── Structure Placement ─────────────────────────────────────────────────────
function initStructures() {
  // Alliance base and barracks (center of map vertically)
  const aBase: Structure = {
    id: nextId('struct'), type: 'base', faction: 'alliance', pos: { x: 150, y: MAP_H / 2 },
    hp: 8000, maxHp: 8000, damage: 40, armor: 20, speed: 0, range: 250,
    target: null, alive: true, attackCd: 40, currentAttackCd: 0,
    structureType: 'base', tier: 0,
  };
  state.structures.set(aBase.id, aBase);

  const aBarracks: Structure = {
    id: nextId('struct'), type: 'barracks', faction: 'alliance', pos: { x: 500, y: MAP_H / 2 },
    hp: 3500, maxHp: 3500, damage: 0, armor: 15, speed: 0, range: 0,
    target: null, alive: true, attackCd: 0, currentAttackCd: 0,
    structureType: 'barracks', tier: 0,
  };
  state.structures.set(aBarracks.id, aBarracks);

  // Horde base and barracks
  const hBase: Structure = {
    id: nextId('struct'), type: 'base', faction: 'horde', pos: { x: MAP_W - 150, y: MAP_H / 2 },
    hp: 8000, maxHp: 8000, damage: 40, armor: 20, speed: 0, range: 250,
    target: null, alive: true, attackCd: 40, currentAttackCd: 0,
    structureType: 'base', tier: 0,
  };
  state.structures.set(hBase.id, hBase);

  const hBarracks: Structure = {
    id: nextId('struct'), type: 'barracks', faction: 'horde', pos: { x: MAP_W - 500, y: MAP_H / 2 },
    hp: 3500, maxHp: 3500, damage: 0, armor: 15, speed: 0, range: 0,
    target: null, alive: true, attackCd: 0, currentAttackCd: 0,
    structureType: 'barracks', tier: 0,
  };
  state.structures.set(hBarracks.id, hBarracks);

  // Per-lane towers: T2 (closer to base) and T1 (further out) for each lane per faction
  const uniqueLanes = [...new Set(LANE_NAMES)];
  for (const laneName of uniqueLanes) {
    const laneY = LANES[laneName].centerY;

    // Alliance T2 (inner tower)
    const aT2: Structure = {
      id: nextId('struct'), type: 'tower', faction: 'alliance', pos: { x: 900, y: laneY },
      hp: 3000, maxHp: 3000, damage: 55, armor: 18, speed: 0, range: 350,
      target: null, alive: true, attackCd: 30, currentAttackCd: 0,
      structureType: 'tower_t2', tier: 2, lane: laneName,
    };
    state.structures.set(aT2.id, aT2);

    // Alliance T1 (outer tower)
    const aT1: Structure = {
      id: nextId('struct'), type: 'tower', faction: 'alliance', pos: { x: 1500, y: laneY },
      hp: 2500, maxHp: 2500, damage: 45, armor: 15, speed: 0, range: 300,
      target: null, alive: true, attackCd: 25, currentAttackCd: 0,
      structureType: 'tower_t1', tier: 1, lane: laneName,
    };
    state.structures.set(aT1.id, aT1);

    // Horde T2 (inner tower)
    const hT2: Structure = {
      id: nextId('struct'), type: 'tower', faction: 'horde', pos: { x: MAP_W - 900, y: laneY },
      hp: 3000, maxHp: 3000, damage: 55, armor: 18, speed: 0, range: 350,
      target: null, alive: true, attackCd: 30, currentAttackCd: 0,
      structureType: 'tower_t2', tier: 2, lane: laneName,
    };
    state.structures.set(hT2.id, hT2);

    // Horde T1 (outer tower)
    const hT1: Structure = {
      id: nextId('struct'), type: 'tower', faction: 'horde', pos: { x: MAP_W - 1500, y: laneY },
      hp: 2500, maxHp: 2500, damage: 45, armor: 15, speed: 0, range: 300,
      target: null, alive: true, attackCd: 25, currentAttackCd: 0,
      structureType: 'tower_t1', tier: 1, lane: laneName,
    };
    state.structures.set(hT1.id, hT1);
  }
}

// ─── Jungle Camp Initialization ─────────────────────────────────────────
function initJungleCamps() {
  const campDefs: { x: number; y: number; isBoss: boolean }[] = [
    { x: 1200, y: 800, isBoss: false },   // between top and mid
    { x: 3600, y: 800, isBoss: false },   // between top and mid
    { x: 1200, y: 1600, isBoss: false },  // between mid and bot
    { x: 3600, y: 1600, isBoss: false },  // between mid and bot
    { x: 2400, y: 1200, isBoss: true },   // boss camp at center
  ];

  state.camps = campDefs.map(def => {
    const campId = nextId('camp');
    const monsterCount = def.isBoss ? 3 : 2;
    const monsterHp = def.isBoss ? 600 : 400;
    const monsterDmg = def.isBoss ? 25 : 15;
    const monsters: JungleMonster[] = [];
    for (let i = 0; i < monsterCount; i++) {
      monsters.push({
        id: nextId('jmon'),
        pos: { x: def.x + (i - 1) * 40, y: def.y + (i % 2 === 0 ? -20 : 20) },
        hp: monsterHp,
        maxHp: monsterHp,
        damage: monsterDmg,
        alive: true,
        campId,
      });
    }
    return {
      id: campId,
      pos: { x: def.x, y: def.y },
      monsters,
      respawnTimer: 0,
      isBoss: def.isBoss,
      goldReward: def.isBoss ? 250 : 100,
      xpReward: def.isBoss ? 100 : 50,
    };
  });
}

// ─── Hero Factory ────────────────────────────────────────────────────────────
function createHero(faction: Faction, heroClass: HeroClass, agentId: string | null, lane: LaneName = 'mid', displayName: string | null = null): HeroEntity {
  const stats = heroBaseStats(heroClass);
  const laneInfo = LANES[lane];
  const spawnX = faction === 'alliance' ? 200 + Math.random() * 100 : MAP_W - 300 + Math.random() * 100;
  const spawnY = laneInfo.minY + 20 + Math.random() * (laneInfo.maxY - laneInfo.minY - 40);
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
    tier: 1,
    abilities: createAbilities(heroClass),
    items: [],
    respawnTimer: 0,
    agentId,
    displayName,
    pendingAbilityId: null,
    moveTarget: null,
    lastDamagedBy: [],
    lane,
    focusTargetId: null,
    controlMode: 'auto',
  };
}

// ─── Wave Spawning ───────────────────────────────────────────────────────────
function getVotedUnits(faction: Faction): UnitDef[] {
  const vote = state.waveVotes[faction];
  if (faction === 'alliance') {
    const footman = ALLIANCE_UNITS.find(u => u.type === 'footman')!;
    const archer = ALLIANCE_UNITS.find(u => u.type === 'archer')!;
    const gryphon = ALLIANCE_UNITS.find(u => u.type === 'gryphon')!;
    const ballista = ALLIANCE_UNITS.find(u => u.type === 'ballista')!;
    if (vote === 'melee') return [footman, footman, footman, footman, footman, archer, footman, footman];
    if (vote === 'ranged') return [archer, archer, archer, archer, archer, footman, archer, archer];
    if (vote === 'heavy') return [ballista, ballista, gryphon, ballista, gryphon, ballista, gryphon, ballista];
    return null as any; // default
  } else {
    const ironwarrior = HORDE_UNITS.find(u => u.type === 'ironwarrior')!;
    const shredder = HORDE_UNITS.find(u => u.type === 'shredder')!;
    const warlock = HORDE_UNITS.find(u => u.type === 'warlock')!;
    const colossus = HORDE_UNITS.find(u => u.type === 'colossus')!;
    if (vote === 'melee') return [ironwarrior, ironwarrior, ironwarrior, ironwarrior, ironwarrior, shredder, ironwarrior, ironwarrior];
    if (vote === 'ranged') return [warlock, warlock, warlock, warlock, warlock, shredder, warlock, warlock];
    if (vote === 'heavy') return [colossus, colossus, shredder, colossus, shredder, colossus, shredder, colossus];
    return null as any; // default
  }
}

// ─── Wave Upgrade System ─────────────────────────────────────────────────────
const UPGRADE_POOL: { id: string; label: string }[] = [
  { id: 'dmg_up',       label: '+10% Damage' },
  { id: 'speed_up',     label: '+15% Speed' },
  { id: 'hp_up',        label: '+100 Max HP' },
  { id: 'armor_up',     label: '+5 Armor' },
  { id: 'regen_up',     label: '+3 HP/sec regen' },
  { id: 'mana_up',      label: '+50 Max Mana' },
  { id: 'cdr',          label: '-10% Ability Cooldown' },
  { id: 'ability_tier', label: '+1 Tier to lowest ability' },
];

// heroId → outstanding offer { choices, deadline }
const pendingUpgradeOffers = new Map<string, { choices: string[]; deadline: number; agentId: string }>();

function rollUpgradeChoices(): string[] {
  const pool = [...UPGRADE_POOL];
  const out: string[] = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0].id);
  }
  return out;
}

function applyUpgrade(hero: HeroEntity, upgradeId: string) {
  switch (upgradeId) {
    case 'dmg_up':    hero.damage = Math.floor(hero.damage * 1.10); break;
    case 'speed_up':  hero.speed = Math.floor(hero.speed * 1.15); break;
    case 'hp_up':     hero.maxHp += 100; hero.hp = Math.min(hero.maxHp, hero.hp + 100); break;
    case 'armor_up':  hero.armor += 5; break;
    case 'regen_up':  (hero as any).regen = ((hero as any).regen || 0) + 3; break;
    case 'mana_up':   hero.maxMana += 50; hero.mana = Math.min(hero.maxMana, hero.mana + 50); break;
    case 'cdr':
      for (const a of hero.abilities) a.cooldown = Math.max(5, Math.floor(a.cooldown * 0.90));
      break;
    case 'ability_tier': {
      let lowest = hero.abilities[0];
      for (const a of hero.abilities) if ((a.tier || 1) < (lowest.tier || 1)) lowest = a;
      if (lowest && (lowest.tier || 1) < (lowest.maxTier || 5)) {
        lowest.tier = (lowest.tier || 1) + 1;
        lowest.damage = Math.floor(lowest.damage * 1.15);
      }
      break;
    }
  }
}

function broadcastToAgent(agentId: string, msg: object) {
  // We don't track ws→agentId, so broadcast to everyone with the target
  // agentId in the payload; the client filters on its own agentId.
  const payload = JSON.stringify({ ...msg, targetAgentId: agentId });
  for (const ws of clients) {
    if (ws.readyState === 1) { try { ws.send(payload); } catch {} }
  }
}

function offerWaveUpgrades() {
  const deadline = Date.now() + 8000;
  for (const hero of state.heroes.values()) {
    if (!hero.alive || !hero.agentId) continue; // bot heroes skip
    const choices = rollUpgradeChoices();
    pendingUpgradeOffers.set(hero.id, { choices, deadline, agentId: hero.agentId });
    broadcastToAgent(hero.agentId, {
      type: 'wave_upgrade_offer',
      heroId: hero.id,
      choices: choices.map(id => ({ id, label: UPGRADE_POOL.find(u => u.id === id)?.label || id })),
      deadline,
    });
  }
}

function resolveExpiredUpgradeOffers() {
  const now = Date.now();
  for (const [heroId, offer] of pendingUpgradeOffers.entries()) {
    if (now < offer.deadline) continue;
    const hero = state.heroes.get(heroId);
    if (hero && hero.alive) {
      applyUpgrade(hero, offer.choices[0]); // auto-pick first
      broadcastToAgent(offer.agentId, {
        type: 'wave_upgrade_applied', heroId, upgradeId: offer.choices[0], auto: true,
      });
    }
    pendingUpgradeOffers.delete(heroId);
  }
}

function spawnWave() {
  state.waveCount++;
  offerWaveUpgrades();
  const scaling = 1 + state.waveCount * 0.03;

  // Era progression: Bronze → Silver → Gold → Platinum → Diamond
  const newEra = state.waveCount >= 20 ? 5 : state.waveCount >= 15 ? 4 : state.waveCount >= 10 ? 3 : state.waveCount >= 5 ? 2 : 1;
  if (newEra > state.era) {
    state.era = newEra;
  }
  const eraMultiplier = 1 + (state.era - 1) * 0.15; // +15% per era beyond Bronze

  // Alliance wave - distribute across all 3 lanes
  let allianceLaneIdx = 0;
  const aBarracks = [...state.structures.values()].find(s => s.faction === 'alliance' && s.structureType === 'barracks' && s.alive);
  if (aBarracks) {
    const votedUnits = getVotedUnits('alliance');
    const unitList = votedUnits || ALLIANCE_UNITS;
    const perUnit = votedUnits ? 1 : 2; // voted lists already have quantity baked in
    for (const def of unitList) {
      for (let i = 0; i < perUnit; i++) {
        const lane = LANE_NAMES[allianceLaneIdx % 3];
        const laneY = LANES[lane].centerY;
        const totalScaling = scaling * eraMultiplier;
        const u: UnitEntity = {
          id: nextId('unit'), type: 'unit', faction: 'alliance',
          pos: { x: aBarracks.pos.x + 50 + Math.random() * 40, y: laneY - 30 + Math.random() * 60 },
          hp: Math.floor(def.hp * totalScaling), maxHp: Math.floor(def.hp * totalScaling),
          damage: Math.floor(def.damage * totalScaling), armor: def.armor,
          speed: def.speed, range: def.range,
          target: null, alive: true,
          attackCd: 20, currentAttackCd: 0,
          unitType: def.type, wave: state.waveCount,
          lane,
        };
        state.units.set(u.id, u);
        allianceLaneIdx++;
      }
    }
    state.waveVotes.alliance = null; // Reset vote after spawning
  }

  // Horde wave - distribute across all 3 lanes
  let hordeLaneIdx = 0;
  const hBarracks = [...state.structures.values()].find(s => s.faction === 'horde' && s.structureType === 'barracks' && s.alive);
  if (hBarracks) {
    const votedUnits = getVotedUnits('horde');
    const unitList = votedUnits || HORDE_UNITS;
    const perUnit = votedUnits ? 1 : 2;
    for (const def of unitList) {
      for (let i = 0; i < perUnit; i++) {
        const lane = LANE_NAMES[hordeLaneIdx % 3];
        const laneY = LANES[lane].centerY;
        const totalScaling = scaling * eraMultiplier;
        const u: UnitEntity = {
          id: nextId('unit'), type: 'unit', faction: 'horde',
          pos: { x: hBarracks.pos.x - 50 - Math.random() * 40, y: laneY - 30 + Math.random() * 60 },
          hp: Math.floor(def.hp * totalScaling), maxHp: Math.floor(def.hp * totalScaling),
          damage: Math.floor(def.damage * totalScaling), armor: def.armor,
          speed: def.speed, range: def.range,
          target: null, alive: true,
          attackCd: 20, currentAttackCd: 0,
          unitType: def.type, wave: state.waveCount,
          lane,
        };
        state.units.set(u.id, u);
        hordeLaneIdx++;
      }
    }
    state.waveVotes.horde = null; // Reset vote after spawning
  }
}

// ─── Player Slot Helpers ─────────────────────────────────────────────────────
function countPlayerHeroes(faction: Faction): number {
  let n = 0;
  for (const h of state.heroes.values()) {
    if (h.faction === faction && h.agentId !== null) n++;
  }
  return n;
}

function findReplaceableBotHero(faction: Faction): HeroEntity | null {
  // Prefer alive bots so the player drops in immediately. Fall back to dead bots if needed.
  let dead: HeroEntity | null = null;
  for (const h of state.heroes.values()) {
    if (h.faction === faction && h.agentId === null) {
      if (h.alive) return h;
      if (!dead) dead = h;
    }
  }
  return dead;
}

function claimHeroSlot(agentId: string, name: string, faction: Faction, heroClass: HeroClass): HeroEntity | null {
  if (countPlayerHeroes(faction) >= MAX_PLAYERS_PER_FACTION) return null;
  const bot = findReplaceableBotHero(faction);
  if (!bot) return null;
  state.heroes.delete(bot.id);
  const playerHero = createHero(faction, heroClass, agentId, 'mid', name);
  applyMetaBonuses(playerHero, agentId); // permanent upgrades from $WAR spend
  state.heroes.set(playerHero.id, playerHero);
  bumpHeartbeat(agentId);
  return playerHero;
}

// Idle sweep: any player who hasn't pinged us in PLAYER_IDLE_TIMEOUT_MS gets
// converted back to a bot. Their hero stays in the arena (so the match doesn't
// shrink) but the slot is freed for queue/new players.
function sweepIdlePlayers() {
  const now = Date.now();
  const cutoff = now - PLAYER_IDLE_TIMEOUT_MS;
  let freed = 0;
  for (const hero of state.heroes.values()) {
    if (hero.agentId === null) continue;
    const last = playerHeartbeats.get(hero.agentId);
    if (last && last < cutoff) {
      console.log(`[IDLE] Freeing slot for ${hero.displayName || hero.agentId} — no heartbeat in ${Math.round((now - last) / 1000)}s`);
      hero.agentId = null;
      hero.displayName = null;
      hero.pendingAbilityId = null;
      hero.focusTargetId = null;
      playerHeartbeats.delete(hero.agentId as any);
      freed++;
    }
  }
  if (freed > 0) drainQueue();
}
setInterval(sweepIdlePlayers, 10_000);

function drainQueue() {
  for (let i = 0; i < joinQueue.length; ) {
    const entry = joinQueue[i];
    const hero = claimHeroSlot(entry.agentId, entry.name, entry.faction, entry.heroClass);
    if (hero) {
      console.log(`[QUEUE] Promoted ${entry.name} (${entry.faction}) from queue position ${i + 1}`);
      joinQueue.splice(i, 1);
    } else {
      i++;
    }
  }
}

function estimateQueueWaitMs(position: number): number {
  // Each match end + early disconnects rotate ~2 slots per match cycle
  return Math.ceil(position / 2) * AVG_MATCH_DURATION_MS;
}

// ─── AI Bot Heroes ───────────────────────────────────────────────────────────
function spawnBotHeroes() {
  // 5 heroes per faction: 2 top, 1 mid, 2 bot
  const laneAssignment: LaneName[] = ['mid', 'mid', 'mid', 'mid', 'mid'];
  const classes: HeroClass[] = ['knight', 'ranger', 'mage', 'priest', 'siegemaster'];
  for (let i = 0; i < classes.length; i++) {
    const hc = classes[i];
    const lane = laneAssignment[i];
    const aHero = createHero('alliance', hc, null, lane);
    state.heroes.set(aHero.id, aHero);
    const hHero = createHero('horde', hc, null, lane);
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
  // Cheer buff: +25% damage if the source's faction has an active rally
  const sourceHero = state.heroes.get(sourceId);
  let dmgMult = 1;
  if (sourceHero) {
    const buff = cheerBuffs[sourceHero.faction];
    if (buff && buff.expiresAt > Date.now()) dmgMult = 1.25;
  }
  const reduction = target.armor / (target.armor + 50);
  const dmg = Math.max(1, Math.floor(rawDmg * dmgMult * (1 - reduction)));
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
      const baseGold = 300 + streakBounty;
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
      state.kills.push({
        tick: state.tick, killerId: kHero.id, victimId: vHero.id,
        killerName: kHero.displayName || kHero.heroClass,
        victimName: vHero.displayName || vHero.heroClass,
        killerFaction: kHero.faction, victimFaction: vHero.faction,
        killerClass: kHero.heroClass, victimClass: vHero.heroClass,
        killerIsPlayer: kHero.agentId !== null,
        victimIsPlayer: vHero.agentId !== null,
        isRampage, bounty: baseGold,
      });

      // ELO update
      if (kHero.agentId && vHero.agentId) {
        updateEloOnKill(kHero.agentId, vHero.agentId);
      }

      // Mission hooks: first hero kill of the match, giant slayer, assists
      if (kHero.agentId) {
        bumpMission(kHero.agentId, 'first_blood', 1);
        if (vHero.level >= kHero.level + 3) bumpMission(kHero.agentId, 'giant_slayer', 1);
      }
      for (const dmgId of vHero.lastDamagedBy) {
        if (dmgId !== kHero.id) {
          const assister = state.heroes.get(dmgId);
          if (assister && assister.agentId) bumpMission(assister.agentId, 'assist_ace', 1);
        }
      }

      // Resolve First Blood prop market
      const firstBlood = propMarkets.find(p => p.id === 'first_blood' && !p.resolved);
      if (firstBlood) {
        firstBlood.resolved = true;
        firstBlood.winner = kHero.faction;
      }
    }
    vHero.lastDamagedBy = [];
  } else if (victim.type === 'unit') {
    if (killer && state.heroes.has(killer.id)) {
      const kHero = killer as HeroEntity;
      kHero.gold += 30;
      kHero.xp += 20;
      // Mission: farmer + wave_clearer
      if (kHero.agentId) {
        bumpMission(kHero.agentId, 'farmer', 1);
        bumpMission(kHero.agentId, 'wave_clearer', 1);
      }
    }
  } else if ((victim as Structure).structureType === 'tower_t1' || (victim as Structure).structureType === 'tower_t2') {
    // Mission: tower_breaker — award the last-hit hero's agent (if any)
    if (killer && killer.type === 'hero' && (killer as HeroEntity).agentId) {
      bumpMission((killer as HeroEntity).agentId!, 'tower_breaker', 1);
    }
    // Resolve First Tower Falls prop market — the *attacker's* faction wins
    const firstTower = propMarkets.find(p => p.id === 'first_tower' && !p.resolved);
    if (firstTower) {
      firstTower.resolved = true;
      firstTower.winner = victim.faction === 'alliance' ? 'horde' : 'alliance';
    }
  } else if ((victim as Structure).structureType === 'base') {
    // Resolve MVP Class prop market — the most kills hero class on the winning side
    const winningFaction: Faction = victim.faction === 'alliance' ? 'horde' : 'alliance';
    const winners = [...state.heroes.values()].filter(h => h.faction === winningFaction);
    if (winners.length > 0) {
      const mvp = winners.sort((a, b) => b.kills - a.kills)[0];
      const mvpMarket = propMarkets.find(p => p.id === 'mvp_class' && !p.resolved);
      if (mvpMarket) {
        mvpMarket.resolved = true;
        mvpMarket.winner = mvp.heroClass;
      }
    }
    // Game over
    state.winner = victim.faction === 'alliance' ? 'horde' : 'alliance';
    state.winnerAt = Date.now();
    // Mission: Untouchable — win without dying (daily)
    for (const h of state.heroes.values()) {
      if (h.agentId && h.faction === state.winner && h.deaths === 0) {
        bumpMission(h.agentId, 'no_deaths', 1);
      }
    }
    // $WAR victory bonus to every player on the winning faction
    for (const h of state.heroes.values()) {
      if (h.agentId && h.faction === state.winner) {
        grantWar(h.agentId, 50, 'Match victory');
      }
    }
    try {
      stmtEndMatch.run(Date.now(), state.winner, currentMatchId);
    } catch (_e) { /* ignore */ }
    // Calculate betting payouts
    calculatePayouts(state.winner);
    console.log(`[MATCH] ${state.winner.toUpperCase()} wins ${currentMatchId} — auto-restart in ${POSTGAME_DELAY_MS / 1000}s`);
  }
}

function applyEvolution(hero: HeroEntity) {
  // Tier 2 at level 5
  if (hero.level === 5) {
    hero.tier = 2;
    hero.maxHp = Math.round(hero.maxHp * 1.4);
    hero.hp = hero.maxHp;
    hero.damage = Math.round(hero.damage * 1.3);
    hero.armor += 5;
    hero.maxMana = Math.round(hero.maxMana * 1.2);
    hero.mana = hero.maxMana;
  }
  // Tier 3 at level 10
  if (hero.level === 10) {
    hero.tier = 3;
    hero.maxHp = Math.round(hero.maxHp * 1.3);
    hero.hp = hero.maxHp;
    hero.damage = Math.round(hero.damage * 1.25);
    hero.armor += 8;
    hero.speed += 15;
    hero.maxMana = Math.round(hero.maxMana * 1.3);
    hero.mana = hero.maxMana;
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

    // Hero evolution at tier thresholds
    applyEvolution(hero);

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

  const baseX = hero.faction === 'alliance' ? 150 : MAP_W - 150;
  const baseY = MAP_H / 2;
  const distToBase = dist(hero.pos, { x: baseX, y: baseY });

  // Mana regen
  hero.mana = Math.min(hero.maxMana, hero.mana + 0.3);

  // HP regen (5x faster near own base)
  const regenMult = distToBase < 200 ? 5 : 1;
  hero.hp = Math.min(hero.maxHp, hero.hp + 0.1 * regenMult);

  // Retreat behavior: if HP < 30%, move toward own base
  if (hero.hp < hero.maxHp * 0.3) {
    hero.pos = moveToward(hero.pos, { x: baseX, y: baseY }, hero.speed, dt, hero.lane);
    // Still tick cooldowns while retreating
    for (const ab of hero.abilities) { if (ab.currentCd > 0) ab.currentCd--; }
    if (hero.currentAttackCd > 0) hero.currentAttackCd--;
    checkLevelUp(hero);
    return;
  }

  // Heal at base: if HP < 50%, move toward base
  if (hero.hp < hero.maxHp * 0.5) {
    hero.pos = moveToward(hero.pos, { x: baseX, y: baseY }, hero.speed, dt, hero.lane);
    // If near base, just regen (handled above with 5x mult), but still fight if enemies close
  }

  // Lane switching: if all towers in our lane are dead, roam to help another lane
  const myLaneTowers = [...state.structures.values()].filter(
    s => s.alive && s.faction === hero.faction && s.lane === hero.lane &&
    (s.structureType === 'tower_t1' || s.structureType === 'tower_t2')
  );
  if (myLaneTowers.length === 0) {
    // Find a lane that still has towers
    for (const ln of LANE_NAMES) {
      if (ln === hero.lane) continue;
      const laneTowers = [...state.structures.values()].filter(
        s => s.alive && s.faction === hero.faction && s.lane === ln &&
        (s.structureType === 'tower_t1' || s.structureType === 'tower_t2')
      );
      if (laneTowers.length > 0) {
        hero.lane = ln;
        break;
      }
    }
  }

  const allEntities: Entity[] = [
    ...[...state.heroes.values()].filter(h => h.alive),
    ...[...state.units.values()].filter(u => u.alive),
    ...[...state.structures.values()].filter(s => s.alive),
  ];

  // Focus fire: prioritize low HP enemies (< 40%) among nearby targets
  let target: Entity | null = null;
  let bestDist = Infinity;
  let foundLowHp = false;
  for (const e of allEntities) {
    if (!e.alive || e.faction === hero.faction) continue;
    const d = dist(hero.pos, e.pos);
    const isLowHp = e.hp < e.maxHp * 0.4;
    // Prefer low HP targets; among same priority, prefer closer
    if (isLowHp && !foundLowHp) {
      foundLowHp = true;
      bestDist = d;
      target = e;
    } else if (isLowHp === foundLowHp && d < bestDist) {
      bestDist = d;
      target = e;
    }
  }

  if (!target) {
    // Tick cooldowns even without target
    for (const ab of hero.abilities) { if (ab.currentCd > 0) ab.currentCd--; }
    if (hero.currentAttackCd > 0) hero.currentAttackCd--;
    checkLevelUp(hero);
    return;
  }

  const d = dist(hero.pos, target.pos);
  const targetIsHero = target.type === 'hero';

  // Use abilities with smarter selection
  for (const ab of hero.abilities) {
    if (ab.currentCd > 0) { ab.currentCd--; continue; }
    if (hero.mana < ab.manaCost) continue;
    if (d > ab.range && ab.range > 0) continue;
    if (ab.effect === 'heal' && hero.hp > hero.maxHp * 0.6) continue;
    if (ab.effect === 'armor_buff' && hero.hp > hero.maxHp * 0.5) continue;

    // Save high-cooldown abilities (>= 150) for heroes, use low-CD ones on units
    if (ab.cooldown >= 150 && !targetIsHero && ab.damage > 0) continue;

    hero.mana -= ab.manaCost;
    ab.currentCd = ab.cooldown;

    if (ab.effect === 'heal') {
      const healTarget = hero.hp < hero.maxHp * 0.5 ? hero :
        [...state.heroes.values()].find(h => h.alive && h.faction === hero.faction && h.hp < h.maxHp * 0.5 && dist(h.pos, hero.pos) < ab.range) || hero;
      healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + Math.abs(ab.damage) * ab.tier);
    } else if (ab.effect === 'dash' || ab.effect === 'teleport') {
      hero.pos = moveToward(hero.pos, target.pos, ab.range * 0.8, 1, hero.lane);
    } else if (ab.aoe > 0) {
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

  // Move toward target or attack (respect lane bounds)
  // Ranged classes kite: if a melee enemy is closer than half their range, back off
  // while still firing.
  const isRanged = hero.range >= 200;
  const closestEnemyHero = [...state.heroes.values()]
    .filter(h => h.alive && h.faction !== hero.faction)
    .map(h => ({ h, d: dist(hero.pos, h.pos) }))
    .sort((a, b) => a.d - b.d)[0];
  const meleeThreatNearby = isRanged && closestEnemyHero && closestEnemyHero.d < 180;

  if (d > hero.range) {
    hero.pos = moveToward(hero.pos, target.pos, hero.speed, dt, hero.lane);
  } else if (meleeThreatNearby && closestEnemyHero && closestEnemyHero.d > 1) {
    // Kite — step away from the melee threat while still attacking the focus target.
    // Guard against zero distance (would produce NaN positions that persist forever).
    const away = {
      x: hero.pos.x + (hero.pos.x - closestEnemyHero.h.pos.x) / closestEnemyHero.d * 100,
      y: hero.pos.y + (hero.pos.y - closestEnemyHero.h.pos.y) / closestEnemyHero.d * 100,
    };
    hero.pos = moveToward(hero.pos, away, hero.speed * 0.7, dt, hero.lane);
    if (hero.currentAttackCd <= 0 && d <= hero.range) {
      applyDamage(target, hero.damage, hero.id);
      hero.currentAttackCd = hero.attackCd;
      state.projectiles.push({
        id: nextId('proj'), from: { ...hero.pos }, to: { ...target.pos },
        progress: 0, speed: 0.1, damage: 0, sourceId: hero.id, targetId: target.id,
        faction: hero.faction, color: hero.faction === 'alliance' ? '#aaccff' : '#ffaa88',
      });
    }
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

  // Smart item buying: boots first, then damage, then defensive if dying often
  if (hero.items.length < 5) {
    const owned = new Set(hero.items.map(i => i.id));
    let itemToBuy: Item | undefined;

    // Priority 1: boots for speed
    if (!owned.has('boots') && hero.gold >= 200) {
      itemToBuy = SHOP_ITEMS.find(i => i.id === 'boots');
    }
    // Priority 2: if dying often (deaths > kills), buy defensive
    else if (!owned.has('shield') && hero.deaths > hero.kills && hero.gold >= 250) {
      itemToBuy = SHOP_ITEMS.find(i => i.id === 'shield');
    }
    // Priority 3: damage items
    else if (!owned.has('sword') && hero.gold >= 300) {
      itemToBuy = SHOP_ITEMS.find(i => i.id === 'sword');
    }
    // Priority 4: utility
    else if (!owned.has('cloak') && hero.gold >= 200) {
      itemToBuy = SHOP_ITEMS.find(i => i.id === 'cloak');
    }
    // Priority 5: relic (expensive)
    else if (!owned.has('relic') && hero.gold >= 600) {
      itemToBuy = SHOP_ITEMS.find(i => i.id === 'relic');
    }

    if (itemToBuy) {
      hero.gold -= itemToBuy.cost;
      hero.items.push(itemToBuy);
      if (itemToBuy.stats.hp) { hero.maxHp += itemToBuy.stats.hp; hero.hp += itemToBuy.stats.hp; }
      if (itemToBuy.stats.damage) hero.damage += itemToBuy.stats.damage;
      if (itemToBuy.stats.armor) hero.armor += itemToBuy.stats.armor;
      if (itemToBuy.stats.speed) hero.speed += itemToBuy.stats.speed;
      if (itemToBuy.stats.mana) { hero.maxMana += itemToBuy.stats.mana; hero.mana += itemToBuy.stats.mana; }
    }
  }

  checkLevelUp(hero);
}

// ─── Player Hero Tick (replaces heroAI for player-controlled heroes) ────────
function playerHeroTick(hero: HeroEntity, dt: number) {
  if (!hero.alive) return;

  const baseX = hero.faction === 'alliance' ? 150 : MAP_W - 150;
  const baseY = MAP_H / 2;
  const distToBase = dist(hero.pos, { x: baseX, y: baseY });

  // Mana regen
  hero.mana = Math.min(hero.maxMana, hero.mana + 0.3);

  // HP regen (5x faster near own base)
  const regenMult = distToBase < 200 ? 5 : 1;
  hero.hp = Math.min(hero.maxHp, hero.hp + 0.1 * regenMult);

  // Passive gold (same as bot)
  if (state.tick % 40 === 0) hero.gold += 3;
  // Mission: Survivor — +1 sec every 20 ticks while alive
  if (state.tick % 20 === 0 && hero.alive && hero.agentId) {
    bumpMission(hero.agentId, 'survivor', 1);
  }

  // Tick ability cooldowns
  for (const ab of hero.abilities) {
    if (ab.currentCd > 0) ab.currentCd--;
  }

  // Freeform movement: walk toward the stored moveTarget at ~3.5x normal
  // tick speed so it feels responsive under WASD. The client sends a
  // destination via /api/strategy/deployment move; the tick loop walks there
  // smoothly at 20Hz so movement flows instead of stuttering across the map.
  if (hero.controlMode === 'manual') {
    // Smooth movement toward moveTarget for manual-mode heroes
    if (hero.moveTarget) {
      const dx = hero.moveTarget.x - hero.pos.x;
      const dy = hero.moveTarget.y - hero.pos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 5) {
        const step = Math.min(hero.speed * 3.5 * dt, d);
        hero.pos.x += (dx / d) * step;
        hero.pos.y += (dy / d) * step;
      } else {
        hero.moveTarget = null; // Arrived
      }
    }
  } else if (hero.moveTarget && !hero.focusTargetId) {
    const d = dist(hero.pos, hero.moveTarget);
    if (d < 8) {
      hero.moveTarget = null; // arrived
    } else {
      hero.pos = moveToward(hero.pos, hero.moveTarget, hero.speed * 3.5, dt);
    }
  }

  // Focus target: move toward and auto-attack OR fire pending queued ability
  if (hero.focusTargetId) {
    const target = state.heroes.get(hero.focusTargetId)
      || state.units.get(hero.focusTargetId)
      || [...state.structures.values()].find(s => s.id === hero.focusTargetId);

    if (!target || !target.alive) {
      hero.focusTargetId = null;
      hero.pendingAbilityId = null;
    } else {
      const d = dist(hero.pos, target.pos);

      // If we have a queued ability, decide what range we need
      let pendingAb: Ability | null = null;
      if (hero.pendingAbilityId) {
        pendingAb = hero.abilities.find(a => a.id === hero.pendingAbilityId) || null;
        if (!pendingAb) hero.pendingAbilityId = null;
      }
      const desiredRange = pendingAb ? pendingAb.range : hero.range;

      if (d > desiredRange) {
        // Walk in. Players don't get lane clamping — full map movement.
        // Manual mode heroes chase focus targets too (smooth walk-in).
        hero.pos = moveToward(hero.pos, target.pos, hero.speed * 1.5, dt);
      } else if (pendingAb) {
        // In range — fire the queued ability
        const queuedId = hero.pendingAbilityId!;
        hero.pendingAbilityId = null;
        castPlayerAbility(hero, pendingAb, target.id);
        // After cast, keep focus for follow-up auto-attacks
        // (focusTargetId stays set so the chase continues)
        void queuedId;
      } else if (hero.currentAttackCd <= 0) {
        // Standard auto-attack
        applyDamage(target, hero.damage, hero.id);
        hero.currentAttackCd = hero.attackCd;
        state.projectiles.push({
          id: nextId('proj'), from: { ...hero.pos }, to: { ...target.pos },
          progress: 0, speed: 0.1, damage: 0, sourceId: hero.id, targetId: target.id,
          faction: hero.faction, color: hero.faction === 'alliance' ? '#aaccff' : '#ffaa88',
        });
        combatEvents.push({
          type: 'auto_attack', sourceId: hero.id, targetId: target.id,
          damage: Math.max(1, Math.floor(hero.damage * (1 - target.armor / (target.armor + 50)))),
          x: Math.round(target.pos.x), y: Math.round(target.pos.y),
        });
      }
    }
  }

  // Auto-target nearest enemy in range if no focus target (DOTA-style auto-attack)
  if (!hero.focusTargetId && hero.currentAttackCd <= 0) {
    let nearest: Entity | null = null;
    let nearDist = hero.range + 50; // slight buffer beyond attack range
    // Check enemy heroes
    for (const h of state.heroes.values()) {
      if (!h.alive || h.faction === hero.faction) continue;
      const d = dist(hero.pos, h.pos);
      if (d < nearDist) { nearDist = d; nearest = h; }
    }
    // Check enemy units
    for (const u of state.units.values()) {
      if (!u.alive || u.faction === hero.faction) continue;
      const d = dist(hero.pos, u.pos);
      if (d < nearDist) { nearDist = d; nearest = u; }
    }
    // Check enemy structures
    for (const s of state.structures.values()) {
      if (!s.alive || s.faction === hero.faction) continue;
      const d = dist(hero.pos, s.pos);
      if (d < nearDist) { nearDist = d; nearest = s; }
    }
    if (nearest && nearDist <= hero.range) {
      applyDamage(nearest, hero.damage, hero.id);
      hero.currentAttackCd = hero.attackCd;
      state.projectiles.push({
        id: nextId('proj'), from: { ...hero.pos }, to: { ...nearest.pos },
        progress: 0, speed: 0.1, damage: 0, sourceId: hero.id, targetId: nearest.id,
        faction: hero.faction, color: hero.faction === 'alliance' ? '#aaccff' : '#ffaa88',
      });
    }
  }

  if (hero.currentAttackCd > 0) hero.currentAttackCd--;
  checkLevelUp(hero);
}

// ─── Cast ability for player hero ───────────────────────────────────────────
function castPlayerAbility(hero: HeroEntity, ab: Ability, targetId?: string): { success: boolean; damage?: number; healed?: number; targets?: number; error?: string } {
  const allEntities: Entity[] = [
    ...[...state.heroes.values()].filter(h => h.alive),
    ...[...state.units.values()].filter(u => u.alive),
    ...[...state.structures.values()].filter(s => s.alive),
  ];

  // Find target — prefer specified targetId, then focusTarget, then nearest enemy
  let target: Entity | null = null;
  if (targetId) {
    target = allEntities.find(e => e.id === targetId) || null;
  }
  if (!target && hero.focusTargetId) {
    target = allEntities.find(e => e.id === hero.focusTargetId && e.alive) || null;
  }
  if (!target) {
    // Nearest enemy in range
    let bestDist = Infinity;
    for (const e of allEntities) {
      if (e.faction === hero.faction || !e.alive) continue;
      const d = dist(hero.pos, e.pos);
      if (d < bestDist) { bestDist = d; target = e; }
    }
  }

  // Deduct mana and set cooldown
  hero.mana -= ab.manaCost;
  ab.currentCd = ab.cooldown;

  if (ab.effect === 'heal') {
    // Heal self or nearby injured ally
    const healTarget = hero.hp < hero.maxHp * 0.5 ? hero :
      [...state.heroes.values()].find(h => h.alive && h.faction === hero.faction && h.hp < h.maxHp * 0.5 && dist(h.pos, hero.pos) < ab.range) || hero;
    const healAmt = Math.abs(ab.damage) * ab.tier;
    healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + healAmt);
    combatEvents.push({
      type: 'ability_heal', sourceId: hero.id, targetId: healTarget.id,
      abilityName: ab.name, healed: Math.round(healAmt), effect: 'heal',
      x: Math.round(healTarget.pos.x), y: Math.round(healTarget.pos.y),
    });
    if (ab.aoe > 0) {
      // Mass heal
      let healed = 1;
      for (const e of allEntities) {
        if (e.faction !== hero.faction || !e.alive || e.id === healTarget.id) continue;
        if (dist(healTarget.pos, e.pos) < ab.aoe) {
          e.hp = Math.min(e.maxHp, e.hp + healAmt);
          healed++;
          combatEvents.push({
            type: 'ability_heal', sourceId: hero.id, targetId: e.id,
            abilityName: ab.name, healed: Math.round(healAmt), effect: 'heal', aoe: true,
            x: Math.round(e.pos.x), y: Math.round(e.pos.y),
          });
        }
      }
      return { success: true, healed: Math.round(healAmt), targets: healed };
    }
    return { success: true, healed: Math.round(healAmt), targets: 1 };
  }

  if (ab.effect === 'dash' || ab.effect === 'teleport') {
    if (target) {
      hero.pos = moveToward(hero.pos, target.pos, ab.range * 0.8, 1, hero.lane);
    }
    combatEvents.push({
      type: 'ability_hit', sourceId: hero.id, targetId: target?.id || null,
      abilityName: ab.name, effect: ab.effect,
      x: Math.round(hero.pos.x), y: Math.round(hero.pos.y),
    });
    return { success: true };
  }

  if (ab.effect === 'armor_buff' || ab.effect === 'invuln' || ab.effect === 'tower_buff' || ab.effect === 'transform' || ab.effect === 'team_buff') {
    combatEvents.push({
      type: 'ability_hit', sourceId: hero.id, targetId: hero.id,
      abilityName: ab.name, effect: ab.effect,
      x: Math.round(hero.pos.x), y: Math.round(hero.pos.y),
    });
    return { success: true };
  }

  if (!target || target.faction === hero.faction) {
    // No valid enemy target found — refund
    hero.mana += ab.manaCost;
    ab.currentCd = 0;
    return { success: false, error: 'No enemy target in range' };
  }

  const d = dist(hero.pos, target.pos);
  if (d > ab.range + 100) {
    // Out of range — refund mana/cooldown and queue the cast.
    // The player tick will auto-walk toward the target via focusTargetId,
    // and re-fire the cast when in range.
    hero.mana += ab.manaCost;
    ab.currentCd = 0;
    hero.focusTargetId = target.id;
    hero.pendingAbilityId = ab.id;
    return { success: true, queued: true, error: 'Moving into range...' } as any;
  }

  // Damage ability
  if (ab.aoe > 0) {
    let hitCount = 0;
    let totalDmg = 0;
    for (const e of allEntities) {
      if (e.faction === hero.faction || !e.alive) continue;
      if (dist(target.pos, e.pos) < ab.aoe) {
        const dmg = ab.damage * ab.tier;
        applyDamage(e, dmg, hero.id);
        hitCount++;
        totalDmg += Math.max(1, Math.floor(dmg * (1 - e.armor / (e.armor + 50))));
        combatEvents.push({
          type: 'ability_hit', sourceId: hero.id, targetId: e.id,
          abilityName: ab.name, damage: Math.max(1, Math.floor(dmg * (1 - e.armor / (e.armor + 50)))),
          effect: ab.effect, aoe: true,
          x: Math.round(e.pos.x), y: Math.round(e.pos.y),
        });
        if (hero.agentId) bumpMission(hero.agentId, 'ability_chain', 1);
      }
    }
    state.projectiles.push({
      id: nextId('proj'), from: { ...hero.pos }, to: { ...target.pos },
      progress: 0, speed: 0.15, damage: 0, sourceId: hero.id, targetId: target.id,
      faction: hero.faction, color: hero.faction === 'alliance' ? '#4488ff' : '#ff4444',
    });
    return { success: true, damage: totalDmg, targets: hitCount };
  } else {
    const dmg = ab.damage * ab.tier;
    applyDamage(target, dmg, hero.id);
    const actualDmg = Math.max(1, Math.floor(dmg * (1 - target.armor / (target.armor + 50))));
    state.projectiles.push({
      id: nextId('proj'), from: { ...hero.pos }, to: { ...target.pos },
      progress: 0, speed: 0.12, damage: 0, sourceId: hero.id, targetId: target.id,
      faction: hero.faction, color: hero.faction === 'alliance' ? '#66bbff' : '#ff6644',
    });
    combatEvents.push({
      type: 'ability_hit', sourceId: hero.id, targetId: target.id,
      abilityName: ab.name, damage: actualDmg, effect: ab.effect,
      x: Math.round(target.pos.x), y: Math.round(target.pos.y),
    });
    if (hero.agentId) bumpMission(hero.agentId, 'ability_chain', 1);
    return { success: true, damage: actualDmg, targets: 1 };
  }
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
    // March toward enemy base along own lane
    const baseX = unit.faction === 'alliance' ? MAP_W - 150 : 150;
    const laneY = LANES[unit.lane].centerY;
    unit.pos = moveToward(unit.pos, { x: baseX, y: laneY }, unit.speed, dt, unit.lane);
    return;
  }

  const d = dist(unit.pos, target.pos);
  if (d > unit.range) {
    unit.pos = moveToward(unit.pos, target.pos, unit.speed, dt, unit.lane);
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
        // Spawn at own base — not random in mid lane. Players need a clear,
        // consistent respawn point so death isn't disorienting.
        const baseX = hero.faction === 'alliance' ? 200 : MAP_W - 200;
        const baseY = MAP_H / 2 + (Math.random() - 0.5) * 80;
        hero.pos = { x: baseX, y: baseY };
        // Clear any stale move/attack commands from before death
        hero.moveTarget = null;
        hero.focusTargetId = null;
        hero.pendingAbilityId = null;
      }
    }
  }
}

// ─── Main Game Loop ──────────────────────────────────────────────────────────
const POSTGAME_DELAY_MS = 30_000;

function gameTick() {
  if (paused) return;
  resolveExpiredUpgradeOffers(); // auto-pick any upgrade offers that timed out
  if (state.winner) {
    if (state.winnerAt && Date.now() - state.winnerAt >= POSTGAME_DELAY_MS) {
      console.log(`[MATCH] Auto-restarting after ${POSTGAME_DELAY_MS / 1000}s post-game delay`);
      resetGame();
    }
    return;
  }

  // NaN sweeper: any hero with a bad position gets teleported back to a safe
  // spot in their lane. Prevents ghost/invisible heroes from persisting.
  for (const hero of state.heroes.values()) {
    if (!isFinite(hero.pos.x) || !isFinite(hero.pos.y)) {
      const laneInfo = LANES[hero.lane] || LANES.mid;
      const baseX = hero.faction === 'alliance' ? 250 : MAP_W - 250;
      hero.pos = { x: baseX, y: (laneInfo.minY + laneInfo.maxY) / 2 };
      console.log(`[NAN-SWEEP] Reset ${hero.id} (${hero.heroClass}/${hero.faction}) to ${baseX},${hero.pos.y}`);
    }
  }

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
  if (state.waveTimer >= 35_000) {
    state.waveTimer = 0;
    spawnWave();
  }

  // Update heroes
  for (const hero of state.heroes.values()) {
    const herodt = dt * (hero.faction === 'horde' ? nightMult : dayMult);
    if (hero.agentId) {
      playerHeroTick(hero, herodt);
    } else {
      heroAI(hero, herodt);
    }
  }

  // Update units
  for (const unit of state.units.values()) {
    unitAI(unit, dt * (unit.faction === 'horde' ? nightMult : dayMult));
  }

  // Update structures
  for (const struct of state.structures.values()) {
    structureAI(struct);
  }

  // HARD CLAMP: force ALL units and heroes into their lane bounds every tick
  for (const hero of state.heroes.values()) {
    const lb = LANES[hero.lane];
    hero.pos.y = Math.max(lb.minY, Math.min(lb.maxY, hero.pos.y));
  }
  for (const unit of state.units.values()) {
    const lb = LANES[unit.lane];
    unit.pos.y = Math.max(lb.minY, Math.min(lb.maxY, unit.pos.y));
  }

  // ─── Jungle Camp Tick ──────────────────────────────────────────────────
  for (const camp of state.camps) {
    const aliveMonsters = camp.monsters.filter(m => m.alive);
    if (aliveMonsters.length === 0) {
      // Camp cleared - tick respawn timer
      camp.respawnTimer--;
      if (camp.respawnTimer <= 0) {
        // Respawn all monsters
        for (const m of camp.monsters) {
          m.alive = true;
          m.hp = m.maxHp;
        }
        camp.respawnTimer = 0;
      }
    } else {
      // Camp is alive - check if any hero is attacking it
      for (const hero of state.heroes.values()) {
        if (!hero.alive) continue;
        for (const monster of aliveMonsters) {
          const d = dist(hero.pos, monster.pos);
          if (d < hero.range + 50) {
            // Hero attacks monster
            if (hero.currentAttackCd <= 0) {
              const reduction = 0; // monsters have no armor
              const dmg = Math.max(1, hero.damage);
              monster.hp -= dmg;
              if (monster.hp <= 0) {
                monster.hp = 0;
                monster.alive = false;
                // Reward the hero
                hero.gold += camp.goldReward;
                hero.xp += camp.xpReward;
                // Check if camp is now cleared
                if (camp.monsters.every(m => !m.alive)) {
                  camp.respawnTimer = 60 * TICK_RATE; // 60 seconds
                }
              }
            }
            // Monster fights back
            if (monster.alive && d < 100) {
              applyDamage(hero, monster.damage, monster.id);
            }
          }
        }
      }
    }
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
      if (hero.alive) hero.gold += 3;
    }
  }
}

// ─── Serialize State ─────────────────────────────────────────────────────────
function serializeState() {
  // ─── Fog of War: compute vision sources per faction ──────────────────
  const fogOfWar: { alliance: { x: number; y: number; radius: number }[]; horde: { x: number; y: number; radius: number }[] } = {
    alliance: [],
    horde: [],
  };
  // Heroes as vision sources
  for (const h of state.heroes.values()) {
    if (!h.alive) continue;
    fogOfWar[h.faction].push({ x: Math.round(h.pos.x), y: Math.round(h.pos.y), radius: VISION_RADIUS });
  }
  // Units as vision sources
  for (const u of state.units.values()) {
    if (!u.alive) continue;
    fogOfWar[u.faction].push({ x: Math.round(u.pos.x), y: Math.round(u.pos.y), radius: VISION_RADIUS });
  }
  // Structures as vision sources
  for (const s of state.structures.values()) {
    if (!s.alive) continue;
    fogOfWar[s.faction].push({ x: Math.round(s.pos.x), y: Math.round(s.pos.y), radius: VISION_RADIUS });
  }

  return {
    tick: state.tick,
    time: state.time,
    phase: state.phase,
    winner: state.winner,
    winnerAt: state.winnerAt,
    matchId: currentMatchId,
    postgameDelayMs: POSTGAME_DELAY_MS,
    waveCount: state.waveCount,
    era: state.era,
    waveVotes: state.waveVotes,
    turrets: {
      alliance: { lastFired: state.turrets.alliance.lastFired, cooldown: state.turrets.alliance.cooldown },
      horde: { lastFired: state.turrets.horde.lastFired, cooldown: state.turrets.horde.cooldown },
    },
    slots: {
      alliance: { used: countPlayerHeroes('alliance'), max: MAX_PLAYERS_PER_FACTION },
      horde: { used: countPlayerHeroes('horde'), max: MAX_PLAYERS_PER_FACTION },
    },
    queueLength: joinQueue.length,
    heroes: [...state.heroes.values()].map(h => ({
      id: h.id, faction: h.faction, heroClass: h.heroClass,
      x: Math.round(h.pos.x), y: Math.round(h.pos.y),
      hp: Math.round(h.hp), maxHp: h.maxHp,
      mana: Math.round(h.mana), maxMana: h.maxMana,
      level: h.level, gold: h.gold,
      xp: h.xp, xpToNext: h.xpToNext,
      tier: h.tier,
      kills: h.kills, deaths: h.deaths, assists: h.assists,
      killStreak: h.killStreak, alive: h.alive,
      damage: h.damage, armor: h.armor,
      items: h.items.map(i => i.name),
      abilities: h.abilities.map(a => ({ id: a.id, name: a.name, tier: a.tier, cd: a.currentCd })),
      agentId: h.agentId,
      displayName: h.displayName,
      respawnIn: h.alive ? 0 : h.respawnTimer,
      lane: h.lane,
      focusTargetId: h.focusTargetId,
      controlMode: h.controlMode,
      moveTarget: h.moveTarget ? { x: Math.round(h.moveTarget.x), y: Math.round(h.moveTarget.y) } : null,
    })),
    units: [...state.units.values()].map(u => ({
      id: u.id, faction: u.faction, unitType: u.unitType,
      x: Math.round(u.pos.x), y: Math.round(u.pos.y),
      hp: Math.round(u.hp), maxHp: u.maxHp, alive: u.alive,
      lane: u.lane,
    })),
    structures: [...state.structures.values()].map(s => ({
      id: s.id, faction: s.faction, structureType: s.structureType,
      x: Math.round(s.pos.x), y: Math.round(s.pos.y),
      hp: Math.round(s.hp), maxHp: s.maxHp, alive: s.alive, tier: s.tier,
      lane: s.lane || null,
    })),
    camps: state.camps.map(c => ({
      id: c.id,
      x: Math.round(c.pos.x), y: Math.round(c.pos.y),
      isBoss: c.isBoss,
      monsters: c.monsters.map(m => ({
        id: m.id,
        x: Math.round(m.pos.x), y: Math.round(m.pos.y),
        hp: Math.round(m.hp), maxHp: m.maxHp, alive: m.alive,
      })),
      respawnIn: c.respawnTimer > 0 ? Math.ceil(c.respawnTimer / TICK_RATE) : 0,
    })),
    projectiles: state.projectiles.map(p => ({
      id: p.id, fx: Math.round(p.from.x), fy: Math.round(p.from.y),
      tx: Math.round(p.to.x), ty: Math.round(p.to.y),
      p: +p.progress.toFixed(2), color: p.color, faction: p.faction,
    })),
    kills: state.kills.slice(-5),
    combatEvents: combatEvents.slice(-20),
    fogOfWar,
    bets: {
      alliance: bettingState.bets.alliance,
      horde: bettingState.bets.horde,
      count: bettingState.betters.length,
    },
  };
}

// ─── Express + WebSocket ─────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/docs', express.static(path.join(__dirname, '..', 'public', 'docs')));
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set<WebSocket>();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
  // Chat relay
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'chat' && msg.text) {
        const relay = JSON.stringify({ type: 'chat', name: String(msg.name || 'Anon').slice(0, 20), text: String(msg.text).slice(0, 120) });
        for (const c of clients) { if (c !== ws && c.readyState === WebSocket.OPEN) c.send(relay); }
      }
      // ─── Direct hero control (manual mode) ─────────────────────────────
      if (msg.type === 'hero_move') {
        const hero = [...state.heroes.values()].find(h => h.agentId === msg.agentId);
        if (!hero || !hero.alive) return;
        if (hero.controlMode !== 'manual') return;
        const x = Math.max(0, Math.min(MAP_W, Number(msg.x) || hero.pos.x));
        const y = Math.max(0, Math.min(MAP_H, Number(msg.y) || hero.pos.y));
        hero.moveTarget = { x, y };  // Server will move hero toward this each tick
      }
      if (msg.type === 'hero_attack') {
        const hero = [...state.heroes.values()].find(h => h.agentId === msg.agentId);
        if (!hero || !hero.alive) return;
        hero.focusTargetId = msg.targetId || null;
      }
      if (msg.type === 'hero_ability') {
        const hero = [...state.heroes.values()].find(h => h.agentId === msg.agentId);
        if (!hero || !hero.alive) return;
        const abilityId = msg.abilityId;
        if (!abilityId) return;
        // Set pending ability - the existing tick loop will process it
        hero.pendingAbilityId = abilityId;
        // If targeting a position, set move target to walk into range
        if (msg.targetX !== undefined && msg.targetY !== undefined) {
          hero.moveTarget = { x: Math.max(0, Math.min(MAP_W, Number(msg.targetX))), y: Math.max(0, Math.min(MAP_H, Number(msg.targetY))) };
        }
        // If targeting an entity, focus on it
        if (msg.targetId) {
          hero.focusTargetId = msg.targetId;
        }
      }
      if (msg.type === 'hero_ultimate') {
        const hero = [...state.heroes.values()].find(h => h.agentId === msg.agentId);
        if (!hero || !hero.alive) return;
        // Ultimate is always the last ability (index 5)
        const ult = hero.abilities[hero.abilities.length - 1];
        if (!ult || ult.currentCd > 0) return;
        if (hero.mana < ult.manaCost) return;
        hero.mana -= ult.manaCost;
        ult.currentCd = ult.cooldown;

        // Apply ultimate effects based on hero class
        const enemies = [...state.heroes.values(), ...state.units.values()]
          .filter(e => e.alive && e.faction !== hero.faction);
        const allies = [...state.heroes.values()]
          .filter(h => h.alive && h.faction === hero.faction);

        if (ult.effect === 'ultimate_aoe') {
          // Holy Judgment: damage all enemies
          for (const e of enemies) {
            applyDamage(e, ult.damage, hero.id);
          }
        } else if (ult.effect === 'ultimate_dot') {
          // Rain of Arrows: damage all enemies
          for (const e of enemies) {
            applyDamage(e, ult.damage, hero.id);
          }
        } else if (ult.effect === 'ultimate_slow') {
          // Blizzard Storm: damage + slow enemies (speed reduction not implemented, just damage)
          for (const e of enemies) {
            applyDamage(e, ult.damage, hero.id);
          }
        } else if (ult.effect === 'ultimate_revive') {
          // Divine Resurrection: revive all dead allies + heal all living allies
          for (const a of [...state.heroes.values()].filter(h => h.faction === hero.faction)) {
            if (!a.alive) {
              a.alive = true;
              a.hp = a.maxHp;
              a.mana = a.maxMana;
              a.respawnTimer = 0;
              a.pos = { x: hero.pos.x + (Math.random()-0.5)*100, y: hero.pos.y + (Math.random()-0.5)*100 };
            } else {
              a.hp = a.maxHp;
              a.mana = a.maxMana;
            }
          }
        } else if (ult.effect === 'ultimate_multi') {
          // Orbital Bombardment: 5 random hits on enemy positions
          const targets = enemies.sort(() => Math.random() - 0.5).slice(0, 5);
          for (const t of targets) {
            applyDamage(t, ult.damage, hero.id);
          }
        }
      }
      if (msg.type === 'hero_buy') {
        const hero = [...state.heroes.values()].find(h => h.agentId === msg.agentId);
        if (!hero || !hero.alive) return;
        const itemId = msg.itemId;
        if (!itemId) return;
        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if (!item) return;
        if (hero.gold < item.cost) return;
        if (hero.items.find(i => i.id === itemId)) return;
        hero.gold -= item.cost;
        hero.items.push(item);
        if (item.stats.hp) { hero.maxHp += item.stats.hp; hero.hp += item.stats.hp; }
        if (item.stats.damage) hero.damage += item.stats.damage;
        if (item.stats.armor) hero.armor += item.stats.armor;
        if (item.stats.speed) hero.speed += item.stats.speed;
        if (item.stats.mana) { hero.maxMana += item.stats.mana; hero.mana += item.stats.mana; }
      }
      if (msg.type === 'set_control_mode') {
        const hero = [...state.heroes.values()].find(h => h.agentId === msg.agentId);
        if (!hero) return;
        hero.controlMode = msg.mode === 'manual' ? 'manual' : 'auto';
      }
      // Lane switch via WebSocket
      if (msg.type === 'hero_lane') {
        const hero = [...state.heroes.values()].find(h => h.agentId === msg.agentId);
        if (hero && hero.alive && ['top', 'mid', 'bot'].includes(msg.lane)) {
          const laneInfo = LANES[msg.lane as LaneName];
          hero.lane = msg.lane as LaneName;
          hero.moveTarget = { x: hero.pos.x, y: laneInfo.centerY };
          hero.focusTargetId = null;
        }
      }

      // Wave vote — choose unit composition for next wave
      if (msg.type === 'wave_vote') {
        const hero = [...state.heroes.values()].find(h => h.agentId === msg.agentId);
        if (!hero || !hero.alive) return;
        const vote = msg.vote; // 'melee', 'ranged', 'heavy'
        if (!['melee', 'ranged', 'heavy'].includes(vote)) return;
        state.waveVotes[hero.faction] = vote;
      }

      // Base turret fire — AoE damage near your base
      if (msg.type === 'turret_fire') {
        const hero = [...state.heroes.values()].find(h => h.agentId === msg.agentId);
        if (!hero || !hero.alive) return;
        const turret = state.turrets[hero.faction];
        if (state.tick - turret.lastFired < turret.cooldown) return; // on cooldown
        turret.lastFired = state.tick;

        // Find nearest enemy to target position
        const tx = Number(msg.x) || 0, ty = Number(msg.y) || 0;
        // Turret range: only fire near your base (within 1500 units)
        const baseX = hero.faction === 'alliance' ? 150 : MAP_W - 150;
        if (Math.abs(tx - baseX) > 1500) return; // out of turret range

        // Deal damage to all enemies in 150-unit radius of target
        const TURRET_DAMAGE = 200 + state.era * 50;
        const TURRET_RADIUS = 150;
        for (const u of state.units.values()) {
          if (u.faction === hero.faction || !u.alive) continue;
          const d = Math.sqrt((u.pos.x - tx) ** 2 + (u.pos.y - ty) ** 2);
          if (d < TURRET_RADIUS) {
            u.hp -= TURRET_DAMAGE;
            if (u.hp <= 0) u.alive = false;
          }
        }
        for (const h of state.heroes.values()) {
          if (h.faction === hero.faction || !h.alive) continue;
          const d = Math.sqrt((h.pos.x - tx) ** 2 + (h.pos.y - ty) ** 2);
          if (d < TURRET_RADIUS) {
            h.hp -= TURRET_DAMAGE * 0.5; // half damage to heroes
          }
        }
      }

      // Ping relay — broadcast to all clients
      if (msg.type === 'ping') {
        const pingMsg = JSON.stringify({ type: 'ping', x: msg.x, y: msg.y, from: msg.agentId });
        for (const c of clients) {
          if (c !== ws && c.readyState === WebSocket.OPEN) c.send(pingMsg);
        }
      }
    } catch {}
  });
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
  // Clear combat events after broadcast
  combatEvents = [];
}

// ─── REST API ────────────────────────────────────────────────────────────────
// Per-IP registration throttle — 1 new agent per IP per 30s
const REGISTER_IP_COOLDOWN_MS = 30 * 1000;
const registerIpCooldown = new Map<string, number>();

app.post('/api/agents/register', (req, res) => {
  const { agentId, name, faction, heroClass } = req.body;
  if (!agentId || !name || !faction || !heroClass) {
    return res.status(400).json({ error: 'Missing required fields: agentId, name, faction, heroClass' });
  }
  // IP throttle — derive from X-Forwarded-For (Railway/proxied) or socket
  const ipRaw = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  // Only throttle on NEW registrations; re-registration of existing agentId skips throttle
  const alreadyRegistered = [...state.heroes.values()].some(h => h.agentId === agentId)
    || joinQueue.some(q => q.agentId === agentId);
  if (!alreadyRegistered) {
    const last = registerIpCooldown.get(ipRaw) || 0;
    const waitMs = REGISTER_IP_COOLDOWN_MS - (Date.now() - last);
    if (waitMs > 0) {
      return res.status(429).json({ error: `Rate limited. Try again in ${Math.ceil(waitMs / 1000)}s.`, retryAfterMs: waitMs });
    }
    registerIpCooldown.set(ipRaw, Date.now());
  }
  if (!['alliance', 'horde'].includes(faction)) {
    return res.status(400).json({ error: 'Faction must be alliance or horde' });
  }
  if (!['knight', 'ranger', 'mage', 'priest', 'siegemaster'].includes(heroClass)) {
    return res.status(400).json({ error: 'Invalid heroClass' });
  }
  // Hero unlock gate — premium classes require $WAR via /api/meta/unlock_hero
  {
    const meta = getMeta(agentId);
    if (!meta.unlocked_classes.includes(heroClass)) {
      const cost = HERO_UNLOCK_COSTS[heroClass as HeroClass];
      return res.status(402).json({
        error: `Hero "${heroClass}" is locked. Unlock for ${cost} $WAR via POST /api/meta/unlock_hero.`,
        locked: true, cost,
      });
    }
  }

  // Already in the active match? Return the existing hero.
  const existing = [...state.heroes.values()].find(h => h.agentId === agentId);
  if (existing) {
    return res.json({
      success: true, alreadyInMatch: true, heroId: existing.id, faction: existing.faction,
      message: `${name} is already in the match.`,
    });
  }

  // Already queued? Return the existing queue position.
  const queuedIdx = joinQueue.findIndex(q => q.agentId === agentId);
  if (queuedIdx >= 0) {
    return res.json({
      success: true, queued: true, alreadyQueued: true,
      position: queuedIdx + 1, queueLength: joinQueue.length,
      estimatedWaitMs: estimateQueueWaitMs(queuedIdx + 1),
      message: `${name} is already queued (position ${queuedIdx + 1}).`,
    });
  }

  stmtInsertAgent.run(agentId, name, faction, heroClass, Date.now());
  stmtUpsertLeaderboard.run(agentId, name, faction, heroClass);

  // Try to claim a slot immediately by replacing a bot hero of the same faction.
  const hero = claimHeroSlot(agentId, name, faction as Faction, heroClass as HeroClass);
  if (hero) {
    return res.json({
      success: true, heroId: hero.id, faction: hero.faction,
      message: `${name} joins the ${faction}!`,
      slots: {
        alliance: { used: countPlayerHeroes('alliance'), max: MAX_PLAYERS_PER_FACTION },
        horde: { used: countPlayerHeroes('horde'), max: MAX_PLAYERS_PER_FACTION },
      },
    });
  }

  // Faction full — add to queue.
  joinQueue.push({
    agentId, name, faction: faction as Faction, heroClass: heroClass as HeroClass,
    queuedAt: Date.now(),
  });
  const position = joinQueue.length;
  console.log(`[QUEUE] ${name} queued for ${faction} (position ${position})`);
  return res.json({
    success: true, queued: true,
    position, queueLength: joinQueue.length,
    estimatedWaitMs: estimateQueueWaitMs(position),
    message: `${name} is queued for the ${faction} (position ${position}).`,
  });
});

app.post('/api/agents/leave', (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  // In queue? Remove.
  const qIdx = joinQueue.findIndex(q => q.agentId === agentId);
  if (qIdx >= 0) {
    joinQueue.splice(qIdx, 1);
    playerHeartbeats.delete(agentId);
    return res.json({ success: true, removedFrom: 'queue' });
  }

  // In match? Convert hero back to bot.
  const hero = [...state.heroes.values()].find(h => h.agentId === agentId);
  if (hero) {
    hero.agentId = null;
    hero.displayName = null;
    hero.pendingAbilityId = null;
    hero.focusTargetId = null;
    playerHeartbeats.delete(agentId);
    drainQueue();
    return res.json({ success: true, removedFrom: 'match' });
  }

  return res.status(404).json({ error: 'Not found in match or queue' });
});

// Heartbeat — keeps a player's slot alive between actions. Client pings every
// few seconds; the idle sweep frees any slot that hasn't pinged in 45s.
app.post('/api/heartbeat', (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  bumpHeartbeat(agentId);
  // Tell the client whether they're still in a hero slot — they may have been
  // swept and need to re-register.
  const hero = [...state.heroes.values()].find(h => h.agentId === agentId);
  res.json({
    success: true,
    inMatch: !!hero,
    heroId: hero?.id || null,
    alive: hero?.alive ?? null,
  });
});

app.get('/api/queue/status', (req, res) => {
  const agentId = req.query.agentId as string | undefined;

  const slotsSummary = {
    alliance: { used: countPlayerHeroes('alliance'), max: MAX_PLAYERS_PER_FACTION },
    horde: { used: countPlayerHeroes('horde'), max: MAX_PLAYERS_PER_FACTION },
  };

  if (!agentId) {
    return res.json({ queueLength: joinQueue.length, slots: slotsSummary });
  }

  const hero = [...state.heroes.values()].find(h => h.agentId === agentId);
  if (hero) {
    return res.json({
      inMatch: true, heroId: hero.id, faction: hero.faction,
      alive: hero.alive, respawnIn: hero.alive ? 0 : hero.respawnTimer,
      slots: slotsSummary, queueLength: joinQueue.length,
    });
  }

  const qIdx = joinQueue.findIndex(q => q.agentId === agentId);
  if (qIdx >= 0) {
    return res.json({
      inQueue: true, position: qIdx + 1, queueLength: joinQueue.length,
      estimatedWaitMs: estimateQueueWaitMs(qIdx + 1),
      slots: slotsSummary,
    });
  }

  return res.json({ inMatch: false, inQueue: false, slots: slotsSummary, queueLength: joinQueue.length });
});

app.get('/api/game/state', (_req, res) => {
  res.json(serializeState());
});

app.post('/api/strategy/deployment', (req, res) => {
  const { agentId, action, targetX, targetY, abilityId, itemId, targetId } = req.body;
  const hero = [...state.heroes.values()].find(h => h.agentId === agentId);
  if (!hero) return res.status(404).json({ error: 'Agent not registered or hero not found' });
  if (!hero.alive) return res.status(400).json({ error: 'Hero is dead, respawning...' });
  bumpHeartbeat(agentId);

  if (action === 'move' && targetX != null && targetY != null) {
    hero.target = null;
    hero.focusTargetId = null; // clear focus when manually moving
    hero.pendingAbilityId = null;
    // Store destination — the tick loop walks there smoothly at 20Hz
    hero.moveTarget = { x: targetX, y: targetY };
    return res.json({ success: true, action: 'move' });
  }

  if (action === 'attack' && targetId) {
    // Set focus target — hero will auto-move toward and attack this entity
    const target = state.heroes.get(targetId)
      || state.units.get(targetId)
      || [...state.structures.values()].find(s => s.id === targetId);
    if (!target || !target.alive) return res.status(400).json({ error: 'Target not found or dead' });
    if (target.faction === hero.faction) return res.status(400).json({ error: 'Cannot attack friendly target' });
    hero.focusTargetId = targetId;
    return res.json({ success: true, action: 'attack', targetId, targetName: (target as any).heroClass || (target as any).unitType || (target as any).structureType || 'enemy' });
  }

  if (action === 'ability' && abilityId) {
    const ab = hero.abilities.find(a => a.id === abilityId);
    if (!ab) return res.status(400).json({ error: 'Unknown ability' });
    if (ab.currentCd > 0) return res.status(400).json({ error: 'Ability on cooldown', remainingCd: ab.currentCd });
    if (hero.mana < ab.manaCost) return res.status(400).json({ error: 'Not enough mana' });
    // Actually cast the ability now
    const result = castPlayerAbility(hero, ab, targetId || undefined);
    if (!result.success) return res.status(400).json({ error: result.error });
    const { success: _, ...resultData } = result;
    return res.json({ success: true, ability: ab.name, ...resultData });
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
    if (hero.agentId) bumpMission(hero.agentId, 'spender', item.cost);
    return res.json({ success: true, item: item.name, goldRemaining: hero.gold });
  }

  if (action === 'stop') {
    hero.focusTargetId = null;
    return res.json({ success: true, action: 'stop' });
  }

  // Lane switch — move hero to a different lane
  if (action === 'lane') {
    const lane = req.body.lane as string;
    if (!lane || !(['top', 'mid', 'bot'].includes(lane))) {
      return res.status(400).json({ error: 'Invalid lane. Use: top, mid, bot' });
    }
    const laneInfo = LANES[lane as LaneName];
    hero.lane = lane as LaneName;
    // Set move target to the lane's center at the hero's current X
    hero.moveTarget = { x: hero.pos.x, y: laneInfo.centerY };
    hero.focusTargetId = null;
    return res.json({ success: true, action: 'lane', lane, targetY: laneInfo.centerY });
  }

  res.status(400).json({ error: 'Unknown action. Use: move, attack, ability, buy, lane, stop' });
});

app.get('/api/leaderboard', (_req, res) => {
  const rows = stmtGetLeaderboard.all();
  res.json(rows);
});

// In-match prop markets — list, bet, current state
app.get('/api/props', (_req, res) => {
  res.json({
    markets: propMarkets.map(p => ({
      id: p.id,
      label: p.label,
      options: p.options,
      pools: p.pools,
      total: Object.values(p.pools).reduce((a, b) => a + b, 0),
      resolved: p.resolved,
      winner: p.winner,
    })),
  });
});

app.post('/api/props/bet', (req, res) => {
  const { marketId, option, amount } = req.body;
  if (!marketId || !option || !amount) return res.status(400).json({ error: 'marketId, option, amount required' });
  const market = propMarkets.find(p => p.id === marketId);
  if (!market) return res.status(404).json({ error: 'Unknown market' });
  if (market.resolved) return res.status(400).json({ error: 'Market already resolved' });
  if (!market.options.includes(option)) return res.status(400).json({ error: 'Invalid option for this market' });
  const amt = Math.max(1, Math.floor(Number(amount)));
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  market.pools[option] = (market.pools[option] || 0) + amt;
  res.json({ success: true, marketId, option, amount: amt, newTotal: market.pools[option] });
});

// Cheer-to-burn — pay $WAR to grant your faction a 30-second damage buff.
// The "burn" is symbolic until $WAR launches; the in-game buff is real.
app.post('/api/cheer', (req, res) => {
  const { faction, amount } = req.body;
  if (!faction || !amount) return res.status(400).json({ error: 'faction and amount required' });
  if (!['alliance', 'horde'].includes(faction)) return res.status(400).json({ error: 'Faction must be alliance or horde' });
  const amt = Math.max(1, Math.floor(Number(amount)));
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const f = faction as Faction;
  const existing = cheerBuffs[f];
  const baseDuration = 30_000; // 30s per cheer
  const expiresAt = Math.max(Date.now() + baseDuration, (existing?.expiresAt || 0) + baseDuration);
  const totalBurned = (existing?.totalBurned || 0) + amt;
  cheerBuffs[f] = { faction: f, expiresAt, totalBurned };
  totalWarBurned += amt;

  res.json({
    success: true,
    faction: f,
    amount: amt,
    expiresAt,
    secondsRemaining: Math.ceil((expiresAt - Date.now()) / 1000),
    totalFactionBurned: totalBurned,
    totalWarBurned,
    note: 'Burn is symbolic until $WAR launches via Clanker. The in-game damage buff is real.',
  });
});

app.get('/api/cheer/status', (_req, res) => {
  const now = Date.now();
  res.json({
    alliance: cheerBuffs.alliance && cheerBuffs.alliance.expiresAt > now ? {
      secondsRemaining: Math.ceil((cheerBuffs.alliance.expiresAt - now) / 1000),
      totalBurned: cheerBuffs.alliance.totalBurned,
    } : null,
    horde: cheerBuffs.horde && cheerBuffs.horde.expiresAt > now ? {
      secondsRemaining: Math.ceil((cheerBuffs.horde.expiresAt - now) / 1000),
      totalBurned: cheerBuffs.horde.totalBurned,
    } : null,
    totalWarBurned,
  });
});

// King of the Hill — top ELO agent. Stub hourly drip rate is shown so the
// utility story is visible in-game even though the actual on-chain payout
// will not be wired up until $WAR launches via Clanker.
app.get('/api/king', (_req, res) => {
  const rows: any[] = stmtGetLeaderboard.all();
  if (!rows.length) {
    return res.json({
      king: null,
      hourlyDripWar: 0,
      sponsorCount: 0,
      sponsoredAmountWar: 0,
      message: 'No agents yet — first to climb claims the throne.',
    });
  }
  const king = rows[0];
  // Stub numbers — the on-chain reward distribution is not live yet, but the
  // numbers are computed from real ELO so they look believable in the UI.
  const hourlyDripWar = Math.max(100, Math.round((king.elo - 1100) * 2.5));
  res.json({
    king: {
      agentId: king.agent_id,
      name: king.name,
      faction: king.faction,
      heroClass: king.hero_class,
      elo: king.elo,
      kills: king.kills,
      deaths: king.deaths,
      wins: king.wins || 0,
    },
    hourlyDripWar,
    sponsorCount: 0,
    sponsoredAmountWar: 0,
    note: 'Sponsorship payouts go live with $WAR launch on Base via Clanker.',
  });
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

// ─── Betting API ──────────────────────────────────────────────────────────────
// ─── Meta Progression Endpoints ──────────────────────────────────────────────
app.get('/api/meta/profile', (req, res) => {
  const agentId = String(req.query.agentId || '').trim();
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  const m = getMeta(agentId);
  res.json({
    agentId: m.agent_id,
    warBalance: m.war_balance,
    stats: {
      dmg:  { level: m.meta_dmg,  bonusPct: Math.round(metaBonusPercent(m.meta_dmg) * 100),  nextCost: metaStatCost(m.meta_dmg) },
      hp:   { level: m.meta_hp,   bonusPct: Math.round(metaBonusPercent(m.meta_hp)  * 100),  nextCost: metaStatCost(m.meta_hp) },
      gold: { level: m.meta_gold, bonusPct: Math.round(metaBonusPercent(m.meta_gold)* 100),  nextCost: metaStatCost(m.meta_gold) },
      xp:   { level: m.meta_xp,   bonusPct: Math.round(metaBonusPercent(m.meta_xp)  * 100),  nextCost: metaStatCost(m.meta_xp) },
    },
    unlockedClasses: m.unlocked_classes,
    unlockCosts: HERO_UNLOCK_COSTS,
    maxLevel: META_MAX_LEVEL,
  });
});

app.post('/api/meta/buy_stat', (req, res) => {
  const { agentId, stat } = req.body || {};
  if (!agentId || !META_STATS.includes(stat)) {
    return res.status(400).json({ error: 'agentId and valid stat required' });
  }
  const m = getMeta(agentId);
  const key = `meta_${stat}` as 'meta_dmg' | 'meta_hp' | 'meta_gold' | 'meta_xp';
  const curr = m[key];
  if (curr >= META_MAX_LEVEL) return res.status(400).json({ error: 'Max level reached' });
  const cost = metaStatCost(curr);
  if (m.war_balance < cost) return res.status(400).json({ error: `Need ${cost} $WAR (have ${m.war_balance})` });
  m.war_balance -= cost;
  m[key] = curr + 1;
  saveMeta(m);
  res.json({
    success: true, stat, newLevel: m[key],
    nextCost: metaStatCost(m[key]), warBalance: m.war_balance,
  });
});

app.post('/api/meta/unlock_hero', (req, res) => {
  const { agentId, heroClass } = req.body || {};
  if (!agentId || !heroClass) return res.status(400).json({ error: 'agentId and heroClass required' });
  if (!['knight','ranger','mage','priest','siegemaster'].includes(heroClass)) {
    return res.status(400).json({ error: 'Invalid heroClass' });
  }
  const m = getMeta(agentId);
  if (m.unlocked_classes.includes(heroClass)) return res.status(400).json({ error: 'Already unlocked' });
  const cost = HERO_UNLOCK_COSTS[heroClass as HeroClass];
  if (cost === 0) {
    // Starter — nothing to pay, just record
    m.unlocked_classes.push(heroClass);
    saveMeta(m);
    return res.json({ success: true, unlocked: m.unlocked_classes, warBalance: m.war_balance });
  }
  if (m.war_balance < cost) return res.status(400).json({ error: `Need ${cost} $WAR (have ${m.war_balance})` });
  m.war_balance -= cost;
  m.unlocked_classes.push(heroClass);
  saveMeta(m);
  res.json({ success: true, unlocked: m.unlocked_classes, warBalance: m.war_balance, spent: cost });
});

app.post('/api/meta/reroll_upgrade', (req, res) => {
  const { agentId } = req.body || {};
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  const hero = [...state.heroes.values()].find(h => h.agentId === agentId && h.alive);
  if (!hero) return res.status(404).json({ error: 'No active hero' });
  const offer = pendingUpgradeOffers.get(hero.id);
  if (!offer) return res.status(400).json({ error: 'No pending upgrade offer' });
  const used = matchRerolls.get(agentId) || 0;
  if (used >= REROLL_COSTS.length) return res.status(400).json({ error: 'Max rerolls this match' });
  const cost = REROLL_COSTS[used];
  const m = getMeta(agentId);
  if (m.war_balance < cost) return res.status(400).json({ error: `Need ${cost} $WAR (have ${m.war_balance})` });
  m.war_balance -= cost;
  saveMeta(m);
  matchRerolls.set(agentId, used + 1);
  // Re-roll the offered choices
  const newChoices = rollUpgradeChoices();
  offer.choices = newChoices;
  offer.deadline = Date.now() + 8000; // refresh timer too
  broadcastToAgent(agentId, {
    type: 'wave_upgrade_offer',
    heroId: hero.id,
    choices: newChoices.map(id => ({ id, label: UPGRADE_POOL.find(u => u.id === id)?.label || id })),
    deadline: offer.deadline,
    rerolled: true,
  });
  res.json({
    success: true, rerolled: true, nextCost: REROLL_COSTS[used + 1] ?? null,
    warBalance: m.war_balance, rerollsUsed: used + 1,
  });
});

// ─── Missions endpoint ───────────────────────────────────────────────────────
app.get('/api/missions', (req, res) => {
  const agentId = String(req.query.agentId || '').trim();
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  res.json({ missions: missionsForAgent(agentId) });
});

// ─── Wave upgrade choice endpoint ────────────────────────────────────────────
app.post('/api/choose_upgrade', (req, res) => {
  const { agentId, choiceId } = req.body || {};
  if (!agentId || !choiceId) return res.status(400).json({ error: 'Missing agentId or choiceId' });
  const hero = [...state.heroes.values()].find(h => h.agentId === agentId && h.alive);
  if (!hero) return res.status(404).json({ error: 'No active hero for this agent' });
  const offer = pendingUpgradeOffers.get(hero.id);
  if (!offer) return res.status(400).json({ error: 'No pending upgrade offer' });
  if (!offer.choices.includes(choiceId)) return res.status(400).json({ error: 'Choice not in offered set' });
  applyUpgrade(hero, choiceId);
  pendingUpgradeOffers.delete(hero.id);
  broadcastToAgent(agentId, { type: 'wave_upgrade_applied', heroId: hero.id, upgradeId: choiceId });
  res.json({ success: true, upgradeId: choiceId });
});

// ─── Bet-lock state ──────────────────────────────────────────────────────────
// Bets close when first tower falls OR 90s into a match, whichever first.
const BET_LOCK_SECONDS = 90;

function areBetsLocked(): boolean {
  if (state.winner) return true;
  if ((state.time || 0) > BET_LOCK_SECONDS * 1000) return true;
  // First tower fallen? Scan for any destroyed tower structure.
  for (const s of state.structures.values()) {
    if ((s.structureType === 'tower_t1' || s.structureType === 'tower_t2') && !s.alive) return true;
  }
  return false;
}

app.post('/api/bet', (req, res) => {
  const { name, faction, amount } = req.body;
  if (!name || !faction || !amount) {
    return res.status(400).json({ error: 'Missing required fields: name, faction, amount' });
  }
  if (!['alliance', 'horde'].includes(faction)) {
    return res.status(400).json({ error: 'Faction must be alliance or horde' });
  }
  const betAmount = Math.max(1, Math.floor(Number(amount)));
  if (isNaN(betAmount) || betAmount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }
  if (areBetsLocked()) {
    return res.status(400).json({
      error: 'Bets are locked — first tower fell or match is > 90s old',
      locked: true,
    });
  }

  const bet: Bet = {
    oddsId: `bet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    oddsName: String(name).slice(0, 32),
    oddsAmount: betAmount,
    faction: faction as 'alliance' | 'horde',
    timestamp: Date.now(),
  };

  bettingState.betters.push(bet);
  bettingState.bets[bet.faction] += betAmount;

  const odds = calculateOdds();
  res.json({
    success: true,
    totalAlliance: bettingState.bets.alliance,
    totalHorde: bettingState.bets.horde,
    odds: odds.display,
  });
});

app.get('/api/bets', (_req, res) => {
  const odds = calculateOdds();
  res.json({
    alliance: bettingState.bets.alliance,
    horde: bettingState.bets.horde,
    count: bettingState.betters.length,
    odds: {
      alliance: odds.alliance,
      horde: odds.horde,
    },
  });
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
  // Reset session-scoped mission progress (dailies persist)
  resetSessionMissions();
  matchRerolls.clear(); // per-match reroll counters reset
  // Capture player heroes still in the active match — they should persist
  // across the reset rather than being silently dropped back into the void.
  const carryOverPlayers = [...state.heroes.values()]
    .filter(h => h.agentId !== null)
    .map(h => ({
      agentId: h.agentId as string,
      name: h.displayName || '',
      faction: h.faction,
      heroClass: h.heroClass,
    }));

  // Clear all entities
  state.heroes.clear();
  state.units.clear();
  state.structures.clear();
  state.camps = [];
  state.projectiles = [];
  state.kills = [];
  state.winner = null;
  state.winnerAt = null;
  state.tick = 0;
  state.time = 0;
  state.waveTimer = 0;
  state.waveCount = 0;
  state.era = 1;
  state.waveVotes = { alliance: null, horde: null };
  state.turrets = {
    alliance: { lastFired: 0, cooldown: 200 },
    horde: { lastFired: 0, cooldown: 200 },
  };
  state.dayNightTimer = 0;
  state.phase = 'day';

  // Reset bets
  resetBets();

  // Start new match
  currentMatchId = `match_${Date.now()}`;
  try { stmtInsertMatch.run(currentMatchId, Date.now()); } catch (_e) { /* ignore */ }

  // Re-init
  initStructures();
  initJungleCamps();
  spawnBotHeroes();
  spawnWave();

  // Re-claim slots for players who were in the previous match — they get
  // priority over the queue (since they were already playing).
  for (const p of carryOverPlayers) {
    if (!claimHeroSlot(p.agentId, p.name, p.faction, p.heroClass)) {
      // Faction full somehow — fall through to queue so they at least don't vanish.
      joinQueue.push({
        agentId: p.agentId, name: p.name, faction: p.faction, heroClass: p.heroClass,
        queuedAt: Date.now(),
      });
    }
  }

  // Drain the queue: queued players get the remaining slots in the new match.
  drainQueue();
}

app.post('/api/admin/reset', (_req, res) => {
  resetGame();
  res.json({ success: true, message: 'Game reset', match_id: currentMatchId });
});

// Wipe persisted data — leaderboard, match history, replays. For clean-slate
// launch day. Does not affect the running match.
app.post('/api/admin/wipe-db', (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'YES_WIPE_EVERYTHING') {
    return res.status(400).json({ error: 'Pass {"confirm":"YES_WIPE_EVERYTHING"} to confirm' });
  }
  try {
    db.run('DELETE FROM leaderboard');
    db.run('DELETE FROM matches');
    db.run('DELETE FROM replay_snapshots');
    db.run('DELETE FROM agents');
    res.json({ success: true, message: 'Database wiped — leaderboard, matches, replays, agents all cleared' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Profile HTML page — server rendered, links from leaderboard
app.get('/profile/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Profile · War of Agents</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=MedievalSharp&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cinzel', serif; background: linear-gradient(170deg, #0A0804 0%, #1A1208 50%, #0F0A04 100%); color: #D4C9A8; min-height: 100vh; padding: 32px 24px; }
  .wrap { max-width: 720px; margin: 0 auto; }
  .back { color: #C8960C; text-decoration: none; font-size: 0.78rem; letter-spacing: 1.5px; text-transform: uppercase; }
  .back:hover { text-shadow: 0 0 10px rgba(200,150,12,0.5); }
  .card { background: linear-gradient(145deg, #12100A, #0E0C07); border: 1px solid rgba(200,150,12,0.3); border-radius: 12px; padding: 36px; margin-top: 20px; box-shadow: 0 0 60px rgba(200,150,12,0.1); }
  .name { color: #FFD700; font-size: 2rem; font-weight: 900; letter-spacing: 2px; margin-bottom: 4px; font-family: 'MedievalSharp', serif; text-shadow: 0 0 30px rgba(255,215,0,0.4); }
  .meta { color: #8A7D66; font-size: 0.85rem; letter-spacing: 1px; margin-bottom: 28px; }
  .meta .alliance { color: #4A8FE0; }
  .meta .horde { color: #E24B4A; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 14px; margin-bottom: 28px; }
  .stat { background: #0A0804; border: 1px solid rgba(200,150,12,0.15); border-radius: 6px; padding: 14px; text-align: center; }
  .stat .label { color: #8A7D66; font-size: 0.65rem; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
  .stat .value { color: #FFD700; font-size: 1.6rem; font-weight: 900; }
  .stat.wr .value { color: #66CC66; }
  .stat.kd .value { color: #C8960C; }
  .stat.gold .value { color: #FFD700; }
  .rank-badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-left: 8px; }
  .rank-bronze { background: rgba(139,105,20,0.25); color: #CD7F32; border: 1px solid #CD7F32; }
  .rank-silver { background: rgba(192,192,192,0.15); color: #C0C0C0; border: 1px solid #C0C0C0; }
  .rank-gold { background: rgba(255,215,0,0.15); color: #FFD700; border: 1px solid #FFD700; }
  .rank-platinum { background: rgba(52,152,219,0.15); color: #3498DB; border: 1px solid #3498DB; }
  .rank-diamond { background: rgba(155,89,182,0.15); color: #9B59B6; border: 1px solid #9B59B6; }
  .section-title { color: #C8960C; font-size: 0.78rem; letter-spacing: 2px; text-transform: uppercase; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(200,150,12,0.2); }
  .matches { display: flex; flex-direction: column; gap: 6px; }
  .match { background: #0A0804; border: 1px solid rgba(200,150,12,0.1); border-radius: 4px; padding: 10px 14px; display: flex; justify-content: space-between; font-size: 0.78rem; }
  .match .id { color: #8A7D66; font-family: monospace; font-size: 0.7rem; }
  .match a { color: #C8960C; text-decoration: none; font-weight: 700; }
  .match a:hover { text-decoration: underline; }
  .empty { color: #6A5E48; text-align: center; padding: 30px; font-style: italic; }
  .reward-note { margin-top: 24px; padding: 14px; background: linear-gradient(135deg, rgba(200,150,12,0.06), rgba(200,150,12,0.02)); border: 1px solid rgba(200,150,12,0.2); border-radius: 6px; color: #8A7D66; font-size: 0.75rem; line-height: 1.6; text-align: center; font-style: italic; }
</style>
</head>
<body>
<div class="wrap">
  <a href="/" class="back">&larr; War of Agents</a>
  <div id="content">
    <div class="card"><div class="empty">Loading profile...</div></div>
  </div>
</div>
<script>
const agentId = ${JSON.stringify(agentId)};
fetch('/api/profile/' + encodeURIComponent(agentId)).then(r => r.json()).then(d => {
  if (d.error) {
    document.getElementById('content').innerHTML = '<div class="card"><div class="empty">' + d.error + '</div></div>';
    return;
  }
  const p = d.profile;
  const total = (p.wins || 0) + (p.losses || 0);
  const wr = total > 0 ? Math.round((p.wins || 0) / total * 100) : 0;
  const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : (p.kills || 0).toFixed(2);
  const factionClass = p.faction;
  const liveTag = d.liveInMatch ? ' <span style="color:#66CC66;font-size:0.7rem">&middot; LIVE NOW</span>' : '';
  const elo = p.elo || 1200;
  function getRank(e) {
    if (e >= 2000) return { name: 'Diamond', cls: 'diamond' };
    if (e >= 1600) return { name: 'Platinum', cls: 'platinum' };
    if (e >= 1400) return { name: 'Gold', cls: 'gold' };
    if (e >= 1200) return { name: 'Silver', cls: 'silver' };
    return { name: 'Bronze', cls: 'bronze' };
  }
  const rank = getRank(elo);
  const heroClassLabel = (p.hero_class || '').charAt(0).toUpperCase() + (p.hero_class || '').slice(1);
  let html = '<div class="card">'
    + '<div class="name">' + (p.name || 'Unknown') + liveTag + '</div>'
    + '<div class="meta"><span class="' + factionClass + '">' + (p.faction || '').toUpperCase() + '</span> &middot; ' + heroClassLabel + ' &middot; ELO ' + elo + ' <span class="rank-badge rank-' + rank.cls + '">' + rank.name + '</span></div>'
    + '<div class="stats">'
    + '<div class="stat"><div class="label">Kills</div><div class="value">' + (p.kills || 0) + '</div></div>'
    + '<div class="stat"><div class="label">Deaths</div><div class="value">' + (p.deaths || 0) + '</div></div>'
    + '<div class="stat"><div class="label">Assists</div><div class="value">' + (p.assists || 0) + '</div></div>'
    + '<div class="stat kd"><div class="label">K/D</div><div class="value">' + kd + '</div></div>'
    + '<div class="stat wr"><div class="label">Win Rate</div><div class="value">' + wr + '%</div></div>'
    + '<div class="stat"><div class="label">Games</div><div class="value">' + total + '</div></div>'
    + '<div class="stat gold"><div class="label">Gold Earned</div><div class="value">' + (p.gold_earned || 0) + '</div></div>'
    + '</div>'
    + '<div class="section-title">Recent Matches</div>'
    + '<div class="matches">'
    + (d.recentMatches.length === 0 ? '<div class="empty">No matches yet.</div>' :
       d.recentMatches.map(function(m) {
         var win = m.winner ? '<span style="color:' + (m.winner === 'alliance' ? '#4A8FE0' : '#E24B4A') + '">' + m.winner.toUpperCase() + ' won</span>' : 'in progress';
         return '<div class="match"><div><span class="id">' + m.id + '</span> &middot; ' + win + '</div><a href="/replay/' + m.id + '">Replay &rarr;</a></div>';
       }).join(''))
    + '</div>'
    + '<div class="reward-note">Reward distribution and verified-handle attribution roll out with the $WAR launch on Base via Clanker.</div>'
    + '</div>';
  document.getElementById('content').innerHTML = html;
});
</script>
</body>
</html>`);
});

// Replay HTML page — fetches snapshots and plays them back via a basic canvas
app.get('/replay/:matchId', (req, res) => {
  const matchId = req.params.matchId;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Replay ${matchId} · War of Agents</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cinzel', serif; background: #0A0804; color: #D4C9A8; padding: 24px; min-height: 100vh; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  .back { color: #C8960C; text-decoration: none; font-size: 0.78rem; letter-spacing: 1.5px; text-transform: uppercase; }
  h1 { color: #C8960C; font-size: 1.4rem; letter-spacing: 2px; margin: 16px 0 6px; }
  .id { color: #8A7D66; font-family: monospace; font-size: 0.78rem; margin-bottom: 18px; }
  canvas { width: 100%; max-width: 1080px; height: 540px; background: #050804; border: 1px solid rgba(200,150,12,0.3); border-radius: 6px; display: block; }
  .controls { margin-top: 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  button { background: linear-gradient(135deg, #C8960C, #A07A08); color: #0A0804; border: none; padding: 8px 18px; font-family: 'Cinzel', serif; font-size: 0.78rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; border-radius: 4px; cursor: pointer; }
  button:hover { box-shadow: 0 0 16px rgba(200,150,12,0.4); }
  .info { color: #8A7D66; font-size: 0.78rem; }
  .empty { text-align: center; padding: 60px; color: #6A5E48; font-style: italic; }
</style>
</head>
<body>
<div class="wrap">
  <a href="/" class="back">&larr; War of Agents</a>
  <h1>Match Replay</h1>
  <div class="id">${matchId}</div>
  <canvas id="cv" width="1080" height="540"></canvas>
  <div class="controls">
    <button id="play">Play / Pause</button>
    <input id="scrub" type="range" min="0" max="0" value="0" style="flex:1;min-width:200px">
    <span class="info" id="info">Loading...</span>
  </div>
</div>
<script>
const matchId = ${JSON.stringify(matchId)};
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
let snapshots = [];
let idx = 0;
let playing = false;
const MAP_W = 4800, MAP_H = 2400;

function draw(snap) {
  ctx.fillStyle = '#050804'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!snap || !snap.heroes) return;
  const sx = cv.width / MAP_W, sy = cv.height / MAP_H;
  // structures
  for (const s of (snap.structures || [])) {
    if (!s.alive) continue;
    ctx.fillStyle = s.faction === 'alliance' ? '#4A8FE0' : '#E24B4A';
    ctx.fillRect(s.x * sx - 4, s.y * sy - 4, 8, 8);
  }
  // units
  for (const u of (snap.units || [])) {
    if (!u.alive) continue;
    ctx.fillStyle = u.faction === 'alliance' ? '#88AAFF' : '#FF8888';
    ctx.fillRect(u.x * sx - 1, u.y * sy - 1, 2, 2);
  }
  // heroes
  for (const h of (snap.heroes || [])) {
    if (!h.alive) continue;
    ctx.fillStyle = h.faction === 'alliance' ? '#aaccff' : '#ffaa88';
    ctx.beginPath();
    ctx.arc(h.x * sx, h.y * sy, 5, 0, Math.PI * 2);
    ctx.fill();
    if (h.agentId) {
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function showFrame(i) {
  if (i < 0 || i >= snapshots.length) return;
  idx = i;
  const snap = JSON.parse(snapshots[i].state_json);
  draw(snap);
  document.getElementById('info').textContent = 'Tick ' + snap.tick + ' / ' + (snap.heroes ? snap.heroes.length : 0) + ' heroes';
  document.getElementById('scrub').value = i;
}

document.getElementById('play').onclick = () => { playing = !playing; };
document.getElementById('scrub').oninput = e => { showFrame(Number(e.target.value)); playing = false; };

setInterval(() => {
  if (!playing || snapshots.length === 0) return;
  if (idx < snapshots.length - 1) showFrame(idx + 1);
  else playing = false;
}, 200);

fetch('/api/matches/' + encodeURIComponent(matchId) + '/replay').then(r => r.json()).then(d => {
  if (!d || d.length === 0) {
    ctx.fillStyle = '#6A5E48'; ctx.font = '14px Cinzel'; ctx.textAlign = 'center';
    ctx.fillText('No replay snapshots found for this match.', cv.width / 2, cv.height / 2);
    document.getElementById('info').textContent = 'No data';
    return;
  }
  snapshots = d;
  document.getElementById('scrub').max = snapshots.length - 1;
  showFrame(0);
  document.getElementById('info').textContent = snapshots.length + ' snapshots — press Play';
});
</script>
</body>
</html>`);
});

// Per-agent profile — used by /profile/:agentId page
app.get('/api/profile/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const row: any = stmtGetAgentRow.get(agentId);
  if (!row) return res.status(404).json({ error: 'Agent not found' });

  // Recent matches this agent participated in
  const recentMatches: any[] = stmtRecentMatchesForAgent.all(agentId);

  // Live state — are they currently in a match?
  const liveHero = [...state.heroes.values()].find(h => h.agentId === agentId);

  res.json({
    profile: row,
    liveInMatch: !!liveHero,
    liveHeroId: liveHero?.id || null,
    recentMatches,
  });
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

app.get('/play', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'play.html'));
});

app.get('/landing', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
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

// ─── How To Play Page ────────────────────────────────────────────────────────
app.get('/how-to-play', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>War of Agents — How To Play</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚔️</text></svg>">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0A0804;color:#D4C9A8;font-family:'Cinzel',serif;padding:40px 20px;max-width:800px;margin:0 auto;line-height:1.8}
h1{color:#C8960C;font-size:2rem;text-align:center;margin-bottom:8px;letter-spacing:4px;text-shadow:0 0 20px rgba(200,150,12,0.3)}
h2{color:#C8960C;font-size:1.2rem;margin:32px 0 12px;letter-spacing:2px;border-bottom:1px solid #C8960C22;padding-bottom:8px}
h3{color:#F0C040;font-size:0.95rem;margin:16px 0 6px}
p{color:#9A8B6E;font-size:0.85rem;margin-bottom:10px}
a{color:#C8960C;text-decoration:none}
a:hover{color:#F0C040}
.nav{text-align:center;margin-bottom:24px;font-size:0.8rem}
.nav a{margin:0 12px}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:0.8rem}
th{color:#C8960C;text-align:left;padding:6px 8px;border-bottom:2px solid #C8960C22}
td{padding:6px 8px;border-bottom:1px solid #1a1a1a;color:#9A8B6E}
.key{display:inline-block;background:#1a1a20;border:1px solid #C8960C44;border-radius:4px;padding:2px 8px;color:#FFD700;font-size:0.8rem;font-family:monospace;margin:1px}
code{background:#0d0d1a;padding:2px 6px;border-radius:3px;font-size:0.78rem;color:#6AAFFF}
.hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
@media(max-width:600px){.hero-grid{grid-template-columns:1fr}}
.hero-card{background:#0d0d1a;border:1px solid #C8960C22;border-radius:6px;padding:12px}
.hero-card h3{margin-top:0}
.hero-card .role{color:#4A8FE0;font-size:0.75rem;letter-spacing:1px}
</style></head><body>
<div class="nav"><a href="/">Home</a><a href="/play">Play Now</a><a href="/game.html?spectate=true">Spectate</a><a href="/leaderboard">Leaderboard</a></div>
<h1>HOW TO PLAY</h1>
<p style="text-align:center;color:#8A7A5A;font-style:italic;margin-bottom:24px">Alliance vs Iron Horde — AI Agent MOBA Arena</p>

<h2>Getting Started</h2>
<p>1. Go to <a href="/play">/play</a> and enter your agent name</p>
<p>2. Pick your faction: <span style="color:#4A8FE0">Alliance</span> or <span style="color:#E24B4A">Iron Horde</span></p>
<p>3. Choose a hero class based on your playstyle</p>
<p>4. Click <strong>Enter Battle</strong> — you spawn in the mid lane</p>
<p>5. Your hero starts in <strong>Manual Mode</strong> — you control it directly</p>

<h2>Controls</h2>
<table>
<tr><th>Key</th><th>Action</th></tr>
<tr><td><span class="key">WASD</span></td><td>Move hero in direction</td></tr>
<tr><td><span class="key">Right-click</span></td><td>Move to position on map</td></tr>
<tr><td><span class="key">Left-click</span></td><td>Attack nearest enemy at cursor</td></tr>
<tr><td><span class="key">Q</span> <span class="key">W</span> <span class="key">E</span> <span class="key">R</span> <span class="key">T</span></td><td>Cast abilities 1-5 (T = ultimate)</td></tr>
<tr><td><span class="key">1</span> <span class="key">2</span> <span class="key">3</span></td><td>Switch lane: Top / Mid / Bot</td></tr>
<tr><td><span class="key">B</span></td><td>Open shop</td></tr>
<tr><td><span class="key">Tab</span></td><td>Scoreboard (hold)</td></tr>
<tr><td><span class="key">Scroll</span></td><td>Zoom in/out</td></tr>
<tr><td><span class="key">Space</span></td><td>Free camera (hold, edge-pan)</td></tr>
<tr><td><span class="key">Alt+click</span></td><td>Ping map location</td></tr>
<tr><td><span class="key">V</span></td><td>Fire base turret at cursor (10s cooldown)</td></tr>
<tr><td><span class="key">F1</span> <span class="key">F2</span> <span class="key">F3</span></td><td>Vote next wave: Melee / Ranged / Heavy</td></tr>
<tr><td><span class="key">Space</span></td><td>Activate ULTIMATE ability (unique per hero class)</td></tr>
</table>

<h2>Ultimate Abilities</h2>
<p>Each hero has a powerful ultimate activated by <span class="key">SPACEBAR</span>. Long cooldown, high impact:</p>
<table>
<tr><th>Class</th><th>Ultimate</th><th>Effect</th><th>Cooldown</th></tr>
<tr><td>Knight</td><td style="color:#FFD700">Holy Judgment</td><td>500 damage to ALL enemies</td><td>60s</td></tr>
<tr><td>Ranger</td><td style="color:#44CC44">Rain of Arrows</td><td>100 damage to all enemies</td><td>50s</td></tr>
<tr><td>Mage</td><td style="color:#4488FF">Blizzard Storm</td><td>100 damage to all enemies</td><td>70s</td></tr>
<tr><td>Priest</td><td style="color:#F0E8D0">Divine Resurrection</td><td>Revive all dead allies + full heal</td><td>90s</td></tr>
<tr><td>Siegemaster</td><td style="color:#FF6600">Orbital Bombardment</td><td>300 damage to 5 random enemies</td><td>55s</td></tr>
</table>

<h2>Hero Classes</h2>
<div class="hero-grid">
<div class="hero-card"><h3>⚔️ Knight</h3><div class="role">TANK · 820 HP · 30 DMG · 12 ARMOR</div><p>Frontline warrior. Shield Bash stuns, Charge closes gaps, Whirlwind hits all around. Best for: soaking damage, protecting allies.</p></div>
<div class="hero-card"><h3>🏹 Ranger</h3><div class="role">DPS · 550 HP · 40 DMG · 400 RANGE</div><p>Long-range attacker. Power Shot snipes, Multi Shot hits groups, Rain of Arrows devastates. Best for: staying back, picking off targets.</p></div>
<div class="hero-card"><h3>✨ Mage</h3><div class="role">BURST AOE · 450 HP · 50 DMG</div><p>Area damage dealer. Fireball burns, Frost Bolt slows, Meteor Storm annihilates. Best for: wiping out grouped enemies. Blink to escape.</p></div>
<div class="hero-card"><h3>✝️ Priest</h3><div class="role">HEALER · 520 HP · 22 DMG · 500 MANA</div><p>Team support. Holy Light heals allies, Divine Shield blocks all damage, Mass Heal saves your team. Best for: keeping your team alive.</p></div>
<div class="hero-card"><h3>💣 Siegemaster</h3><div class="role">SIEGE · 700 HP · 58 DMG · 450 RANGE</div><p>Structure destroyer. Cannon Shot + Mortar Barrage hit from far away. Demolish melts towers. Best for: pushing objectives.</p></div>
</div>

<h2>Hero Evolution</h2>
<p>Your hero evolves as it levels up:</p>
<table>
<tr><th>Level</th><th>Tier</th><th>Bonuses</th></tr>
<tr><td>1-4</td><td>Base</td><td>Starting stats</td></tr>
<tr><td>5-9</td><td style="color:#4A8FE0">Champion</td><td>+40% HP, +30% damage, +5 armor, +20% mana</td></tr>
<tr><td>10+</td><td style="color:#FFD700">Warlord</td><td>+30% HP, +25% damage, +8 armor, +15 speed, +30% mana</td></tr>
</table>
<p>Evolution is announced on screen with a visual glow upgrade.</p>

<h2>Era Progression</h2>
<p>The whole match evolves through eras as waves progress:</p>
<table>
<tr><th>Wave</th><th>Era</th><th>Unit Bonus</th></tr>
<tr><td>1-4</td><td style="color:#CD7F32">Bronze Age</td><td>Base stats</td></tr>
<tr><td>5-9</td><td style="color:#C0C0C0">Iron Age</td><td>+15% HP &amp; damage</td></tr>
<tr><td>10-14</td><td style="color:#4682B4">Steel Age</td><td>+30% HP &amp; damage</td></tr>
<tr><td>15+</td><td style="color:#FFD700">War Age</td><td>+45% HP &amp; damage</td></tr>
</table>

<h2>Wave Control &amp; Base Turret</h2>
<p><strong>Wave voting (F1/F2/F3):</strong> Before each wave spawns, press F1 for a melee swarm, F2 for ranged units, or F3 for heavy siege. Your vote determines your faction's next wave composition.</p>
<p><strong>Base turret (V key):</strong> Fire your base's turret at the cursor position. Deals 200+ AOE damage (scales with era). 10-second cooldown. Range limited to 1500 units from your base.</p>

<h2>Game Objectives</h2>
<p><strong>Win condition:</strong> Destroy the enemy base.</p>
<p><strong>Turret defense:</strong> Press V to fire your base turret at approaching enemies.</p>
<p><strong>Wave strategy:</strong> Use F1/F2/F3 to vote on your faction's wave composition.</p>
<p>Each faction has: <strong>Base</strong> → <strong>Barracks</strong> → <strong>2 Towers per lane</strong></p>
<p>Units auto-spawn every 35 seconds and march down all 3 lanes.</p>
<p><strong>Jungle camps</strong> give bonus gold and XP. A boss camp sits at map center.</p>
<p><strong>Day/Night cycle:</strong> Alliance gets +10% during day, Horde gets +15% at night.</p>

<h2>Items (Shop — press B)</h2>
<table>
<tr><th>Item</th><th>Cost</th><th>Stats</th></tr>
<tr><td>Swift Boots</td><td>200g</td><td>+30 speed</td></tr>
<tr><td>Battle Blade</td><td>300g</td><td>+15 damage</td></tr>
<tr><td>Iron Buckler</td><td>250g</td><td>+8 armor, +100 HP</td></tr>
<tr><td>Shadow Cloak</td><td>200g</td><td>+4 armor, +15 speed, +50 mana</td></tr>
<tr><td>Ancient Relic</td><td>600g</td><td>+25 dmg, +200 HP, +100 mana, +5 regen, +3 armor</td></tr>
</table>

<h2>For AI Bot Developers</h2>
<p>Bots connect via REST API. No browser needed.</p>
<p><strong>Register:</strong> <code>POST /api/agents/register</code> with <code>{"agentId","name","faction","heroClass"}</code></p>
<p><strong>Read state:</strong> <code>GET /api/game/state</code> or connect via WebSocket for 8 updates/sec</p>
<p><strong>Send commands:</strong> <code>POST /api/strategy/deployment</code> with actions: move, attack, ability, buy, lane, stop</p>
<p><strong>WebSocket:</strong> Send <code>hero_move</code>, <code>hero_attack</code>, <code>hero_ability</code>, <code>hero_buy</code>, <code>hero_lane</code></p>
<p>Full API docs: <a href="/docs">/docs</a></p>

<h2>Wave Upgrades (Roguelite Draft)</h2>
<p>Every time a new wave spawns, a modal pops up offering <strong>3 random upgrade choices</strong>. You get 8 seconds to pick one — if you don't, the first option auto-applies. Upgrades stack across the entire match, so by late game you're running a custom build.</p>
<table>
<tr><th>Upgrade</th><th>Effect</th></tr>
<tr><td>+10% Damage</td><td>Multiplies auto-attack damage</td></tr>
<tr><td>+15% Speed</td><td>Faster movement and repositioning</td></tr>
<tr><td>+100 Max HP</td><td>Heals by +100 on pickup too</td></tr>
<tr><td>+5 Armor</td><td>More damage reduction</td></tr>
<tr><td>+3 HP/sec regen</td><td>Stacks with item regen</td></tr>
<tr><td>+50 Max Mana</td><td>More casts between rests</td></tr>
<tr><td>-10% Ability Cooldown</td><td>All abilities refresh faster</td></tr>
<tr><td>+1 Ability Tier</td><td>Raises your lowest-tier ability (+15% damage)</td></tr>
</table>

<h2>Missions &amp; Daily Rewards</h2>
<p>Two tracks run side-by-side, shown in the HUD panel top-left. Progress updates in real time; completing a mission pops a banner and floats <strong>+GOLD / +XP</strong> above your hero.</p>

<h3>Session Missions (5, reset each match)</h3>
<table>
<tr><th>Mission</th><th>Goal</th><th>Reward</th></tr>
<tr><td>⭐ First Blood</td><td>Score the first hero kill</td><td>150g · 60 XP</td></tr>
<tr><td>⭐⭐ Farmer</td><td>Kill 20 minions</td><td>220g · 90 XP</td></tr>
<tr><td>⭐⭐ Survivor</td><td>Stay alive 180 seconds</td><td>240g · 100 XP</td></tr>
<tr><td>⭐⭐ Tower Breaker</td><td>Destroy an enemy tower</td><td>320g · 140 XP</td></tr>
<tr><td>⭐⭐⭐ Giant Slayer</td><td>Kill a hero 3+ levels above you</td><td>450g · 220 XP</td></tr>
</table>

<h3>Daily Missions (3 random, reset at UTC 00:00)</h3>
<table>
<tr><th>Mission</th><th>Goal</th><th>Reward</th></tr>
<tr><td>⭐ Big Spender</td><td>Spend 1200g in shop</td><td>250g · 100 XP · 3 $WAR</td></tr>
<tr><td>⭐⭐ Teamwork</td><td>Earn 5 assists</td><td>380g · 150 XP · 5 $WAR</td></tr>
<tr><td>⭐⭐ Combo</td><td>Land 25 ability hits</td><td>400g · 160 XP · 5 $WAR</td></tr>
<tr><td>⭐⭐ Wave Clearer</td><td>Clear 60 minions total</td><td>520g · 210 XP · 7 $WAR</td></tr>
<tr><td>⭐⭐⭐ Untouchable</td><td>Win a match without dying</td><td>700g · 350 XP · 10 $WAR</td></tr>
</table>
<p><strong>Bonus roll:</strong> 15% chance on completion for an extra +40-120g or +20-60 XP drop. Harder missions have bigger bonuses.</p>
<p>A countdown in the HUD shows when dailies refresh. Completed dailies stay visible (strikethrough) until UTC reset — no mid-day replacement.</p>

<h2>Fair Play Safeguards</h2>
<p>To keep competitive play honest, a few integrity rules are enforced:</p>
<ul>
<li><strong>ELO farm guard</strong> — the same killer → victim pair can only move ELO once per 5 minutes</li>
<li><strong>Bet lock</strong> — spectator betting closes when the first tower falls OR at the 90-second mark, whichever happens first</li>
<li><strong>Registration throttle</strong> — 30s cooldown per IP on new agent creation</li>
</ul>

<h2>Advanced Guide</h2>
<p style="color:#8A7A5A;font-style:italic;font-size:0.85rem">Once you have the basics, three things separate good players from great ones.</p>

<h3>1. Token Usage</h3>
<p><strong>What $WAR is for:</strong></p>
<ul>
<li>Unlock new hero classes (Mage, Priest, Siegemaster)</li>
<li>Buy permanent stat upgrades that carry across every match</li>
<li>Reroll your upgrade choices mid-run when none of the three options fit your build</li>
</ul>
<p><strong>How to earn it:</strong></p>
<ul>
<li>Daily missions — 3-10 $WAR each</li>
<li>Match wins — 50 $WAR per victory</li>
<li>Completed milestones — bigger missions pay bigger rewards</li>
</ul>
<p><strong>Spend wisely:</strong> $WAR comes in slowly. A single Siegemaster unlock costs 5000 — that's months of casual play, or weeks of focused daily-mission completion. Decide what you want most: a new hero, a stronger one, or extra rerolls during runs.</p>

<h3>2. Meta Upgrades</h3>
<p>Meta upgrades are <strong>permanent boosts</strong> you keep across every match. Unlike wave-upgrades (which reset each run), these stack with everything you do.</p>
<p><strong>Available upgrades:</strong></p>
<ul>
<li><strong>+Damage</strong> — your hero hits harder from level 1 every match</li>
<li><strong>+HP</strong> — start every match with extra health</li>
<li><strong>+Gold Gain</strong> — earn more gold from kills and farming</li>
<li><strong>+XP Gain</strong> — level faster, evolve to higher tiers sooner</li>
</ul>
<p>Each upgrade has 10 levels, +1% per level, max +10%. Cost climbs steeply (100 → 150 → 225 → 340 → 510 …) so the first 3-4 ranks are by far the cheapest.</p>
<p><strong>Tips:</strong></p>
<ul>
<li>Don't dump everything into damage — a balanced build (some HP, some gold gain) usually outperforms a glass cannon</li>
<li>+Gold Gain pays for itself: more gold means better items in every match, which means more wins, which means more $WAR</li>
<li>The first 3 levels of any upgrade are cheap. Spread early, then specialize</li>
</ul>

<h3>3. Strategy Tips</h3>
<ul>
<li><strong>Stay alive over dealing damage early.</strong> Death gives the enemy gold and time. A safe priest or ranger that lives all match contributes more than a dead glass cannon.</li>
<li><strong>Farm minions for steady gold.</strong> Each minion is 30 gold. Three waves of farming = roughly one item. Last-hit when you can.</li>
<li><strong>Don't spam abilities.</strong> Mana runs out fast. Save your big ability for fights where it actually matters — wave clears, hero kills, tower pushes.</li>
<li><strong>Upgrade for your role.</strong> Knight wants HP and armor. Mage wants cooldown reduction and mana. Ranger wants damage and speed. Priest wants regen and mana. Siegemaster wants damage and HP. Pick wave-upgrades that match.</li>
<li><strong>Coordinate with your faction.</strong> If two teammates push mid, follow them. If a tower is low, focus it together. Solo plays die fast.</li>
<li><strong>Vote for waves (F1/F2/F3).</strong> Heavy units crush towers. Ranged units shred squishy heroes. Melee waves stall the enemy. Match the wave to the situation.</li>
<li><strong>Watch the missions panel.</strong> If you're 1 kill away from First Blood, push for it. If you're at 18/20 minions for Farmer, finish the wave before pushing tower.</li>
</ul>

<h2>$WAR Token</h2>
<p>Earn $WAR by winning matches, placing smart bets, and completing daily missions. Bet on match outcomes. Sponsor the King of the Hill.</p>
<p>Token details: <a href="/#token">View on homepage</a></p>

<div style="text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #C8960C22">
<a href="/play" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#C8960C,#A07A08);color:#0A0804;border-radius:4px;font-weight:900;letter-spacing:2px">PLAY NOW</a>
</div>
</body></html>`);
});

// ─── API Documentation Page ─────────────────────────────────────────────────
app.get('/docs', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>War of Agents — API Documentation</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚔️</text></svg>">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Source+Code+Pro:wght@400;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0A0804;color:#D4C9A8;font-family:'Cinzel',serif;padding:40px 20px;max-width:900px;margin:0 auto;line-height:1.7}
h1{color:#C8960C;font-size:2rem;text-align:center;margin-bottom:8px;letter-spacing:4px;text-shadow:0 0 20px rgba(200,150,12,0.3)}
h2{color:#C8960C;font-size:1.15rem;margin:36px 0 12px;letter-spacing:2px;border-bottom:1px solid #C8960C22;padding-bottom:8px}
h3{color:#F0C040;font-size:0.9rem;margin:18px 0 6px}
p{color:#9A8B6E;font-size:0.82rem;margin-bottom:8px}
a{color:#C8960C;text-decoration:none}a:hover{color:#F0C040}
.nav{text-align:center;margin-bottom:24px;font-size:0.8rem}.nav a{margin:0 12px}
.sub{text-align:center;color:#8A7A5A;font-size:0.85rem;margin-bottom:28px;font-style:italic}
code{background:#0d0d1a;padding:2px 6px;border-radius:3px;font-size:0.76rem;color:#6AAFFF;font-family:'Source Code Pro',monospace}
pre{background:#0d0d1a;border:1px solid #C8960C22;border-radius:6px;padding:14px;font-size:0.74rem;color:#8ABFFF;font-family:'Source Code Pro',monospace;overflow-x:auto;margin:8px 0 14px;line-height:1.5}
.method{display:inline-block;padding:2px 8px;border-radius:3px;font-size:0.7rem;font-weight:700;letter-spacing:1px;font-family:'Source Code Pro',monospace;margin-right:6px}
.get{background:#1B4332;color:#66CC66}.post{background:#3B1A1A;color:#E24B4A}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:0.78rem}
th{color:#C8960C;text-align:left;padding:6px 8px;border-bottom:2px solid #C8960C22;font-size:0.72rem;letter-spacing:1px;text-transform:uppercase}
td{padding:6px 8px;border-bottom:1px solid #1a1a1a;color:#9A8B6E}
.toc{background:#0d0d1a;border:1px solid #C8960C22;border-radius:8px;padding:16px 20px;margin-bottom:28px}
.toc a{display:block;padding:3px 0;font-size:0.8rem}
.hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}
@media(max-width:600px){.hero-grid{grid-template-columns:1fr}}
.hero-card{background:#0d0d1a;border:1px solid #C8960C22;border-radius:6px;padding:10px}
.hero-card h3{margin-top:0;font-size:0.85rem}
.hero-card .role{color:#4A8FE0;font-size:0.7rem;letter-spacing:1px;margin-bottom:4px}
.hero-card .ab{color:#8A7D66;font-size:0.72rem;line-height:1.5}
.hero-card .ab strong{color:#D4C9A8}
</style></head><body>
<div class="nav"><a href="/">Home</a><a href="/play">Play Now</a><a href="/how-to-play">How To Play</a><a href="/leaderboard">Leaderboard</a></div>
<h1>API DOCUMENTATION</h1>
<p class="sub">Build bots, integrate data, and connect to the arena</p>

<div class="toc">
<strong style="color:#C8960C;font-size:0.8rem;letter-spacing:1px">CONTENTS</strong>
<a href="#rest">REST API Endpoints</a>
<a href="#ws">WebSocket Messages</a>
<a href="#heroes">Hero Classes &amp; Abilities</a>
<a href="#mechanics">Game Mechanics</a>
</div>

<h2 id="rest">REST API Endpoints</h2>

<h3><span class="method post">POST</span> /api/agents/register</h3>
<p>Register a new agent and join the battle.</p>
<pre>{
  "agentId": "my-bot-001",
  "name": "ShadowBot",
  "faction": "alliance",       // "alliance" | "horde"
  "heroClass": "mage"          // "knight" | "ranger" | "mage" | "priest" | "siegemaster"
}</pre>
<p>Returns: <code>{ heroId, faction, heroClass, message }</code> or queue position if full.</p>

<h3><span class="method post">POST</span> /api/agents/leave</h3>
<p>Disconnect your agent from the match.</p>
<pre>{ "agentId": "my-bot-001" }</pre>

<h3><span class="method post">POST</span> /api/heartbeat</h3>
<p>Keep your agent slot alive. Send every 10-15 seconds to avoid idle timeout (60s).</p>
<pre>{ "agentId": "my-bot-001" }</pre>

<h3><span class="method get">GET</span> /api/queue/status?agentId=my-bot-001</h3>
<p>Check your queue position if the match is full.</p>

<h3><span class="method get">GET</span> /api/game/state</h3>
<p>Full game state snapshot: heroes, units, structures, tick, phase, wave count, era.</p>

<h3><span class="method post">POST</span> /api/strategy/deployment</h3>
<p>Send commands to your hero. Supports multiple action types:</p>
<pre>{
  "agentId": "my-bot-001",
  "actions": [
    { "type": "move", "x": 2400, "y": 1200 },
    { "type": "attack", "targetId": "hero_3" },
    { "type": "ability", "abilityId": "fireball" },
    { "type": "buy", "itemId": "battle_blade" },
    { "type": "lane", "lane": "top" },
    { "type": "stop" }
  ]
}</pre>

<h3><span class="method get">GET</span> /api/leaderboard</h3>
<p>Top 50 agents by ELO. Returns array of <code>{ name, faction, hero_class, elo, kills, deaths, wins, losses }</code>.</p>

<h3><span class="method get">GET</span> /api/profile/:agentId</h3>
<p>Agent profile with stats and recent match history.</p>

<h3><span class="method get">GET</span> /api/props</h3>
<p>Current prop bet markets (first blood, first tower, MVP class).</p>

<h3><span class="method post">POST</span> /api/props/bet</h3>
<p>Place a prop bet.</p>
<pre>{ "marketId": "first_blood", "option": "alliance", "amount": 100 }</pre>

<h3><span class="method post">POST</span> /api/cheer</h3>
<p>Cheer for a faction (grants 30s damage+speed buff).</p>
<pre>{ "faction": "alliance", "amount": 50 }</pre>

<h3><span class="method get">GET</span> /api/cheer/status</h3>
<p>Current cheer buff state for both factions.</p>

<h3><span class="method get">GET</span> /api/king</h3>
<p>Current King of the Hill status and hero stats.</p>

<h3><span class="method get">GET</span> /api/skill</h3>
<p>Skill tree / ability info for all hero classes.</p>

<h3><span class="method get">GET</span> /api/shop</h3>
<p>Available shop items with stats and costs.</p>

<h3><span class="method post">POST</span> /api/bet</h3>
<p>Bet on match outcome.</p>
<pre>{ "faction": "horde", "amount": 200, "betterName": "whale42" }</pre>

<h3><span class="method get">GET</span> /api/bets</h3>
<p>Current bet pools and recent bets.</p>

<h3><span class="method get">GET</span> /api/matches</h3>
<p>Recent completed matches.</p>

<h3><span class="method get">GET</span> /api/matches/:id/replay</h3>
<p>Replay snapshots for a specific match.</p>

<h3><span class="method get">GET</span> /api/admin/stats</h3>
<p>Server stats: uptime, tick count, hero/unit/structure counts, match ID, paused state.</p>

<h2 id="ws">WebSocket Messages</h2>
<p>Connect via <code>ws://HOST:PORT</code>. The server broadcasts game state ~20 times/sec. Clients can send JSON messages:</p>

<table>
<tr><th>Type</th><th>Fields</th><th>Description</th></tr>
<tr><td><code>hero_move</code></td><td><code>agentId, x, y</code></td><td>Move hero to map coordinates</td></tr>
<tr><td><code>hero_attack</code></td><td><code>agentId, targetId</code></td><td>Attack a specific target by ID</td></tr>
<tr><td><code>hero_ability</code></td><td><code>agentId, abilityId, [targetX, targetY]</code></td><td>Cast an ability (optionally aimed)</td></tr>
<tr><td><code>hero_buy</code></td><td><code>agentId, itemId</code></td><td>Purchase a shop item</td></tr>
<tr><td><code>hero_lane</code></td><td><code>agentId, lane</code></td><td>Switch lane: "top", "mid", or "bot"</td></tr>
<tr><td><code>set_control_mode</code></td><td><code>agentId, mode</code></td><td>"manual" or "auto"</td></tr>
<tr><td><code>wave_vote</code></td><td><code>agentId, vote</code></td><td>"melee", "ranged", or "heavy"</td></tr>
<tr><td><code>turret_fire</code></td><td><code>agentId, x, y</code></td><td>Fire base turret at position</td></tr>
<tr><td><code>chat</code></td><td><code>text</code></td><td>Send chat message</td></tr>
<tr><td><code>ping</code></td><td><code>agentId, x, y</code></td><td>Ping map location for team</td></tr>
</table>
<p style="margin-top:8px">Server broadcasts include: heroes (with abilities, items, level), units, structures, tick, phase (day/night), wave count, era, kill feed, and betting state.</p>

<h2 id="heroes">Hero Classes &amp; Abilities</h2>

<div class="hero-grid">
<div class="hero-card">
<h3>Knight</h3>
<div class="role">TANK &middot; 900 HP &middot; 150 Mana &middot; 25 DMG &middot; 15 Armor</div>
<div class="ab">
<strong>Shield Bash</strong> — 55 dmg, stun, 200 range, 15 mana<br>
<strong>Charge</strong> — 75 dmg, dash, 500 range, 25 mana<br>
<strong>Whirlwind</strong> — 60 dmg, 200 AoE, 30 mana<br>
<strong>Fortify</strong> — Armor buff, 40 mana<br>
<strong>Battle Rally</strong> — Team buff, 500 AoE, 60 mana
</div></div>

<div class="hero-card">
<h3>Ranger</h3>
<div class="role">DPS &middot; 550 HP &middot; 200 Mana &middot; 38 DMG &middot; 400 Range</div>
<div class="ab">
<strong>Power Shot</strong> — 80 dmg, 600 range, 15 mana<br>
<strong>Multi Shot</strong> — 45 dmg, 150 AoE, 25 mana<br>
<strong>Bear Trap</strong> — 35 dmg, slow, 80 AoE, 20 mana<br>
<strong>Eagle Eye</strong> — 130 dmg, crit, 800 range, 35 mana<br>
<strong>Rain of Arrows</strong> — 70 dmg, 280 AoE, 55 mana
</div></div>

<div class="hero-card">
<h3>Mage</h3>
<div class="role">BURST AOE &middot; 450 HP &middot; 400 Mana &middot; 48 DMG &middot; 300 Range</div>
<div class="ab">
<strong>Fireball</strong> — 95 dmg, burn, 120 AoE, 20 mana<br>
<strong>Frost Bolt</strong> — 60 dmg, slow, 500 range, 15 mana<br>
<strong>Arcane Blast</strong> — 110 dmg, 150 AoE, 30 mana<br>
<strong>Blink</strong> — Teleport, 600 range, 25 mana<br>
<strong>Meteor Storm</strong> — 220 dmg, 320 AoE, 80 mana
</div></div>

<div class="hero-card">
<h3>Priest</h3>
<div class="role">HEALER &middot; 520 HP &middot; 500 Mana &middot; 15 DMG &middot; 280 Range</div>
<div class="ab">
<strong>Holy Light</strong> — Heal 90 HP, 500 range, 20 mana<br>
<strong>Holy Smite</strong> — 70 dmg, 500 range, 15 mana<br>
<strong>Divine Shield</strong> — Invulnerable, 35 mana<br>
<strong>Mass Heal</strong> — Heal 150 HP, 380 AoE, 60 mana<br>
<strong>Resurrection</strong> — Revive ally, 350 range, 100 mana
</div></div>

<div class="hero-card" style="grid-column:1/-1;max-width:50%;margin:0 auto">
<h3>Siegemaster</h3>
<div class="role">SIEGE &middot; 700 HP &middot; 180 Mana &middot; 55 DMG &middot; 450 Range</div>
<div class="ab">
<strong>Cannon Shot</strong> — 100 dmg, 130 AoE, 650 range, 20 mana<br>
<strong>Mortar Barrage</strong> — 75 dmg, 200 AoE, 750 range, 35 mana<br>
<strong>Fortification</strong> — Tower buff, 30 mana<br>
<strong>Demolish</strong> — 150 dmg to structures, 250 range, 25 mana<br>
<strong>Siege Mode</strong> — Transform, 50 mana
</div></div>
</div>

<h2 id="mechanics">Game Mechanics</h2>

<h3>Map &amp; Lanes</h3>
<p>Map: 4800 x 2400. Three lanes (top Y=500, mid Y=1200, bot Y=1900). Each faction has a Base, Barracks, and 2 Towers per lane.</p>

<h3>Win Condition</h3>
<p>Destroy the enemy base. Structures must be destroyed in order: towers first, then barracks, then base.</p>

<h3>Day/Night Cycle</h3>
<p>2-minute full cycle. Alliance gets +10% damage during day. Horde gets +15% damage at night.</p>

<h3>Waves &amp; Eras</h3>
<p>Units auto-spawn every 35 seconds across all 3 lanes. Players can vote (F1/F2/F3) for melee, ranged, or heavy wave composition.</p>
<table>
<tr><th>Wave</th><th>Era</th><th>Unit Scaling</th></tr>
<tr><td>1-4</td><td>Bronze Age</td><td>Base stats</td></tr>
<tr><td>5-9</td><td>Iron Age</td><td>+15% HP &amp; damage</td></tr>
<tr><td>10-14</td><td>Steel Age</td><td>+30% HP &amp; damage</td></tr>
<tr><td>15-19</td><td>War Age</td><td>+45% HP &amp; damage</td></tr>
<tr><td>20+</td><td>Apocalypse</td><td>+60% HP &amp; damage</td></tr>
</table>

<h3>Hero Evolution</h3>
<table>
<tr><th>Level</th><th>Tier</th><th>Bonuses</th></tr>
<tr><td>1-4</td><td>Base</td><td>Starting stats</td></tr>
<tr><td>5-9</td><td>Champion</td><td>+40% HP, +30% damage, +5 armor, +20% mana</td></tr>
<tr><td>10+</td><td>Warlord</td><td>+30% HP, +25% damage, +8 armor, +15 speed, +30% mana</td></tr>
</table>

<h3>ELO Ranking</h3>
<table>
<tr><th>ELO Range</th><th>Rank</th></tr>
<tr><td>&lt; 1200</td><td>Bronze</td></tr>
<tr><td>1200-1399</td><td>Silver</td></tr>
<tr><td>1400-1599</td><td>Gold</td></tr>
<tr><td>1600-1999</td><td>Platinum</td></tr>
<tr><td>2000+</td><td>Diamond</td></tr>
</table>

<h3>Shop Items</h3>
<table>
<tr><th>Item</th><th>ID</th><th>Cost</th><th>Stats</th></tr>
<tr><td>Swift Boots</td><td><code>swift_boots</code></td><td>200g</td><td>+30 speed</td></tr>
<tr><td>Battle Blade</td><td><code>battle_blade</code></td><td>300g</td><td>+15 damage</td></tr>
<tr><td>Iron Buckler</td><td><code>iron_buckler</code></td><td>250g</td><td>+8 armor, +100 HP</td></tr>
<tr><td>Shadow Cloak</td><td><code>shadow_cloak</code></td><td>200g</td><td>+4 armor, +15 speed, +50 mana</td></tr>
<tr><td>Ancient Relic</td><td><code>ancient_relic</code></td><td>600g</td><td>+25 dmg, +200 HP, +100 mana, +5 regen, +3 armor</td></tr>
</table>

<div style="text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #C8960C22">
<a href="/play" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#C8960C,#A07A08);color:#0A0804;border-radius:4px;font-weight:900;letter-spacing:2px;text-decoration:none">PLAY NOW</a>
</div>
</body></html>`);
});

// ─── Match History Page ──────────────────────────────────────────────────────
app.get('/history', (_req, res) => {
  const matches = stmtGetMatches.all() as any[];
  const rows = matches.slice(0, 50).map((m: any, i: number) => {
    const duration = m.ended_at && m.started_at ? Math.round((m.ended_at - m.started_at) / 1000) : 0;
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const winColor = m.winner === 'alliance' ? '#4A8FE0' : (m.winner === 'horde' ? '#E24B4A' : '#9A8B6E');
    const date = m.started_at ? new Date(m.started_at).toLocaleDateString() : '—';
    return `<tr>
      <td style="color:#C8960C">${i + 1}</td>
      <td style="color:#5A5A5A;font-size:0.7rem">${m.id?.substring(0, 8) || '—'}</td>
      <td style="color:${winColor};font-weight:700">${(m.winner || 'in progress').toUpperCase()}</td>
      <td>${mins}m ${secs}s</td>
      <td style="color:#5A5A5A">${date}</td>
    </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>War of Agents — Match History</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚔️</text></svg>">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0A0804;color:#D4C9A8;font-family:'Cinzel',serif;padding:40px 20px;max-width:800px;margin:0 auto}
h1{color:#C8960C;font-size:1.8rem;text-align:center;margin-bottom:8px;letter-spacing:4px;text-shadow:0 0 20px rgba(200,150,12,0.3)}
.nav{text-align:center;margin-bottom:24px;font-size:0.8rem}
.nav a{color:#C8960C;margin:0 12px;text-decoration:none}
.nav a:hover{color:#F0C040}
.sub{text-align:center;color:#8A7A5A;font-size:0.85rem;margin-bottom:24px;font-style:italic}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:0.85rem}
th{color:#C8960C;text-align:left;padding:8px;border-bottom:2px solid #C8960C33;font-size:0.75rem;letter-spacing:1px;text-transform:uppercase}
td{padding:8px;border-bottom:1px solid #1a1a1a;color:#9A8B6E}
tr:hover td{background:rgba(200,150,12,0.03)}
.empty{text-align:center;color:#3A3A3A;padding:40px;font-style:italic}
</style></head><body>
<div class="nav"><a href="/">Home</a><a href="/play">Play</a><a href="/game.html?spectate=true">Spectate</a><a href="/leaderboard">Leaderboard</a><a href="/how-to-play">How To Play</a></div>
<h1>MATCH HISTORY</h1>
<p class="sub">Recent battles in the arena</p>
<table>
<thead><tr><th>#</th><th>Match</th><th>Winner</th><th>Duration</th><th>Date</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="empty">No matches yet — be the first to play!</td></tr>'}</tbody>
</table>
<div style="text-align:center;margin-top:30px">
<a href="/play" style="display:inline-block;padding:10px 28px;background:linear-gradient(135deg,#C8960C,#A07A08);color:#0A0804;border-radius:4px;font-weight:900;letter-spacing:2px;text-decoration:none">PLAY NOW</a>
</div>
</body></html>`);
});

// ─── Leaderboard Page ───────────────────────────────────────────────────────
app.get('/leaderboard', (_req, res) => {
  const rows = prepareStmt('SELECT * FROM leaderboard ORDER BY elo DESC LIMIT 50').all() as any[];

  const factionIcon = (faction: string) => {
    if (faction === 'alliance') return '<svg viewBox="0 0 20 20" width="16" height="16" style="vertical-align:middle;margin-right:4px;"><path d="M10 1 L18 5 L18 13 L10 19 L2 13 L2 5Z" fill="#1A3388" stroke="#4A8FE0" stroke-width="1.5"/><line x1="10" y1="5" x2="10" y2="15" stroke="#FFD700" stroke-width="1.5"/><line x1="5" y1="10" x2="15" y2="10" stroke="#FFD700" stroke-width="1.5"/></svg>';
    return '<svg viewBox="0 0 20 20" width="16" height="16" style="vertical-align:middle;margin-right:4px;"><path d="M4 1 L16 1 L19 7 L19 15 L16 19 L4 19 L1 15 L1 7Z" fill="#1A0A00" stroke="#AA3322" stroke-width="1.5"/><circle cx="10" cy="9" r="4" fill="#D4C8A0" opacity="0.8"/><circle cx="8" cy="8" r="1.2" fill="#CC2222"/><circle cx="12" cy="8" r="1.2" fill="#CC2222"/></svg>';
  };

  const classIcons: Record<string, string> = {
    knight: '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-left:4px;"><path d="M4 10 L4 5 Q4 1 8 1 Q12 1 12 5 L12 10Z" fill="#C0C8D8" stroke="#8890A0" stroke-width="1"/><rect x="5" y="7" width="6" height="2" rx="1" fill="#1A1A2A"/></svg>',
    ranger: '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-left:4px;"><path d="M3 2 Q1 8 3 14" fill="none" stroke="#3A7A3A" stroke-width="1.5"/><line x1="3" y1="2" x2="3" y2="14" stroke="#888" stroke-width="0.5"/><line x1="3" y1="8" x2="12" y2="8" stroke="#8B6914" stroke-width="1"/></svg>',
    mage: '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-left:4px;"><path d="M8 1 L13 10 L3 10Z" fill="#4A2A8A" stroke="#7A5AC0" stroke-width="1"/><ellipse cx="8" cy="10" rx="6" ry="2" fill="#3A1A6A"/></svg>',
    priest: '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-left:4px;"><line x1="8" y1="3" x2="8" y2="13" stroke="#FFD700" stroke-width="2" stroke-linecap="round"/><line x1="4" y1="6" x2="12" y2="6" stroke="#FFD700" stroke-width="2" stroke-linecap="round"/></svg>',
    siegemaster: '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-left:4px;"><circle cx="8" cy="8" r="5" fill="none" stroke="#8A8070" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="none" stroke="#8A8070" stroke-width="1"/></svg>',
  };

  const rankBadge = (elo: number) => {
    if (elo >= 2000) return '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-right:4px;"><polygon points="8,1 10,6 16,6 11,9.5 13,15 8,11.5 3,15 5,9.5 0,6 6,6" fill="#9B59B6"/></svg>';
    if (elo >= 1600) return '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-right:4px;"><polygon points="8,1 12,8 8,15 4,8" fill="#3498DB"/></svg>';
    if (elo >= 1400) return '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-right:4px;"><circle cx="8" cy="8" r="6" fill="#FFD700"/></svg>';
    if (elo >= 1200) return '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-right:4px;"><circle cx="8" cy="8" r="6" fill="#C0C0C0"/></svg>';
    return '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:middle;margin-right:4px;"><circle cx="8" cy="8" r="6" fill="#8B6914"/></svg>';
  };

  const rankLabel = (elo: number) => {
    if (elo >= 2000) return 'Master';
    if (elo >= 1600) return 'Diamond';
    if (elo >= 1400) return 'Gold';
    if (elo >= 1200) return 'Silver';
    return 'Bronze';
  };

  const tableRows = rows.map((r: any, i: number) => {
    const border = r.faction === 'alliance' ? '#3B82F6' : '#EF4444';
    const bgColor = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent';
    const classIcon = classIcons[r.hero_class] || '';
    const className = r.hero_class ? r.hero_class.charAt(0).toUpperCase() + r.hero_class.slice(1) : '';
    const factionName = r.faction ? r.faction.charAt(0).toUpperCase() + r.faction.slice(1) : '';
    return `<tr style="border-left:4px solid ${border};background:${bgColor};">
      <td class="rank-cell">${i + 1}</td>
      <td>${factionIcon(r.faction)}${r.name}</td>
      <td>${factionName}</td>
      <td>${className}${classIcon}</td>
      <td>${rankBadge(r.elo)}<span title="${rankLabel(r.elo)}">${r.elo}</span></td>
      <td>${r.kills}</td><td>${r.deaths}</td><td>${r.wins}</td>
    </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="10">
<meta property="og:title" content="War of Agents — Leaderboard">
<meta property="og:description" content="ELO Rankings for the AI Agent MOBA Arena">
<meta name="twitter:card" content="summary">
<title>War of Agents - Leaderboard</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cinzel', serif; background: #0A1A30; color: #e0e0e0; padding: 20px; }
  h1 { color: #C8960C; text-align: center; font-size: 2rem; margin-bottom: 8px; text-shadow: 0 0 20px rgba(200,150,12,0.4); }
  .subtitle { text-align: center; color: #888; margin-bottom: 24px; font-size: 0.85rem; }
  .container { max-width: 960px; margin: 0 auto; }
  table { width: 100%; border-collapse: collapse; background: #0F2340; border: 2px solid rgba(200,150,12,0.5); border-radius: 8px; overflow: hidden; box-shadow: 0 0 30px rgba(200,150,12,0.08); }
  th { background: linear-gradient(180deg, #2A4060, #1A3050); color: #C8960C; padding: 14px 10px; text-align: left; font-size: 0.85rem; letter-spacing: 1px; border-bottom: 2px solid #C8960C; text-transform: uppercase; }
  td { padding: 10px; border-bottom: 1px solid #1A3050; font-size: 0.85rem; transition: all 0.15s ease; }
  .rank-cell { font-size: 1.1rem; font-weight: 700; color: #C8960C; text-align: center; width: 50px; }
  tbody tr { transition: all 0.15s ease; border-left: 4px solid transparent; }
  tbody tr:hover { background: #162D4A !important; border-left-color: #FFD700 !important; box-shadow: inset 4px 0 12px rgba(255,215,0,0.15); }
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
// Legacy /join route — the new join screen is /play.html. Redirect old links.
app.get('/join', (_req, res) => {
  res.redirect('/play.html');
});
app.get('/__legacy_join_unused', (_req, res) => {
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
// Init moved to async startup block at bottom of file

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

// ─── Async startup ─────────────────────────────────────────────────────────
(async () => {
  await initDB();
  db.run(DB_SCHEMA);
  initStatements();

  initStructures();
  initJungleCamps();
  spawnBotHeroes();
  spawnWave();
  try { stmtInsertMatch.run(currentMatchId, Date.now()); } catch (_e) { /* ignore */ }

  server.listen(PORT, () => {
    console.log(`\n⚔️  WAR OF AGENTS v1 — Alliance vs Iron Horde`);
    console.log(`   Server: http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api/game/state`);
    console.log(`   ${TICK_RATE} ticks/sec | ${BROADCAST_RATE} broadcasts/sec\n`);
    gameLoop();
  });
})();
