/**
 * Agent Module - World of Agents Phase 3
 * Handles agent creation with classes, mana, gold, and lane assignment
 */

import { ABILITIES } from "./Ability.js";

// Class templates with WoW fantasy theme
export const CLASSES = {
  WARRIOR: {
    name: "Warrior",
    baseHp: 120,
    baseMana: 60,
    baseDamage: 15,
    manaRegen: 8,
    abilities: [ABILITIES.SHIELD_SLAM, ABILITIES.THUNDER_CLAP, ABILITIES.BATTLE_SHOUT],
  },
  MAGE: {
    name: "Mage",
    baseHp: 75,
    baseMana: 100,
    baseDamage: 8,
    manaRegen: 12,
    abilities: [ABILITIES.FIREBALL, ABILITIES.BLIZZARD, ABILITIES.FROST_BOLT],
  },
  RANGER: {
    name: "Ranger",
    baseHp: 90,
    baseMana: 50,
    baseDamage: 18,
    manaRegen: 6,
    abilities: [ABILITIES.MULTI_SHOT, ABILITIES.POISON_ARROW],
  },
  HEALER: {
    name: "Healer",
    baseHp: 70,
    baseMana: 120,
    baseDamage: 6,
    manaRegen: 15,
    abilities: [ABILITIES.HOLY_LIGHT, ABILITIES.CHAIN_HEAL, ABILITIES.WAR_STOMP],
  },
};

export function createAgent(name, classType, faction = null, lane = "mid") {
  const template = CLASSES[classType];
  if (!template) {
    throw new Error(`Unknown class: ${classType}`);
  }

  const abilities = template.abilities.map((fn) => fn());

  return {
    name,
    class: template.name,
    faction,
    lane,
    hp: template.baseHp,
    maxHp: template.baseHp,
    mana: template.baseMana,
    maxMana: template.baseMana,
    manaRegen: template.manaRegen,
    damage: template.baseDamage,
    abilities,
    // Backward compat: legacy code can still read agent.ability
    get ability() { return this.abilities[0]; },
    statusEffects: [],
    gold: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    level: 1,
    xp: 0,
  };
}

export function isAlive(agent) {
  return agent.hp > 0;
}

export function spendMana(agent, amount) {
  agent.mana = Math.max(0, agent.mana - amount);
}

export function regenMana(agent) {
  agent.mana = Math.min(agent.maxMana, agent.mana + agent.manaRegen);
}

export function earnGold(agent, amount) {
  agent.gold += amount;
}

export function takeDamage(agent, amount) {
  const actualDamage = Math.min(agent.hp, amount);
  agent.hp = Math.max(0, agent.hp - amount);
  return actualDamage;
}

export function healAgent(agent, amount) {
  const actualHeal = Math.min(agent.maxHp - agent.hp, amount);
  agent.hp += actualHeal;
  return actualHeal;
}

export function addKill(agent) {
  agent.kills++;
}

export function addDeath(agent) {
  agent.deaths++;
}

export function addAssist(agent) {
  agent.assists++;
}

export function addXp(agent, amount) {
  agent.xp += amount;
  
  // Check for level up
  const xpNeeded = agent.level * 200;
  if (agent.xp >= xpNeeded) {
    agent.xp -= xpNeeded;
    agent.level++;
    
    // Level up bonuses
    agent.maxHp = Math.floor(agent.maxHp * 1.05);
    agent.hp = Math.min(agent.hp + 20, agent.maxHp);
    agent.damage = Math.floor(agent.damage * 1.03);
    agent.maxMana += 10;
    
    return true; // Leveled up
  }
  return false;
}

export function respawnAgent(agent) {
  agent.hp = agent.maxHp;
  agent.mana = agent.maxMana;
  agent.statusEffects = [];
  for (const ab of agent.abilities) ab.currentCooldown = 0;
}

export function getStatus(agent) {
  const laneInfo = agent.lane ? ` @ ${agent.lane}` : "";
  const factionInfo = agent.faction ? `[${agent.faction}] ` : "";
  return `${factionInfo}${agent.name} [${agent.class}]${laneInfo} | HP: ${agent.hp}/${agent.maxHp} | Mana: ${agent.mana}/${agent.maxMana} | Gold: ${agent.gold}`;
}

export function getKDA(agent) {
  return `${agent.kills}/${agent.deaths}/${agent.assists}`;
}
