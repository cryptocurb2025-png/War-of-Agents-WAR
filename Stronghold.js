/**
 * Stronghold Module - World of Agents Phase 3
 * Main base structures - destroy to win
 */

const STRONGHOLD_HP = 1000;
const STRONGHOLD_REGEN = 5; // HP per tick when not under attack
const STRONGHOLD_REGEN_DELAY = 10; // ticks without damage before regen starts

export function createStronghold(faction) {
  return {
    faction,
    hp: STRONGHOLD_HP,
    maxHp: STRONGHOLD_HP,
    alive: true,
    lastDamageTick: -999,
    underAttack: false,
  };
}

export function createStrongholds() {
  return {
    alliance: createStronghold("alliance"),
    horde: createStronghold("horde"),
  };
}

export function isStrongholdAlive(stronghold) {
  return stronghold.alive && stronghold.hp > 0;
}

export function damageStronghold(stronghold, amount, currentTick) {
  if (!stronghold.alive) return 0;
  
  const actualDamage = Math.min(stronghold.hp, amount);
  stronghold.hp -= actualDamage;
  stronghold.lastDamageTick = currentTick;
  stronghold.underAttack = true;
  
  if (stronghold.hp <= 0) {
    stronghold.hp = 0;
    stronghold.alive = false;
  }
  
  return actualDamage;
}

export function regenStronghold(stronghold, currentTick) {
  if (!stronghold.alive) return 0;
  if (stronghold.hp >= stronghold.maxHp) return 0;
  
  // Check if enough time has passed since last damage
  const ticksSinceDamage = currentTick - stronghold.lastDamageTick;
  
  if (ticksSinceDamage >= STRONGHOLD_REGEN_DELAY) {
    stronghold.underAttack = false;
    const regenAmount = Math.min(STRONGHOLD_REGEN, stronghold.maxHp - stronghold.hp);
    stronghold.hp += regenAmount;
    return regenAmount;
  }
  
  return 0;
}

export function canAttackStronghold(towers, faction, lane) {
  // Can only attack stronghold if all towers in at least one lane are destroyed
  const enemyFaction = faction === "alliance" ? "horde" : "alliance";
  
  // Check if both towers in this lane are destroyed
  const laneTowers = towers[lane][enemyFaction];
  return laneTowers.every(tower => !tower.alive);
}

export function getStrongholdStatus(stronghold) {
  const hpPercent = Math.round((stronghold.hp / stronghold.maxHp) * 100);
  
  let condition;
  if (hpPercent > 75) condition = "Fortified";
  else if (hpPercent > 50) condition = "Damaged";
  else if (hpPercent > 25) condition = "Critical";
  else if (hpPercent > 0) condition = "Falling";
  else condition = "Destroyed";
  
  return {
    faction: stronghold.faction,
    hp: stronghold.hp,
    maxHp: stronghold.maxHp,
    hpPercent,
    alive: stronghold.alive,
    underAttack: stronghold.underAttack,
    condition,
  };
}

export function checkVictory(strongholds) {
  if (!isStrongholdAlive(strongholds.alliance)) {
    return { winner: "horde", loser: "alliance" };
  }
  if (!isStrongholdAlive(strongholds.horde)) {
    return { winner: "alliance", loser: "horde" };
  }
  return null;
}
