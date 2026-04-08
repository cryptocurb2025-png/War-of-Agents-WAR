/**
 * Lane Module - World of Agents Phase 3
 * Manages lane state, frontline position, and unit tracking
 */

export const LANE_NAMES = ["top", "mid", "bot"];

// Frontline: -100 (alliance base) to +100 (horde base), 0 = center
const FRONTLINE_MIN = -100;
const FRONTLINE_MAX = 100;
const FRONTLINE_SHIFT_PER_ADVANTAGE = 5;

export function createLane(name) {
  return {
    name,
    frontline: 0, // 0 = center, negative = pushed toward alliance, positive = toward horde
    units: {
      alliance: [],
      horde: [],
    },
    heroes: {
      alliance: null,
      horde: null,
    },
  };
}

export function createAllLanes() {
  return {
    top: createLane("top"),
    mid: createLane("mid"),
    bot: createLane("bot"),
  };
}

export function assignHeroToLane(lanes, hero, laneName, faction) {
  // Remove hero from current lane if assigned
  for (const lane of Object.values(lanes)) {
    if (lane.heroes[faction] === hero) {
      lane.heroes[faction] = null;
    }
  }
  
  // Assign to new lane
  if (lanes[laneName]) {
    lanes[laneName].heroes[faction] = hero;
    hero.lane = laneName;
  }
}

export function getHeroInLane(lane, faction) {
  return lane.heroes[faction];
}

export function getLanePower(lane, faction) {
  // Calculate total power in lane (units + hero)
  let power = 0;
  
  // Count units
  power += lane.units[faction].length * 10;
  
  // Add hero power if present and alive
  const hero = lane.heroes[faction];
  if (hero && hero.hp > 0) {
    power += 50 + (hero.level * 5);
  }
  
  return power;
}

export function updateFrontline(lane) {
  const alliancePower = getLanePower(lane, "alliance");
  const hordePower = getLanePower(lane, "horde");
  
  const powerDiff = hordePower - alliancePower;
  
  // Shift frontline based on power difference
  if (powerDiff > 20) {
    // Horde pushing
    lane.frontline = Math.min(FRONTLINE_MAX, lane.frontline + FRONTLINE_SHIFT_PER_ADVANTAGE);
  } else if (powerDiff < -20) {
    // Alliance pushing
    lane.frontline = Math.max(FRONTLINE_MIN, lane.frontline - FRONTLINE_SHIFT_PER_ADVANTAGE);
  }
  // If roughly equal, frontline doesn't move
  
  return lane.frontline;
}

export function recomputeFrontlineFromUnits(lane) {
  // If we have any units, estimate frontline as midpoint
  // between the most advanced units of each faction.
  const a = lane.units.alliance;
  const h = lane.units.horde;
  if (!a.length && !h.length) return lane.frontline;

  const aFront = a.length ? Math.max(...a.map((u) => u.pos)) : FRONTLINE_MIN;
  const hFront = h.length ? Math.min(...h.map((u) => u.pos)) : FRONTLINE_MAX;
  const mid = (aFront + hFront) / 2;
  lane.frontline = Math.max(FRONTLINE_MIN, Math.min(FRONTLINE_MAX, Math.round(mid)));
  return lane.frontline;
}

export function getFrontlineStatus(frontline) {
  if (frontline <= -75) return "Alliance pushing hard";
  if (frontline <= -25) return "Alliance advantage";
  if (frontline < 25) return "Contested";
  if (frontline < 75) return "Horde advantage";
  return "Horde pushing hard";
}

export function getLaneStatus(lane) {
  const alliancePower = getLanePower(lane, "alliance");
  const hordePower = getLanePower(lane, "horde");
  
  return {
    name: lane.name.toUpperCase(),
    frontline: lane.frontline,
    status: getFrontlineStatus(lane.frontline),
    alliance: {
      power: alliancePower,
      units: lane.units.alliance.length,
      hero: lane.heroes.alliance?.name || null,
    },
    horde: {
      power: hordePower,
      units: lane.units.horde.length,
      hero: lane.heroes.horde?.name || null,
    },
  };
}
