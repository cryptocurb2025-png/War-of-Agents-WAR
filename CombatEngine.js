/**
 * CombatEngine Module - World of Agents Phase 3
 * Handles lane-based combat with towers and strongholds
 */

import {
  isAlive,
  spendMana,
  regenMana,
  earnGold,
  takeDamage,
  healAgent,
  getStatus,
  respawnAgent,
  addKill,
  addDeath,
} from "./Agent.js";
import {
  isAbilityReady,
  canAffordAbility,
  triggerCooldown,
  reduceAllCooldowns,
} from "./Ability.js";
import { updateFrontline, recomputeFrontlineFromUnits, getHeroInLane, LANE_NAMES } from "./Lane.js";
import { createUnit, isUnitAlive, stepUnitCooldown, dealDamageToUnit, clampLanePos } from "./Unit.js";
import {
  getActiveTower,
  damageTower,
  towerAttack,
  canTowerAttack,
  reduceTowerCooldown,
  isTowerAlive,
} from "./Tower.js";
import {
  damageStronghold,
  regenStronghold,
  canAttackStronghold,
  checkVictory,
} from "./Stronghold.js";
import { logEvent, advanceTick, setWinner } from "./GameState.js";

// Economy constants
const GOLD_PER_DAMAGE = 0.5;
const GOLD_ON_HERO_KILL = 50;
const GOLD_ON_TOWER_KILL = 100;
const GOLD_ON_VICTORY = 200;

// Respawn tracking
const RESPAWN_TIME = 5; // ticks
const deadHeroes = new Map(); // hero -> tick when they can respawn

// Minimal creep system
const CREEP_SPAWN_EVERY = 3; // ticks
const CREEP_MAX_PER_SIDE = 18; // per lane
const CREEP_ENGAGE_DIST = 6;
const CREEP_ATTACK_CD = 2;
const TOWER_POS = {
  alliance: { outer: -40, inner: -70 },
  horde: { outer: 40, inner: 70 },
};

function getLaneSpawnConfig(gameState, laneName) {
  const defaultConfig = {
    spawnEvery: CREEP_SPAWN_EVERY,
    maxPerSide: CREEP_MAX_PER_SIDE,
    allianceType: "FOOTMAN",
    hordeType: "GRUNT",
    burst: 1,
  };

  const cfg = gameState.spawnConfig?.[laneName];
  if (!gameState.spawnConfig) return defaultConfig;
  if (!cfg) {
    return {
      spawnEvery: Number.MAX_SAFE_INTEGER,
      maxPerSide: 0,
      allianceType: defaultConfig.allianceType,
      hordeType: defaultConfig.hordeType,
      burst: 0,
    };
  }

  return {
    spawnEvery: Number(cfg.spawnEvery || defaultConfig.spawnEvery),
    maxPerSide: Number(cfg.maxPerSide || defaultConfig.maxPerSide),
    allianceType: cfg.allianceType || defaultConfig.allianceType,
    hordeType: cfg.hordeType || defaultConfig.hordeType,
    burst: Number(cfg.burst || defaultConfig.burst),
  };
}

function awardGold(agent, damage, bonus = 0) {
  const damageGold = Math.floor(damage * GOLD_PER_DAMAGE);
  const total = damageGold + bonus;
  earnGold(agent, total);
  return total;
}

export function heroBasicAttack(attacker, defender, gameState) {
  const damage = takeDamage(defender, attacker.damage);
  const isKill = !isAlive(defender);
  const goldEarned = awardGold(attacker, damage, isKill ? GOLD_ON_HERO_KILL : 0);

  logEvent(gameState, "hero_attack", {
    attacker: attacker.name,
    defender: defender.name,
    damage,
    defenderHp: defender.hp,
    gold: goldEarned,
  });

  if (isKill) {
    addKill(attacker);
    addDeath(defender);
    deadHeroes.set(defender, gameState.tick + RESPAWN_TIME);
    logEvent(gameState, "hero_kill", {
      killer: attacker.name,
      victim: defender.name,
    });
  }

  return { damage, isKill, goldEarned };
}

export function heroUseAbility(attacker, defender, gameState, ability = null) {
  ability = ability || attacker.abilities[0];
  spendMana(attacker, ability.manaCost);
  triggerCooldown(ability);

  // Healing ability — heals self
  if (ability.type === "heal") {
    const healed = healAgent(attacker, ability.damage);
    logEvent(gameState, "ability_used", {
      attacker: attacker.name,
      ability: ability.name,
      type: "heal",
      healed,
      hp: attacker.hp,
    });
    return { healed, isKill: false, goldEarned: 0, abilityName: ability.name };
  }

  // Armor buff — apply to self
  if (ability.type === "armor_buff") {
    applyStatusEffect(attacker, { type: "armor_buff", value: ability.effectValue, duration: ability.duration, source: attacker.name });
    logEvent(gameState, "ability_used", {
      attacker: attacker.name,
      ability: ability.name,
      type: "armor_buff",
      duration: ability.duration,
    });
    return { damage: 0, isKill: false, goldEarned: 0, abilityName: ability.name };
  }

  // Stun — damage + apply stun to defender
  if (ability.type === "stun" && defender) {
    const damage = takeDamageWithArmor(defender, ability.damage);
    applyStatusEffect(defender, { type: "stun", value: 0, duration: ability.duration, source: attacker.name });
    const isKill = !isAlive(defender);
    const goldEarned = awardGold(attacker, damage, isKill ? GOLD_ON_HERO_KILL : 0);
    logEvent(gameState, "ability_used", {
      attacker: attacker.name, defender: defender.name,
      ability: ability.name, type: "stun", damage, defenderHp: defender.hp,
    });
    if (isKill) { addKill(attacker); addDeath(defender); deadHeroes.set(defender, gameState.tick + RESPAWN_TIME); logEvent(gameState, "hero_kill", { killer: attacker.name, victim: defender.name }); }
    return { damage, isKill, goldEarned, abilityName: ability.name };
  }

  // Slow — damage + apply slow to defender
  if (ability.type === "slow" && defender) {
    const damage = takeDamageWithArmor(defender, ability.damage);
    applyStatusEffect(defender, { type: "slow", value: ability.effectValue, duration: ability.duration, source: attacker.name });
    const isKill = !isAlive(defender);
    const goldEarned = awardGold(attacker, damage, isKill ? GOLD_ON_HERO_KILL : 0);
    logEvent(gameState, "ability_used", {
      attacker: attacker.name, defender: defender.name,
      ability: ability.name, type: "slow", damage, defenderHp: defender.hp,
    });
    if (isKill) { addKill(attacker); addDeath(defender); deadHeroes.set(defender, gameState.tick + RESPAWN_TIME); logEvent(gameState, "hero_kill", { killer: attacker.name, victim: defender.name }); }
    return { damage, isKill, goldEarned, abilityName: ability.name };
  }

  // DoT — initial damage + apply DoT to defender
  if (ability.type === "dot" && defender) {
    const damage = takeDamageWithArmor(defender, ability.damage);
    applyStatusEffect(defender, { type: "dot", value: ability.effectValue, duration: ability.duration, source: attacker.name });
    const isKill = !isAlive(defender);
    const goldEarned = awardGold(attacker, damage, isKill ? GOLD_ON_HERO_KILL : 0);
    logEvent(gameState, "ability_used", {
      attacker: attacker.name, defender: defender.name,
      ability: ability.name, type: "dot", damage, defenderHp: defender.hp,
    });
    if (isKill) { addKill(attacker); addDeath(defender); deadHeroes.set(defender, gameState.tick + RESPAWN_TIME); logEvent(gameState, "hero_kill", { killer: attacker.name, victim: defender.name }); }
    return { damage, isKill, goldEarned, abilityName: ability.name };
  }

  // AOE damage — damage defender + nearby enemy units
  if (ability.type === "aoe_damage") {
    let totalDamage = 0;
    let isKill = false;
    if (defender) {
      const damage = takeDamageWithArmor(defender, ability.damage);
      totalDamage += damage;
      isKill = !isAlive(defender);
      if (isKill) { addKill(attacker); addDeath(defender); deadHeroes.set(defender, gameState.tick + RESPAWN_TIME); logEvent(gameState, "hero_kill", { killer: attacker.name, victim: defender.name }); }
    }
    // AOE hits nearby creeps (handled via lane in processLaneCombat caller)
    const goldEarned = awardGold(attacker, totalDamage, isKill ? GOLD_ON_HERO_KILL : 0);
    logEvent(gameState, "ability_used", {
      attacker: attacker.name, defender: defender?.name || "area",
      ability: ability.name, type: "aoe_damage", damage: totalDamage,
    });
    return { damage: totalDamage, isKill, goldEarned, abilityName: ability.name };
  }

  // Default: plain damage ability
  if (!defender) return { damage: 0, isKill: false, goldEarned: 0, abilityName: ability.name };
  const damage = takeDamageWithArmor(defender, ability.damage);
  const isKill = !isAlive(defender);
  const goldEarned = awardGold(attacker, damage, isKill ? GOLD_ON_HERO_KILL : 0);

  logEvent(gameState, "ability_used", {
    attacker: attacker.name,
    defender: defender.name,
    ability: ability.name,
    type: "damage",
    damage,
    defenderHp: defender.hp,
    gold: goldEarned,
  });

  if (isKill) {
    addKill(attacker);
    addDeath(defender);
    deadHeroes.set(defender, gameState.tick + RESPAWN_TIME);
    logEvent(gameState, "hero_kill", {
      killer: attacker.name,
      victim: defender.name,
    });
  }

  return { damage, isKill, goldEarned, abilityName: ability.name };
}

export function canUseAbility(agent) {
  return agent.abilities.some((ab) => isAbilityReady(ab) && canAffordAbility(agent, ab));
}

export function heroAttackTower(hero, tower, gameState) {
  const damage = damageTower(tower, hero.damage);
  const isDestroyed = !isTowerAlive(tower);
  const goldEarned = awardGold(hero, damage, isDestroyed ? GOLD_ON_TOWER_KILL : 0);

  logEvent(gameState, "tower_attacked", {
    attacker: hero.name,
    tower: tower.id,
    damage,
    towerHp: tower.hp,
    destroyed: isDestroyed,
    gold: goldEarned,
  });

  if (isDestroyed) {
    logEvent(gameState, "tower_destroyed", {
      tower: tower.id,
      faction: tower.faction,
      lane: tower.lane,
      destroyer: hero.name,
    });
  }

  return { damage, isDestroyed, goldEarned };
}

export function heroAttackStronghold(hero, stronghold, gameState) {
  const damage = damageStronghold(stronghold, hero.damage, gameState.tick);
  const goldEarned = awardGold(hero, damage, 0);

  logEvent(gameState, "stronghold_attacked", {
    attacker: hero.name,
    faction: stronghold.faction,
    damage,
    strongholdHp: stronghold.hp,
  });

  return { damage, goldEarned };
}

export function towerAttackHero(tower, hero, gameState) {
  if (!canTowerAttack(tower)) return null;

  const wasAlive = isAlive(hero);
  const result = towerAttack(tower, hero);
  const damage = takeDamage(hero, result.damage);

  logEvent(gameState, "tower_attack", {
    tower: tower.id,
    target: hero.name,
    damage,
    targetHp: hero.hp,
  });

  // Register kill if tower finished the hero off
  if (wasAlive && !isAlive(hero)) {
    addDeath(hero);
    deadHeroes.set(hero, gameState.tick + RESPAWN_TIME);
    logEvent(gameState, "hero_kill", {
      killer: tower.id,
      victim: hero.name,
    });
  }

  return { damage, targetHp: hero.hp };
}

function getEnemyFaction(faction) {
  return faction === "alliance" ? "horde" : "alliance";
}

// --- Status effect processing ---

function applyStatusEffect(target, effect) {
  // Don't stack identical effects, refresh duration instead
  const existing = target.statusEffects.find((e) => e.type === effect.type && e.source === effect.source);
  if (existing) {
    existing.remaining = effect.duration;
    return;
  }
  target.statusEffects.push({
    type: effect.type,
    value: effect.value,
    remaining: effect.duration,
    source: effect.source,
  });
}

function processStatusEffects(hero, gameState) {
  if (!hero.statusEffects || !hero.statusEffects.length) return { stunned: false };

  let stunned = false;

  for (let i = hero.statusEffects.length - 1; i >= 0; i--) {
    const fx = hero.statusEffects[i];

    if (fx.type === "stun") {
      stunned = true;
    } else if (fx.type === "dot") {
      const dmg = takeDamage(hero, fx.value);
      logEvent(gameState, "dot_tick", { target: hero.name, damage: dmg, source: fx.source });
      if (!isAlive(hero)) {
        addDeath(hero);
        deadHeroes.set(hero, gameState.tick + RESPAWN_TIME);
        logEvent(gameState, "hero_kill", { killer: fx.source, victim: hero.name });
      }
    } else if (fx.type === "slow") {
      // Slow halves hero damage output this tick (applied in combat)
    } else if (fx.type === "armor_buff") {
      // Armor buff reduces incoming damage (checked in takeDamage wrapper)
    }

    fx.remaining--;
    if (fx.remaining <= 0) {
      hero.statusEffects.splice(i, 1);
    }
  }

  return { stunned };
}

function getEffectiveDamage(hero) {
  const slow = hero.statusEffects?.find((e) => e.type === "slow");
  return slow ? Math.floor(hero.damage * slow.value) : hero.damage;
}

function getArmorReduction(hero) {
  const armor = hero.statusEffects?.find((e) => e.type === "armor_buff");
  return armor ? armor.value : 0;
}

function takeDamageWithArmor(target, amount) {
  const reduction = getArmorReduction(target);
  const effective = Math.max(1, amount - reduction);
  return takeDamage(target, effective);
}

// --- AI ability selection ---

function selectBestAbility(hero, enemyHero, gameState) {
  const ready = hero.abilities.filter((ab) => isAbilityReady(ab) && canAffordAbility(hero, ab));
  if (!ready.length) return null;

  const hpPct = hero.hp / hero.maxHp;

  // Heal if low HP
  if (hpPct < 0.4) {
    const heal = ready.find((ab) => ab.type === "heal");
    if (heal) return heal;
  }

  // Stun if enemy hero present and alive
  if (enemyHero && isAlive(enemyHero)) {
    const stun = ready.find((ab) => ab.type === "stun");
    if (stun) return stun;
  }

  // Prefer AOE when lots of enemy units nearby
  const aoe = ready.find((ab) => ab.type === "aoe_damage");
  if (aoe) return aoe;

  // Prefer DoT/slow for sustained pressure
  const debuff = ready.find((ab) => ab.type === "dot" || ab.type === "slow");
  if (debuff && enemyHero && isAlive(enemyHero)) return debuff;

  // Armor buff if about to fight
  if (hpPct < 0.7) {
    const buff = ready.find((ab) => ab.type === "armor_buff");
    if (buff) return buff;
  }

  // Highest damage ability
  const dmg = ready.filter((ab) => ab.type === "damage").sort((a, b) => b.damage - a.damage);
  if (dmg.length) return dmg[0];

  // Fallback: first ready ability
  return ready[0];
}

function processLaneCombat(gameState, laneName) {
  const lane = gameState.lanes[laneName];
  const towers = gameState.towers[laneName];
  const spawnCfg = getLaneSpawnConfig(gameState, laneName);

  // 1) Spawn creeps
  if (gameState.tick % spawnCfg.spawnEvery === 0) {
    for (let n = 0; n < spawnCfg.burst; n++) {
      if (lane.units.alliance.length < spawnCfg.maxPerSide) {
        const type = Array.isArray(spawnCfg.allianceType) 
          ? spawnCfg.allianceType[Math.floor(Math.random() * spawnCfg.allianceType.length)]
          : spawnCfg.allianceType;
        lane.units.alliance.push(createUnit(type, "alliance"));
      }
      if (lane.units.horde.length < spawnCfg.maxPerSide) {
        const type = Array.isArray(spawnCfg.hordeType)
          ? spawnCfg.hordeType[Math.floor(Math.random() * spawnCfg.hordeType.length)]
          : spawnCfg.hordeType;
        lane.units.horde.push(createUnit(type, "horde"));
      }
    }
  }

  // 2) Step creep combat + movement
  stepCreeps(lane);

  // 3) Creeps damage towers if they reach them
  creepsAttackTowers(gameState, lane, towers);

  for (const faction of ["alliance", "horde"]) {
    const hero = getHeroInLane(lane, faction);
    if (!hero || !isAlive(hero)) continue;

    const enemyFaction = getEnemyFaction(faction);
    const enemyHero = getHeroInLane(lane, enemyFaction);

    // Process status effects (stun, DoT, slow, armor)
    const { stunned } = processStatusEffects(hero, gameState);
    if (!isAlive(hero)) continue;

    // Mana regen
    regenMana(hero);

    // Stunned heroes skip their action
    if (stunned) {
      reduceAllCooldowns(hero.abilities);
      continue;
    }

    // AI picks best ability for the situation
    const bestAbility = selectBestAbility(hero, enemyHero, gameState);

    if (enemyHero && isAlive(enemyHero)) {
      if (bestAbility) {
        heroUseAbility(hero, enemyHero, gameState, bestAbility);
        // AOE: also damage nearby enemy creeps
        if (bestAbility.type === "aoe_damage" && bestAbility.radius > 0) {
          const enemyUnits = lane.units[enemyFaction];
          const killed = [];
          for (const u of enemyUnits) {
            if (!isUnitAlive(u)) continue;
            dealDamageToUnit(u, Math.floor(bestAbility.damage * 0.5));
            if (!isUnitAlive(u)) killed.push(u);
          }
          if (killed.length) {
            earnGold(hero, killed.length * 3);
          }
        }
      } else {
        heroBasicAttack(hero, enemyHero, gameState);
      }
    } else {
      // No enemy hero, attack structures
      const enemyTower = getActiveTower(towers, enemyFaction, lane.frontline);

      if (enemyTower && isTowerAlive(enemyTower)) {
        heroAttackTower(hero, enemyTower, gameState);
      } else if (canAttackStronghold(gameState.towers, faction, laneName)) {
        heroAttackStronghold(hero, gameState.strongholds[enemyFaction], gameState);
      }
    }

    // Reduce all ability cooldowns
    reduceAllCooldowns(hero.abilities);
  }

  // Towers attack enemy heroes (only if enemy is pushing into tower range)
  for (const faction of ["alliance", "horde"]) {
    const enemyFaction = getEnemyFaction(faction);
    const enemyHero = getHeroInLane(lane, enemyFaction);

    if (!enemyHero || !isAlive(enemyHero)) continue;

    // Only attack if enemy has pushed toward this faction's base
    const towerCanAttack = (faction === "alliance" && lane.frontline < -50) ||
                           (faction === "horde" && lane.frontline > 50);
    
    if (!towerCanAttack) continue;

    for (const tower of towers[faction]) {
      if (isTowerAlive(tower)) {
        towerAttackHero(tower, enemyHero, gameState);
        reduceTowerCooldown(tower);
      }
    }
  }

  // Update frontline based on power
  recomputeFrontlineFromUnits(lane);
  updateFrontline(lane);
}

function stepCreeps(lane) {
  const a = lane.units.alliance;
  const h = lane.units.horde;

  // Cooldowns
  for (const u of a) stepUnitCooldown(u);
  for (const u of h) stepUnitCooldown(u);

  // Movement + combat: pair closest opposing units near the frontline.
  // We keep it O(n)ish by sorting by position occasionally.
  a.sort((x, y) => x.pos - y.pos);
  h.sort((x, y) => x.pos - y.pos);

  // Move units toward enemy
  for (const u of a) {
    if (!isUnitAlive(u)) continue;
    u.pos = clampLanePos(u.pos + u.speed);
  }
  for (const u of h) {
    if (!isUnitAlive(u)) continue;
    u.pos = clampLanePos(u.pos - u.speed);
  }

  // Resolve engagements where units overlap
  // Use two pointers to find close encounters.
  let i = 0;
  let j = 0;
  while (i < a.length && j < h.length) {
    const ua = a[i];
    const uh = h[j];
    if (!isUnitAlive(ua)) {
      i++;
      continue;
    }
    if (!isUnitAlive(uh)) {
      j++;
      continue;
    }

    const dist = Math.abs(ua.pos - uh.pos);
    if (dist <= CREEP_ENGAGE_DIST) {
      // Trade hits if CDs ready
      if (ua.attackCd === 0) {
        dealDamageToUnit(uh, ua.damage);
        ua.attackCd = CREEP_ATTACK_CD;
      }
      if (uh.attackCd === 0) {
        dealDamageToUnit(ua, uh.damage);
        uh.attackCd = CREEP_ATTACK_CD;
      }
      // Advance pointers to progress through the pack
      if (!isUnitAlive(ua)) i++;
      if (!isUnitAlive(uh)) j++;
      if (isUnitAlive(ua) && isUnitAlive(uh)) {
        // Slight nudge to avoid permanent overlap
        ua.pos = clampLanePos(ua.pos - 1);
        uh.pos = clampLanePos(uh.pos + 1);
        i++;
        j++;
      }
    } else {
      // If alliance unit is behind horde unit (shouldn't happen often), advance the lagging side.
      if (ua.pos < uh.pos) i++;
      else j++;
    }
  }

  // Cleanup dead units
  lane.units.alliance = a.filter(isUnitAlive);
  lane.units.horde = h.filter(isUnitAlive);
}

function creepsAttackTowers(gameState, lane, towers) {
  // Horde towers are at +40/+70, alliance at -40/-70.
  // If creeps cross into tower position, they chip it.
  const aFront = lane.units.alliance.length ? Math.max(...lane.units.alliance.map((u) => u.pos)) : -100;
  const hFront = lane.units.horde.length ? Math.min(...lane.units.horde.map((u) => u.pos)) : 100;

  // Alliance creeps attack Horde towers
  const hOuter = towers.horde[0];
  const hInner = towers.horde[1];
  if (hOuter.alive && aFront >= TOWER_POS.horde.outer) {
    const dmg = Math.max(1, Math.floor(lane.units.alliance.length * 2));
    const dealt = damageTower(hOuter, dmg);
    if (dealt > 0) {
      logEvent(gameState, "tower_attack", { tower: hOuter.id, target: hOuter.id, damage: dealt, targetHp: hOuter.hp });
      if (!hOuter.alive) logEvent(gameState, "tower_destroyed", { tower: hOuter.id, faction: hOuter.faction, lane: hOuter.lane, destroyer: "creeps" });
    }
  } else if (!hOuter.alive && hInner.alive && aFront >= TOWER_POS.horde.inner) {
    const dmg = Math.max(1, Math.floor(lane.units.alliance.length * 2));
    const dealt = damageTower(hInner, dmg);
    if (dealt > 0) {
      logEvent(gameState, "tower_attack", { tower: hInner.id, target: hInner.id, damage: dealt, targetHp: hInner.hp });
      if (!hInner.alive) logEvent(gameState, "tower_destroyed", { tower: hInner.id, faction: hInner.faction, lane: hInner.lane, destroyer: "creeps" });
    }
  }

  // Horde creeps attack Alliance towers
  const aOuter = towers.alliance[0];
  const aInner = towers.alliance[1];
  if (aOuter.alive && hFront <= TOWER_POS.alliance.outer) {
    const dmg = Math.max(1, Math.floor(lane.units.horde.length * 2));
    const dealt = damageTower(aOuter, dmg);
    if (dealt > 0) {
      logEvent(gameState, "tower_attack", { tower: aOuter.id, target: aOuter.id, damage: dealt, targetHp: aOuter.hp });
      if (!aOuter.alive) logEvent(gameState, "tower_destroyed", { tower: aOuter.id, faction: aOuter.faction, lane: aOuter.lane, destroyer: "creeps" });
    }
  } else if (!aOuter.alive && aInner.alive && hFront <= TOWER_POS.alliance.inner) {
    const dmg = Math.max(1, Math.floor(lane.units.horde.length * 2));
    const dealt = damageTower(aInner, dmg);
    if (dealt > 0) {
      logEvent(gameState, "tower_attack", { tower: aInner.id, target: aInner.id, damage: dealt, targetHp: aInner.hp });
      if (!aInner.alive) logEvent(gameState, "tower_destroyed", { tower: aInner.id, faction: aInner.faction, lane: aInner.lane, destroyer: "creeps" });
    }
  }
}

function processRespawns(gameState) {
  for (const [hero, respawnTick] of deadHeroes.entries()) {
    if (gameState.tick >= respawnTick) {
      respawnAgent(hero);
      deadHeroes.delete(hero);
      logEvent(gameState, "hero_respawn", {
        hero: hero.name,
        lane: hero.lane,
      });
    }
  }
}

export function processTick(gameState) {
  advanceTick(gameState);

  // Process respawns first
  processRespawns(gameState);

  // Process combat in each lane
  for (const laneName of LANE_NAMES) {
    processLaneCombat(gameState, laneName);
  }

  // Stronghold regeneration
  regenStronghold(gameState.strongholds.alliance, gameState.tick);
  regenStronghold(gameState.strongholds.horde, gameState.tick);

  // Check victory condition
  const victory = checkVictory(gameState.strongholds);
  if (victory) {
    setWinner(gameState, victory.winner);

    // Award victory gold
    for (const hero of gameState.heroes[victory.winner]) {
      earnGold(hero, GOLD_ON_VICTORY);
    }
  }

  return gameState;
}

// Legacy function for backward compatibility (1v1 simulation)
export function runMatch(agent1, agent2) {
  console.log("\n=== WORLD OF AGENTS - COMBAT SIMULATION ===\n");
  console.log("Combatants:");
  console.log(`  ${getStatus(agent1)}`);
  console.log(`  ${getStatus(agent2)}`);
  console.log("\n--- BATTLE BEGIN ---\n");

  let round = 1;

  while (isAlive(agent1) && isAlive(agent2)) {
    console.log(`Round ${round}:`);

    // Mana regen
    regenMana(agent1);
    regenMana(agent2);

    // Agent 1 turn
    const ab1 = agent1.abilities.find((ab) => isAbilityReady(ab) && canAffordAbility(agent1, ab));
    if (ab1) {
      spendMana(agent1, ab1.manaCost);
      triggerCooldown(ab1);
      const damage = takeDamage(agent2, ab1.damage);
      const gold = awardGold(agent1, damage, !isAlive(agent2) ? GOLD_ON_HERO_KILL : 0);
      console.log(`  ${agent1.name} casts "${ab1.name}" for ${damage} damage! ${agent2.name} HP: ${agent2.hp} (+${gold}g)`);
    } else {
      const damage = takeDamage(agent2, agent1.damage);
      const gold = awardGold(agent1, damage, !isAlive(agent2) ? GOLD_ON_HERO_KILL : 0);
      console.log(`  ${agent1.name} attacks for ${damage} damage. ${agent2.name} HP: ${agent2.hp} (+${gold}g)`);
    }
    reduceAllCooldowns(agent1.abilities);

    if (!isAlive(agent2)) break;

    // Agent 2 turn
    const ab2 = agent2.abilities.find((ab) => isAbilityReady(ab) && canAffordAbility(agent2, ab));
    if (ab2) {
      spendMana(agent2, ab2.manaCost);
      triggerCooldown(ab2);
      const damage = takeDamage(agent1, ab2.damage);
      const gold = awardGold(agent2, damage, !isAlive(agent1) ? GOLD_ON_HERO_KILL : 0);
      console.log(`  ${agent2.name} casts "${ab2.name}" for ${damage} damage! ${agent1.name} HP: ${agent1.hp} (+${gold}g)`);
    } else {
      const damage = takeDamage(agent1, agent2.damage);
      const gold = awardGold(agent2, damage, !isAlive(agent1) ? GOLD_ON_HERO_KILL : 0);
      console.log(`  ${agent2.name} attacks for ${damage} damage. ${agent1.name} HP: ${agent1.hp} (+${gold}g)`);
    }
    reduceAllCooldowns(agent2.abilities);

    console.log("");
    round++;

    if (round > 50) {
      console.log("Battle exceeded 50 rounds - ending in draw.");
      break;
    }
  }

  console.log("--- BATTLE END ---\n");

  let winner = null;
  if (!isAlive(agent2)) winner = agent1;
  else if (!isAlive(agent1)) winner = agent2;

  if (winner) {
    console.log(`Winner: ${winner.name} with ${winner.hp} HP remaining!`);
  } else {
    console.log("Result: Draw");
  }

  console.log("\n--- FINAL STATS ---");
  console.log(`  ${getStatus(agent1)}`);
  console.log(`  ${getStatus(agent2)}`);

  return { winner, rounds: round };
}
