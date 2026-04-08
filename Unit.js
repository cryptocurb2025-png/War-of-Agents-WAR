/**
 * Unit Module - World of Agents
 * Minimal lane creeps with simple positions.
 *
 * Positions are in lane-space: -100 (Alliance stronghold) to +100 (Horde stronghold).
 */

let nextUnitId = 1;

export const UNIT_TYPES = {
  FOOTMAN: { name: "Footman", maxHp: 50, damage: 6, speed: 4 },
  GRUNT: { name: "Grunt", maxHp: 50, damage: 6, speed: 4 },
  RIFLEMAN: { name: "Rifleman", maxHp: 35, damage: 5, speed: 4 },
  AXETHROWER: { name: "Axethrower", maxHp: 35, damage: 5, speed: 4 },
  OGRE: { name: "Ogre", maxHp: 88, damage: 13, speed: 3 },
  OGRE_LORD: { name: "Ogre Lord", maxHp: 150, damage: 25, speed: 2 },
  TROLL: { name: "Forest Troll", maxHp: 60, damage: 8, speed: 4 },
  TROLL_AXER: { name: "Troll Axer", maxHp: 45, damage: 12, speed: 4 },
  BATTLE_MAGE: { name: "Battle Mage", maxHp: 45, damage: 16, speed: 3 },
  PEASANT: { name: "Peasant", maxHp: 36, damage: 4, speed: 4 },
  DEATH_KNIGHT: { name: "Death Knight", maxHp: 90, damage: 12, speed: 3 },
  BALLISTA: { name: "Ballista", maxHp: 55, damage: 20, speed: 2 },
  KNIGHT: { name: "Knight", maxHp: 100, damage: 15, speed: 5 },
  ARCHER: { name: "Elven Archer", maxHp: 40, damage: 10, speed: 4 },
  WOLF_RIDER: { name: "Wolf Rider", maxHp: 55, damage: 9, speed: 6 },
  CATAPULT: { name: "Catapult", maxHp: 80, damage: 30, speed: 1 },
};

export function createUnit(type, faction) {
  const def = UNIT_TYPES[type];
  if (!def) throw new Error(`Unknown unit type: ${type}`);

  const from = faction === "alliance" ? -95 : 95;
  return {
    id: `u_${nextUnitId++}`,
    type,
    name: def.name,
    faction,
    hp: def.maxHp,
    maxHp: def.maxHp,
    damage: def.damage,
    speed: def.speed,
    pos: from,
    attackCd: 0,
  };
}

export function isUnitAlive(u) {
  return u.hp > 0;
}

export function stepUnitCooldown(u) {
  if (u.attackCd > 0) u.attackCd--;
}

export function dealDamageToUnit(u, dmg) {
  const actual = Math.min(u.hp, dmg);
  u.hp = Math.max(0, u.hp - dmg);
  return actual;
}

export function clampLanePos(pos) {
  return Math.max(-100, Math.min(100, pos));
}
