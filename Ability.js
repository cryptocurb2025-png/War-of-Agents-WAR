/**
 * Ability Module - World of Agents Phase 3
 * Handles ability definitions with mana costs, cooldowns, and status effects
 *
 * Ability types: damage, heal, stun, slow, dot, armor_buff, aoe_damage
 */

export function createAbility(name, damage, manaCost, cooldown, type = "damage", opts = {}) {
  return {
    name,
    damage,
    manaCost,
    cooldown,
    currentCooldown: 0,
    type,
    duration: opts.duration || 0,
    effectValue: opts.effectValue || 0,
    radius: opts.radius || 0,
  };
}

export function isAbilityReady(ability) {
  return ability.currentCooldown === 0;
}

export function canAffordAbility(agent, ability) {
  return agent.mana >= ability.manaCost;
}

export function triggerCooldown(ability) {
  ability.currentCooldown = ability.cooldown;
}

export function reduceCooldown(ability) {
  if (ability.currentCooldown > 0) {
    ability.currentCooldown--;
  }
}

export function reduceAllCooldowns(abilities) {
  for (const ab of abilities) reduceCooldown(ab);
}

// Preset abilities for classes
export const ABILITIES = {
  // Warrior abilities
  SHIELD_SLAM: () => createAbility("Shield Slam", 20, 25, 3),
  THUNDER_CLAP: () => createAbility("Thunder Clap", 15, 30, 4, "aoe_damage", { radius: 3 }),
  BATTLE_SHOUT: () => createAbility("Battle Shout", 0, 20, 5, "armor_buff", { duration: 3, effectValue: 10 }),

  // Mage abilities
  FIREBALL: () => createAbility("Fireball", 35, 30, 2),
  BLIZZARD: () => createAbility("Blizzard", 18, 40, 4, "aoe_damage", { radius: 4, duration: 2, effectValue: 8 }),
  FROST_BOLT: () => createAbility("Frost Bolt", 25, 25, 3, "slow", { duration: 3, effectValue: 0.5 }),

  // Ranger abilities
  MULTI_SHOT: () => createAbility("Multi-Shot", 28, 20, 2),
  POISON_ARROW: () => createAbility("Poison Arrow", 20, 15, 2, "dot", { duration: 3, effectValue: 8 }),

  // Healer abilities — "damage" field is the heal amount for heal type
  HOLY_LIGHT: () => createAbility("Holy Light", 50, 35, 3, "heal"),
  CHAIN_HEAL: () => createAbility("Chain Heal", 35, 40, 4, "heal"),
  WAR_STOMP: () => createAbility("War Stomp", 10, 35, 5, "stun", { duration: 2 }),
};
