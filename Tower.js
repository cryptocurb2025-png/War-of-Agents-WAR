/**
 * Tower Module - World of Agents Phase 3
 * Defensive structures that guard lanes
 */

const TOWER_BASE_HP = 400;
const TOWER_DAMAGE = 50;
const TOWER_ATTACK_COOLDOWN = 2; // ticks

export function createTower(faction, lane, position) {
  return {
    id: `tower_${faction}_${lane}_${position}`,
    faction,
    lane,
    position, // 1 = outer tower, 2 = inner tower
    hp: TOWER_BASE_HP,
    maxHp: TOWER_BASE_HP,
    damage: TOWER_DAMAGE,
    alive: true,
    attackCooldown: 0,
  };
}

export function createLaneTowers(lane) {
  return {
    alliance: [
      createTower("alliance", lane, 1), // outer
      createTower("alliance", lane, 2), // inner
    ],
    horde: [
      createTower("horde", lane, 1),
      createTower("horde", lane, 2),
    ],
  };
}

export function createAllTowers() {
  return {
    top: createLaneTowers("top"),
    mid: createLaneTowers("mid"),
    bot: createLaneTowers("bot"),
  };
}

export function isTowerAlive(tower) {
  return tower.alive && tower.hp > 0;
}

export function damageTower(tower, amount) {
  if (!tower.alive) return 0;
  
  const actualDamage = Math.min(tower.hp, amount);
  tower.hp -= actualDamage;
  
  if (tower.hp <= 0) {
    tower.hp = 0;
    tower.alive = false;
  }
  
  return actualDamage;
}

export function canTowerAttack(tower) {
  return tower.alive && tower.attackCooldown === 0;
}

export function towerAttack(tower, target) {
  if (!canTowerAttack(tower)) return null;
  
  tower.attackCooldown = TOWER_ATTACK_COOLDOWN;
  
  return {
    damage: tower.damage,
    target,
    tower,
  };
}

export function reduceTowerCooldown(tower) {
  if (tower.attackCooldown > 0) {
    tower.attackCooldown--;
  }
}

export function getActiveTower(towers, faction, frontline) {
  // Returns the tower that should be defending based on frontline position
  // Outer tower defends first, inner tower only after outer is destroyed
  
  const factionTowers = towers[faction];
  
  // Check if enemy is pushing toward this faction's base
  const isUnderAttack = (faction === "alliance" && frontline < -25) ||
                        (faction === "horde" && frontline > 25);
  
  if (!isUnderAttack) return null;
  
  // Return outer tower if alive, otherwise inner
  if (isTowerAlive(factionTowers[0])) {
    return factionTowers[0];
  } else if (isTowerAlive(factionTowers[1])) {
    return factionTowers[1];
  }
  
  return null;
}

export function getTowerStatus(tower) {
  return {
    id: tower.id,
    faction: tower.faction,
    lane: tower.lane,
    position: tower.position === 1 ? "Outer" : "Inner",
    hp: tower.hp,
    maxHp: tower.maxHp,
    alive: tower.alive,
  };
}

export function getAllTowerStatus(towers) {
  const status = [];
  
  for (const lane of Object.keys(towers)) {
    for (const faction of ["alliance", "horde"]) {
      for (const tower of towers[lane][faction]) {
        status.push(getTowerStatus(tower));
      }
    }
  }
  
  return status;
}
