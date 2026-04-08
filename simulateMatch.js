/**
 * World of Agents - Phase 3
 * Multi-lane MOBA simulation with towers and strongholds
 */

import { createAgent } from "./Agent.js";
import { createGameState, addHeroToGame, moveHeroToLane, printGameStatus } from "./GameState.js";
import { processTick } from "./CombatEngine.js";
import { checkVictory } from "./Stronghold.js";

// Create game state
const gameState = createGameState();

// Create heroes for Alliance
const warrior = createAgent("Theron the Ironclad", "WARRIOR");
const mage = createAgent("Seraphina the Arcane", "MAGE");

// Create heroes for Horde
const ranger = createAgent("Grommak the Hunter", "RANGER");
const healer = createAgent("Zul'jin the Wise", "HEALER");

// Add heroes to game
addHeroToGame(gameState, warrior, "alliance", "top");
addHeroToGame(gameState, mage, "alliance", "mid");
addHeroToGame(gameState, ranger, "horde", "mid");
addHeroToGame(gameState, healer, "horde", "bot");

console.log("\n╔════════════════════════════════════════════════════════════╗");
console.log("║         WORLD OF AGENTS - MULTI-LANE SIMULATION            ║");
console.log("╚════════════════════════════════════════════════════════════╝");

// Initial state
printGameStatus(gameState);

// Simulation settings
const MAX_TICKS = 100;
const PRINT_INTERVAL = 20;

console.log(`\nSimulating ${MAX_TICKS} ticks...\n`);

// Main game loop
while (gameState.tick < MAX_TICKS && !gameState.winner) {
  processTick(gameState);
  
  // Periodically print status
  if (gameState.tick % PRINT_INTERVAL === 0) {
    printGameStatus(gameState);
  }
  
  // Simple AI: randomly move heroes occasionally
  if (gameState.tick % 15 === 0) {
    const lanes = ["top", "mid", "bot"];
    
    // Move warrior to a random lane
    const randomLane = lanes[Math.floor(Math.random() * lanes.length)];
    if (warrior.hp > 0 && warrior.lane !== randomLane) {
      moveHeroToLane(gameState, warrior, randomLane);
      console.log(`  >> ${warrior.name} rotates to ${randomLane.toUpperCase()}`);
    }
    
    // Move ranger to contest warrior
    if (ranger.hp > 0 && ranger.lane !== warrior.lane) {
      moveHeroToLane(gameState, ranger, warrior.lane);
      console.log(`  >> ${ranger.name} rotates to ${warrior.lane.toUpperCase()} to contest`);
    }
  }
}

// Final state
console.log("\n" + "=".repeat(60));
console.log("FINAL GAME STATE");
printGameStatus(gameState);

// Print event log summary
console.log("\nKEY EVENTS:");
const importantEvents = gameState.events.filter(e => 
  ["hero_joined", "tower_destroyed", "hero_kill", "hero_respawn", "game_over"].includes(e.type)
);
for (const event of importantEvents.slice(-20)) {
  console.log(`  [Tick ${event.tick}] ${event.type}: ${JSON.stringify(event)}`);
}
