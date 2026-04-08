/**
 * World of Agents - PvP Server
 * Multiplayer MOBA mode where two players control heroes
 * 
 * Tokenomics integration:
 * - Players earn in-match gold from combat
 * - Gold converts to pending $WOA after each match
 * - Winner gets 1.10x multiplier, loser gets 0.90x
 */

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { createAgent, isAlive, regenMana } from "./Agent.js";
import { createGameState, addHeroToGame, getFullGameStatus, logEvent, moveHeroToLane } from "./GameState.js";
import { processTick, heroBasicAttack, heroUseAbility, canUseAbility } from "./CombatEngine.js";
import { isAbilityReady, canAffordAbility } from "./Ability.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const TICK_RATE = Number(process.env.TICK_RATE || 10);
const BROADCAST_RATE = Number(process.env.BROADCAST_RATE || 20);

const WOA_PER_GOLD = 1 / 20;
const WOA_PER_MATCH_CAP = 150;

const HERO_CLASSES = ["WARRIOR", "MAGE", "RANGER", "HEALER"];

const players = new Map();
const queue = [];
const activeGames = new Map();
let gameIdCounter = 1;

const DATA_DIR = path.join(__dirname, "data");
const PLAYER_DATA_FILE = path.join(DATA_DIR, "player-rewards.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadPlayerRewards() {
  ensureDataDir();
  if (!fs.existsSync(PLAYER_DATA_FILE)) {
    const initial = { players: {}, updatedAt: new Date().toISOString() };
    fs.writeFileSync(PLAYER_DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(PLAYER_DATA_FILE, "utf8"));
  } catch {
    return { players: {}, updatedAt: new Date().toISOString() };
  }
}

function savePlayerRewards(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(PLAYER_DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

let playerRewardsData = loadPlayerRewards();

function getPlayerRewardBalance(playerId) {
  return playerRewardsData.players[playerId]?.pending || 0;
}

function addPlayerReward(playerId, woaAmount) {
  if (!playerRewardsData.players[playerId]) {
    playerRewardsData.players[playerId] = { pending: 0, totalEarned: 0, totalClaimed: 0 };
  }
  playerRewardsData.players[playerId].pending += woaAmount;
  playerRewardsData.players[playerId].totalEarned += woaAmount;
  savePlayerRewards(playerRewardsData);
}

function createPlayer(id, name) {
  return {
    id,
    name,
    joinedAt: new Date().toISOString(),
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    pendingWoa: getPlayerRewardBalance(id),
  };
}

function findMatch() {
  if (queue.length < 1) return null;

  const p1 = queue.shift();
  
  // If no opponent, create practice mode vs AI
  const vsAI = queue.length < 1;
  const p2 = vsAI ? {
    id: "ai_bot",
    name: "AI Bot",
    isAI: true,
  } : queue.shift();

  const gameId = `pvp_${gameIdCounter++}`;
  const game = createGameState(gameId);
  game.mode = "pvp";
  game.isPractice = vsAI;
  game.players = {
    alliance: { id: p1.id, name: p1.name },
    horde: { id: p2.id, name: p2.name },
  };
  game.phase = "hero_select";
  game.heroSelectTimer = 0;
  game.maxHeroSelectTime = 600;
  game.selectedHeroes = { alliance: null, horde: null };
  game.playerInputs = { alliance: {}, horde: {} };

  activeGames.set(gameId, game);

  p1.gameId = gameId;
  p1.faction = "alliance";
  p2.gameId = gameId;
  p2.faction = "horde";

  console.log(`[MATCH] ${p1.name} (Alliance) vs ${p2.name} (Horde) in ${gameId}`);

  return { gameId, p1, p2 };
}

function initPvPGame(gameId) {
  const game = activeGames.get(gameId);
  if (!game) return;

  const allianceHero = createSelectedHero(game.selectedHeroes.alliance, "alliance");
  const hordeHero = game.isPractice
    ? createAIHero(game.selectedHeroes.horde || "MAGE", "horde")
    : createSelectedHero(game.selectedHeroes.horde, "horde");

  addHeroToGame(game, allianceHero, "alliance", "mid");
  addHeroToGame(game, hordeHero, "horde", "mid");

  // Add creep spawning to PvP games
  game.spawnConfig = {
    mid: { spawnEvery: 3, maxPerSide: 20, burst: 2, allianceType: "FOOTMAN", hordeType: "GRUNT" },
  };

  game.phase = "active";
  game.tick = 0;
  game.startedAt = new Date().toISOString();
}

function createSelectedHero(classType, faction) {
  const hero = createAgent(`${faction === "alliance" ? "Alliance" : "Horde"} Hero`, classType);
  hero.isPlayerControlled = true;
  hero.faction = faction;
  return hero;
}

function createAIHero(classType, faction) {
  const hero = createAgent("AI Bot", classType);
  hero.isPlayerControlled = false;
  hero.faction = faction;
  return hero;
}

function getPvPState(game) {
  const state = getFullGameStatus(game);
  state.mode = "pvp";
  state.phase = game.phase;
  state.players = game.players;
  state.heroSelectTimer = game.heroSelectTimer || 0;
  state.maxHeroSelectTime = game.maxHeroSelectTime || 600;
  state.selectedHeroes = game.selectedHeroes;
  return state;
}

function processPlayerInput(game, faction, input) {
  if (game.phase !== "active") return;

  const hero = game.heroes[faction][0];
  if (!hero || !hero.alive) return;

  const inputs = game.playerInputs[faction];

  if (input.action === "move") {
    inputs.moveDir = input.direction;
  } else if (input.action === "attack") {
    inputs.attackTarget = input.target;
  } else if (input.action === "ability") {
    inputs.castAbility = input.ability;
  }
}

function applyPlayerInputs(game) {
  for (const faction of ["alliance", "horde"]) {
    const hero = game.heroes[faction][0];
    if (!hero || !hero.alive) continue;

    const inputs = game.playerInputs[faction];

    if (inputs.moveDir) {
      const dir = inputs.moveDir === "left" ? -1 : 1;
      hero.pos = Math.max(-95, Math.min(95, hero.pos + dir * 2));
    }

    if (inputs.castAbility && hero.mana >= 50) {
      hero.mana -= 50;
      hero.lastAbilityTick = game.tick;
      logEvent(game, "ability_used", {
        hero: hero.name,
        ability: inputs.castAbility,
        faction,
      });
    }

    inputs.moveDir = null;
    inputs.castAbility = null;
  }

  // AI bot logic for practice mode — uses real combat engine
  if (game.isPractice) {
    const playerHero = game.heroes.alliance[0];
    const aiHero = game.heroes.horde[0];

    if (playerHero && aiHero && isAlive(aiHero)) {
      regenMana(aiHero);
      const hpPct = aiHero.hp / aiHero.maxHp;

      // State-based AI: retreat if low HP, otherwise aggressive
      if (hpPct < 0.25 && isAlive(playerHero)) {
        // DEFENSIVE: retreat toward horde base
        aiHero.pos = Math.min(95, (aiHero.pos || 50) + 2);
        // Try to heal if possible
        const heal = aiHero.abilities.find((ab) => ab.type === "heal" && isAbilityReady(ab) && canAffordAbility(aiHero, ab));
        if (heal) heroUseAbility(aiHero, playerHero, game, heal);
      } else if (isAlive(playerHero)) {
        // AGGRESSIVE: move toward player and fight
        const aiPos = aiHero.pos || 50;
        const pPos = playerHero.pos || -50;
        const dist = Math.abs(aiPos - pPos);

        if (dist > 15) {
          aiHero.pos = aiPos + (pPos > aiPos ? 1.5 : -1.5);
        } else if (game.tick % 3 === 0) {
          // Pick best ability or basic attack
          const bestAb = aiHero.abilities.find((ab) => isAbilityReady(ab) && canAffordAbility(aiHero, ab) && ab.type !== "heal");
          if (bestAb) {
            heroUseAbility(aiHero, playerHero, game, bestAb);
          } else {
            heroBasicAttack(aiHero, playerHero, game);
          }
        }
      }
    }
  }
}

function resolvePvPWinner(game) {
  const aBase = game.strongholds.alliance.hp;
  const hBase = game.strongholds.horde.hp;

  if (aBase <= 0) return "horde";
  if (hBase <= 0) return "alliance";

  const aHero = game.heroes.alliance[0];
  const hHero = game.heroes.horde[0];

  if (aHero && !aHero.alive && hHero && hHero.alive) return "horde";
  if (hHero && !hHero.alive && aHero && aHero.alive) return "alliance";

  return null;
}

function endPvPGame(gameId, winner) {
  const game = activeGames.get(gameId);
  if (!game) return;

  game.phase = "ended";
  game.winner = winner;
  game.endedAt = new Date().toISOString();

  const p1 = players.get(game.players.alliance.id);
  const p2 = players.get(game.players.horde.id);

  const allianceGold = game.heroes.alliance.reduce((acc, h) => acc + h.gold, 0);
  const hordeGold = game.heroes.horde.reduce((acc, h) => acc + h.gold, 0);

  const calculateRewards = (gold, isWinner) => {
    const multiplier = isWinner ? 1.10 : isWinner === null ? 1.00 : 0.90;
    const cappedGold = Math.min(gold, 5000);
    const woa = Math.floor(cappedGold * multiplier * WOA_PER_GOLD);
    return Math.min(woa, WOA_PER_MATCH_CAP);
  };

  const p1Rewards = calculateRewards(allianceGold, winner === "alliance");
  const p2Rewards = calculateRewards(hordeGold, winner === "horde");

  if (p1) {
    p1.gamesPlayed++;
    if (winner === "alliance") p1.wins++;
    else p1.losses++;
    addPlayerReward(p1.id, p1Rewards);
    p1.pendingWoa = getPlayerRewardBalance(p1.id);
  }
  if (p2) {
    p2.gamesPlayed++;
    if (winner === "horde") p2.wins++;
    else p2.losses++;
    addPlayerReward(p2.id, p2Rewards);
    p2.pendingWoa = getPlayerRewardBalance(p2.id);
  }

  game.rewards = {
    alliance: { gold: allianceGold, woa: p1Rewards },
    horde: { gold: hordeGold, woa: p2Rewards },
  };

  if (p1) p1.gameId = null;
  if (p2) p2.gameId = null;

  console.log(`[GAME END] ${gameId} - Winner: ${winner} | Rewards: Alliance +${p1Rewards} WOA, Horde +${p2Rewards} WOA`);

  setTimeout(() => {
    activeGames.delete(gameId);
  }, 5000);
}

const STATIC_DIR = path.join(__dirname, "public");
const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(STATIC_DIR, filePath);

  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/join") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { name } = JSON.parse(body);
        const playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const player = createPlayer(playerId, name || `Player${playerId.slice(-4)}`);
        players.set(playerId, player);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, playerId, player }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid request" }));
      }
    });
    return;
  }

  if (url.pathname === "/api/queue") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ queued: queue.length }));
    return;
  }

  if (url.pathname === "/api/status" && url.searchParams.has("playerId")) {
    const playerId = url.searchParams.get("playerId");
    const player = players.get(playerId);

    if (!player) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Player not found" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      player,
      inQueue: queue.some((p) => p.id === playerId),
      inGame: player.gameId ? true : false,
      gameId: player.gameId,
      faction: player.faction,
    }));
    return;
  }

  if (url.pathname === "/api/rewards" && url.searchParams.has("playerId")) {
    const playerId = url.searchParams.get("playerId");
    const player = players.get(playerId);

    if (!player) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Player not found" }));
      return;
    }

    const pending = getPlayerRewardBalance(playerId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      playerId,
      pendingWoa: pending,
      gamesPlayed: player.gamesPlayed,
      wins: player.wins,
      losses: player.losses,
    }));
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    fs.readFile(path.join(STATIC_DIR, "pvp.html"), (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }

  serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  let playerId = null;
  let gameId = null;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === "join") {
        playerId = msg.playerId;
        const player = players.get(playerId);
        if (!player) {
          ws.send(JSON.stringify({ type: "error", message: "Player not found" }));
          return;
        }

        const existingInQueue = queue.find((p) => p.id === playerId);
        if (!existingInQueue && !player.gameId) {
          queue.push(player);
          console.log(`[QUEUE] ${player.name} joined (queue: ${queue.length})`);
        }

        ws.send(JSON.stringify({ type: "joined", inQueue: true }));
        return;
      }

      if (msg.type === "leave_queue") {
        const idx = queue.findIndex((p) => p.id === playerId);
        if (idx !== -1) {
          queue.splice(idx, 1);
          console.log(`[QUEUE] Player left (queue: ${queue.length})`);
        }
        ws.send(JSON.stringify({ type: "left_queue" }));
        return;
      }

      if (msg.type === "select_hero") {
        const player = players.get(playerId);
        if (!player || !player.gameId) return;

        const game = activeGames.get(player.gameId);
        if (!game || game.phase !== "hero_select") return;

        const faction = player.faction;
        if (!HERO_CLASSES.includes(msg.heroClass)) return;

        game.selectedHeroes[faction] = msg.heroClass;
        ws.send(JSON.stringify({ type: "hero_selected", heroClass: msg.heroClass }));
        return;
      }

      if (msg.type === "input") {
        const player = players.get(playerId);
        if (!player || !player.gameId) return;

        const game = activeGames.get(player.gameId);
        if (!game) return;

        processPlayerInput(game, player.faction, msg.input);
        return;
      }
    } catch (e) {
      console.error("WS message error:", e);
    }
  });

  ws.on("close", () => {
    if (playerId) {
      const idx = queue.findIndex((p) => p.id === playerId);
      if (idx !== -1) queue.splice(idx, 1);
    }
  });

  if (playerId) {
    const player = players.get(playerId);
    if (player && player.gameId) {
      gameId = player.gameId;
    }
  }
});

setInterval(() => {
  const match = findMatch();
  if (match) {
    const gameState = getPvPState(activeGames.get(match.gameId));
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "match_found", gameId: match.gameId, state: gameState }));
      }
    }
  }
}, 1000);

setInterval(() => {
  for (const [gameId, game] of activeGames) {
    if (game.mode !== "pvp") continue;

    if (game.phase === "hero_select") {
      game.heroSelectTimer++;

      const allSelected = game.selectedHeroes.alliance && game.selectedHeroes.horde;
      const playerSelected = game.selectedHeroes.alliance && game.isPractice;
      
      if (allSelected || (playerSelected && game.heroSelectTimer > 10) || game.heroSelectTimer >= game.maxHeroSelectTime) {
        if (!game.selectedHeroes.alliance) game.selectedHeroes.alliance = "WARRIOR";
        if (!game.selectedHeroes.horde) game.selectedHeroes.horde = "MAGE";
        initPvPGame(gameId);
      }
    }

    if (game.phase === "active") {
      applyPlayerInputs(game);
      processTick(game);

      const winner = resolvePvPWinner(game);
      if (winner) {
        endPvPGame(gameId, winner);
      }
    }
  }
}, Math.floor(1000 / TICK_RATE));

setInterval(() => {
  for (const [gameId, game] of activeGames) {
    if (game.mode !== "pvp") continue;
    if (game.phase !== "active" && game.phase !== "hero_select") continue;

    const payload = JSON.stringify({ type: "state", data: getPvPState(game) });
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }
}, Math.floor(1000 / BROADCAST_RATE));

server.listen(PORT, () => {
  console.log("World of Agents PvP Server running:");
  console.log(`  http://localhost:${PORT}`);
  console.log("  POST /api/join - Create player");
  console.log("  GET  /api/status?playerId=xxx - Get player status");
  console.log("  GET  /api/queue - Queue length");
  console.log(`  ws://localhost:${PORT}/ws`);
});
