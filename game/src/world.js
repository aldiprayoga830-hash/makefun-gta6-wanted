// The rules and state of Port Meridian, with no drawing and no browser in it: the player on
// foot and in cars, traffic that follows the road network, pedestrians, the police and the
// wanted system, fists and the pistol, pickups, and Vex's chain of jobs. step() advances one
// fixed step given an input struct and returns what happened as bit flags, so the caller can
// react (sound, announcements) without the world knowing about screens.
import { CAR, COP, MISSION_PAY, PED, PICKUP, PLAYER, ROADS, VIEW, WANTED, WORLD } from './config.js';
import { createCity, inWater, onRoad } from './city.js';

export const EV_PICKUP = 1;
export const EV_CASH = 2;
export const EV_PUNCH = 4;
export const EV_SHOT = 8;
export const EV_DRY = 16;
export const EV_HURT = 32;
export const EV_CRIME = 64;
export const EV_WASTED = 128;
export const EV_BUSTED = 256;
export const EV_MISSION = 512;
export const EV_DIALOGUE = 1024;
export const EV_ENTER = 2048;
export const EV_CRASH = 4096;
export const EV_JOB = 8192;

const DIRS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
/** Road centres plus the two virtual intersections near the map edge where traffic turns. */
const ROUTE_CENTRES = [60, ...ROADS.centres, 2340];
const CAR_COLORS = ['#c94f42', '#4a7fc9', '#e0a83c', '#5db06a', '#b8bcc2', '#7a5fb0', '#d97fb8', '#4fb8b0'];
const PED_COLORS = ['#d95f4b', '#4b7fd9', '#e0c53c', '#5db06a', '#b06ac9', '#d98a4b', '#4bb8c9', '#c9c9c9'];

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

/** Turn `angle` toward `target` by at most `maxStep`; returns the new angle. */
function turnToward(angle, target, maxStep) {
  let diff = target - angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return angle + clamp(diff, -maxStep, maxStep);
}

function angleDiff(a, b) {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** The camera's top-left corner for a view centred on (x, y), clamped inside the world. */
export function cameraFor(x, y) {
  return {
    x: clamp(x - VIEW.width / 2, 0, WORLD.size - VIEW.width),
    y: clamp(y - VIEW.height / 2, 0, WORLD.size - VIEW.height),
  };
}

export function createWorld(random, save) {
  const city = createCity(random);
  const spots = city.spots;

  const player = {
    x: spots.spawn.x, y: spots.spawn.y, angle: Math.PI / 2, radius: PLAYER.radius,
    health: PLAYER.health, cash: 0, ammo: 0, car: null,
    punchT: 0, shootT: 0, hurtT: 0, bustT: 0, speedNow: 0, autopilot: false,
  };
  const state = {
    city, player, time: 0,
    cars: [], peds: [], cops: [], pickups: [], parts: [], floats: [],
    heat: 0, seenT: 99, spawnT: 0, pickupT: 3,
    mission: { stage: 'intro', hasPackage: false, job: null },
    dialogue: null, banner: null, gameOver: null, objective: '',
    vex: { x: spots.vex.x, y: spots.vex.y, angle: -Math.PI / 2 },
    stats: { crimes: 0 },
  };

  // ---------- collision helpers ----------

  function circleVsBuilding(x, y, r) {
    // Returns a push-out vector {x, y} or null. Buildings are AABBs.
    for (const b of city.buildings) {
      const cx = clamp(x, b.x, b.x + b.width);
      const cy = clamp(y, b.y, b.y + b.height);
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
        }
        // Centre inside the building: push out through the nearest face.
        const left = x - b.x;
        const right = b.x + b.width - x;
        const top = y - b.y;
        const bottom = b.y + b.height - y;
        const min = Math.min(left, right, top, bottom);
        if (min === left) return { x: b.x - r, y };
        if (min === right) return { x: b.x + b.width + r, y };
        if (min === top) return { x, y: b.y - r };
        return { x, y: b.y + b.height + r };
      }
    }
    return null;
  }

  function collideStatic(ent, r) {
    const pushed = circleVsBuilding(ent.x, ent.y, r);
    if (pushed) {
      ent.x = pushed.x;
      ent.y = pushed.y;
    }
    for (const prop of city.props) {
      if (prop.broken) continue;
      const d = dist(ent.x, ent.y, prop.x, prop.y);
      const min = r + prop.radius;
      if (d > 0.01 && d < min) {
        ent.x = prop.x + ((ent.x - prop.x) / d) * min;
        ent.y = prop.y + ((ent.y - prop.y) / d) * min;
      }
    }
    ent.x = clamp(ent.x, r, WORLD.size - r);
    ent.y = clamp(ent.y, r, WORLD.size - r);
    return pushed !== null;
  }

  function losClear(ax, ay, bx, by) {
    const steps = Math.ceil(dist(ax, ay, bx, by) / 22);
    for (let index = 1; index < steps; index += 1) {
      const t = index / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      for (const b of city.buildings) {
        if (x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height) return false;
      }
    }
    return true;
  }

  // ---------- spawning ----------

  function makeCar(x, y, angle, kind, color) {
    const car = {
      x, y, angle, speed: 0, radius: CAR.radius, kind,
      color: color ?? CAR_COLORS[Math.floor(random() * CAR_COLORS.length)],
      driver: kind === 'traffic' ? 'traffic' : kind === 'police' ? 'police' : 'none',
      dir: 0, wps: [], health: 100, stolen: false, target: false,
      stuckT: 0, reverseT: 0, ramT: 0, siren: random() * 6, dead: false,
    };
    state.cars.push(car);
    return car;
  }

  function lanePoint(ix, iy, dir, push) {
    const d = DIRS[dir];
    return { x: ix + d.x * push - d.y * ROADS.lane, y: iy + d.y * push + d.x * ROADS.lane };
  }

  function nextCentre(from, dirSign, axis) {
    // The next routing centre strictly beyond `from` along the axis in the sign's direction.
    let best = null;
    for (const c of ROUTE_CENTRES) {
      if (dirSign > 0 && c > from + 24 && (best === null || c < best)) best = c;
      if (dirSign < 0 && c < from - 24 && (best === null || c > best)) best = c;
    }
    return best;
  }

  function planRoute(car) {
    // From the car's position and heading, queue: the corner point at the next intersection,
    // then the cruise point past the intersection after it.
    const d = DIRS[car.dir];
    const along = d.x !== 0 ? car.x : car.y;
    const cross = d.x !== 0 ? car.y : car.x;
    const nc = nextCentre(along, d.x + d.y, d.x !== 0 ? 'x' : 'y');
    if (nc === null) {
      car.dir = (car.dir + 2) % 4;
      return;
    }
    // Snap the cross coordinate to the nearest real road centre for the intersection point.
    let crossRoad = ROADS.centres[0];
    for (const c of ROADS.centres) if (Math.abs(c - cross) < Math.abs(crossRoad - cross)) crossRoad = c;
    const ix = d.x !== 0 ? nc : crossRoad;
    const iy = d.x !== 0 ? crossRoad : nc;
    car.wps.push(lanePoint(ix, iy, car.dir, 40));
    car.turnAt = { x: ix, y: iy };
  }

  function chooseTurn(car) {
    const at = car.turnAt ?? { x: car.x, y: car.y };
    const options = [car.dir, (car.dir + 1) % 4, (car.dir + 3) % 4];
    let nd = options[0];
    const roll = random();
    if (roll > 0.55) nd = options[1 + Math.floor(random() * 2)];
    // At the virtual edge intersections the only way is a turn.
    const d = DIRS[nd];
    const ahead = nextCentre(d.x !== 0 ? at.x : at.y, d.x + d.y, 'a');
    if (ahead === null) nd = nd === options[1] ? options[2] : options[1];
    car.dir = nd;
    car.wps.push(lanePoint(at.x, at.y, nd, 46));
    const ndD = DIRS[nd];
    const nc = nextCentre(ndD.x !== 0 ? at.x : at.y, ndD.x + ndD.y, 'a');
    if (nc !== null) {
      const ix = ndD.x !== 0 ? nc : at.x;
      const iy = ndD.x !== 0 ? at.y : nc;
      car.wps.push(lanePoint(ix, iy, nd, 40));
      car.turnAt = { x: ix, y: iy };
    }
  }

  function spawnTraffic() {
    for (let tries = 0; tries < 12; tries += 1) {
      const vertical = random() < 0.5;
      const centre = ROADS.centres[Math.floor(random() * ROADS.centres.length)];
      const along = 80 + random() * (WORLD.size - 160);
      const dir = vertical ? (random() < 0.5 ? 1 : 3) : (random() < 0.5 ? 0 : 2);
      const d = DIRS[dir];
      const x = vertical ? centre - d.y * ROADS.lane : along;
      const y = vertical ? along : centre + d.x * ROADS.lane;
      if (dist(x, y, player.x, player.y) < 480) continue;
      let blocked = false;
      for (const other of state.cars) if (dist(x, y, other.x, other.y) < 80) blocked = true;
      if (blocked) continue;
      const car = makeCar(x, y, Math.atan2(d.y, d.x), 'traffic');
      car.dir = dir;
      planRoute(car);
      return;
    }
  }

  function spawnParked() {
    const lots = city.lots.filter((lot) => lot.kind === 'parking' || lot.kind === 'dock' || lot.kind === 'garage');
    for (let index = 0; index < 16; index += 1) {
      const lot = lots[Math.floor(random() * lots.length)];
      const x = lot.x + 30 + random() * (lot.width - 60);
      const y = lot.y + 30 + random() * (lot.height - 60);
      if (circleVsBuilding(x, y, CAR.radius)) continue;
      makeCar(x, y, random() < 0.5 ? 0 : Math.PI, 'parked');
    }
  }

  function spawnPed(x, y) {
    const ped = {
      x, y, angle: random() * Math.PI * 2, radius: PED.radius, kind: 'ped',
      color: PED_COLORS[Math.floor(random() * PED_COLORS.length)],
      health: PED.health, state: 'wander', tx: x, ty: y, fleeT: 0, downT: 0, thinkT: random() * 2,
    };
    state.peds.push(ped);
    return ped;
  }

  function spawnPeds() {
    for (let index = 0; index < 26; index += 1) {
      const bx = Math.floor(random() * 5);
      const by = Math.floor(random() * 4);
      const xr = [0, 265, 375, 765, 875, 1265, 1375, 1765, 1875, 2400][bx * 2];
      const xw = [0, 265, 375, 765, 875, 1265, 1375, 1765, 1875, 2400][bx * 2 + 1] - xr;
      const yr = [0, 265, 375, 765, 875, 1265, 1375, 1765, 1875, 2400][by * 2];
      const yh = [0, 265, 375, 765, 875, 1265, 1375, 1765, 1875, 2400][by * 2 + 1] - yr;
      const x = xr + 18 + random() * (xw - 36);
      const y = yr + 18 + random() * (yh - 36);
      if (!circleVsBuilding(x, y, PED.radius) && !inWater(x, y)) spawnPed(x, y);
    }
  }

  function roadPointNear(x, y, minD, maxD) {
    for (let tries = 0; tries < 14; tries += 1) {
      const a = random() * Math.PI * 2;
      const d = minD + random() * (maxD - minD);
      let px = clamp(x + Math.cos(a) * d, 40, WORLD.size - 40);
      let py = clamp(y + Math.sin(a) * d, 40, WORLD.size - 40);
      if (!onRoad(px, py)) {
        // Snap the nearer axis to a road centre.
        let bestC = ROADS.centres[0];
        for (const c of ROADS.centres) if (Math.abs(c - px) < Math.abs(bestC - px)) bestC = c;
        let bestR = ROADS.centres[0];
        for (const c of ROADS.centres) if (Math.abs(c - py) < Math.abs(bestR - py)) bestR = c;
        if (Math.abs(bestC - px) < Math.abs(bestR - py)) px = bestC;
        else py = bestR;
      }
      if (!inWater(px, py)) return { x: px, y: py };
    }
    return { x: ROADS.centres[1], y: ROADS.centres[1] };
  }

  function spawnCopCar() {
    const p = roadPointNear(player.x, player.y, 580, 760);
    const car = makeCar(p.x, p.y, angleTo(p.x, p.y, player.x, player.y), 'police', '#2b4bd8');
    car.driver = 'police';
  }

  function spawnCopFoot() {
    for (let tries = 0; tries < 10; tries += 1) {
      const a = random() * Math.PI * 2;
      const d = 430 + random() * 160;
      const x = clamp(player.x + Math.cos(a) * d, 20, WORLD.size - 20);
      const y = clamp(player.y + Math.sin(a) * d, 20, WORLD.size - 20);
      if (circleVsBuilding(x, y, COP.radius) || inWater(x, y)) continue;
      state.cops.push({
        x, y, angle: angleTo(x, y, player.x, player.y), radius: COP.radius, kind: 'cop',
        color: '#2b4bd8', health: COP.health, state: 'chase', shootT: 1 + random(), punchT: 0, downT: 0,
      });
      return;
    }
  }

  function addPickup(x, y, kind, amount) {
    state.pickups.push({ x, y, kind, amount, t: random() * 6, respawn: 0 });
  }

  function fixedPickups() {
    addPickup(spots.garage.x - 60, spots.garage.y - 30, 'ammo', PICKUP.ammo);
    addPickup(spots.dockEscape.x, spots.dockEscape.y - 90, 'ammo', PICKUP.ammo);
    addPickup(spots.package.x - 50, spots.package.y + 26, 'ammo', PICKUP.ammo);
    addPickup(spots.spawn.x - 66, spots.spawn.y + 60, 'health', PICKUP.health);
    addPickup(2137, 1085, 'health', PICKUP.health);
  }

  // ---------- crime and wanted ----------

  function witnesses(x, y) {
    let count = 0;
    for (const ped of state.peds) if (ped.state !== 'down' && dist(x, y, ped.x, ped.y) < WANTED.witness) count += 1;
    for (const cop of state.cops) if (cop.state !== 'down' && dist(x, y, cop.x, cop.y) < WANTED.witness + 90) count += 1;
    for (const car of state.cars) if (car.kind === 'police' && dist(x, y, car.x, car.y) < WANTED.witness + 90) count += 1;
    return count;
  }

  function commitCrime(amount, x, y, always) {
    const seen = always || witnesses(x, y) > 0;
    const add = seen ? amount : amount * 0.25;
    state.heat = clamp(state.heat + add, 0, WANTED.max + 0.99);
    state.stats.crimes += 1;
    if (seen) state.seenT = 0;
    return EV_CRIME;
  }

  function stars() {
    return Math.floor(clamp(state.heat, 0, WANTED.max));
  }

  // ---------- effects ----------

  function burst(x, y, color, count, speed) {
    for (let index = 0; index < count; index += 1) {
      const a = random() * Math.PI * 2;
      const v = speed * (0.3 + random() * 0.7);
      state.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.35 + random() * 0.3, color, size: 2 + random() * 3 });
    }
  }

  function floatText(x, y, text, color) {
    state.floats.push({ x, y, text, color, t: 0 });
  }

  function hurtPlayer(damage) {
    if (state.gameOver) return 0;
    player.health -= damage;
    player.hurtT = 0;
    burst(player.x, player.y, '#ff5a4e', 5, 90);
    if (player.health <= 0) {
      player.health = 0;
      state.gameOver = 'wasted';
      return EV_WASTED | EV_HURT;
    }
    return EV_HURT;
  }

  // ---------- missions ----------

  const DIALOGUES = {
    intro: [
      { who: 'Vex', text: 'You must be the new wheel in Port Meridian.' },
      { who: 'Vex', text: "Name's Vex. I fix problems. You look like a solution looking for work." },
      { who: 'You', text: 'What kind of work?' },
      { who: 'Vex', text: 'A gold coupe is sitting in the car park mid-town. Steal it, bring it to my garage. Clean and quick.' },
    ],
    m1done: [
      { who: 'Vex', text: 'Clean work. The client is happy, which makes me happy.' },
      { who: 'Vex', text: 'Next: a package walked out of Warehouse 7 down south. Fetch it and bring it back to me.' },
      { who: 'Vex', text: 'And friend — the warehouse crew will call it in. Expect company on the way back.' },
    ],
    m2done: [
      { who: 'Vex', text: 'You smell like trouble and money. Good combination.' },
      { who: 'Vex', text: 'Last job, and it is a loud one. The heat is already on you — three stars and counting.' },
      { who: 'Vex', text: 'Get to the end of the west pier at the docks. A boat does the rest. Move!' },
    ],
    m3done: [
      { who: 'Vex', text: 'You made it. The harbour swallows another story.' },
      { who: 'Vex', text: 'Port Meridian is yours now. There is always another package, if you want the work.' },
    ],
  };

  function startDialogue(key, after) {
    state.dialogue = { lines: DIALOGUES[key], index: 0, after };
    return EV_DIALOGUE;
  }

  function pay(amount, x, y) {
    player.cash += amount;
    floatText(x, y - 24, `+$${amount}`, '#8be26a');
  }

  function refreshObjective() {
    const m = state.mission;
    switch (m.stage) {
      case 'intro': state.objective = 'Meet Vex at the plaza (walk up and press E)'; break;
      case 'm1': state.objective = 'Steal the gold coupe from the mid-town car park'; break;
      case 'm1d': state.objective = "Deliver the coupe to Vex's garage"; break;
      case 'm2': state.objective = 'Pick up the package at Warehouse 7'; break;
      case 'm2r': state.objective = 'Bring the package back to Vex at the plaza'; break;
      case 'm3': state.objective = 'Reach the end of the west pier — lose the heat!'; break;
      case 'free':
        state.objective = m.job
          ? m.job.phase === 'pickup' ? 'Delivery job: pick up the package' : 'Delivery job: drop the package off'
          : 'Free roam — talk to Vex for delivery work';
        break;
      default: state.objective = '';
    }
  }

  function newJob() {
    const from = [
      { x: spots.package.x, y: spots.package.y },
      { x: 640, y: 1560 },
      { x: 1560, y: 640 },
      { x: 2137, y: 1085 },
    ][Math.floor(random() * 4)];
    state.mission.job = { phase: 'pickup', x: from.x, y: from.y, pay: 0 };
  }

  function missionMarker() {
    const m = state.mission;
    switch (m.stage) {
      case 'intro': return { x: state.vex.x, y: state.vex.y, kind: 'talk' };
      case 'm1': {
        const car = state.cars.find((c) => c.target);
        return car ? { x: car.x, y: car.y, kind: 'steal' } : null;
      }
      case 'm1d': return { x: spots.garage.x, y: spots.garage.y, kind: 'deliver' };
      case 'm2': return { x: spots.package.x, y: spots.package.y, kind: 'pickup' };
      case 'm2r': return { x: state.vex.x, y: state.vex.y, kind: 'talk' };
      case 'm3': return { x: spots.dockEscape.x, y: spots.dockEscape.y, kind: 'escape' };
      case 'free': return m.job ? { x: m.job.x, y: m.job.y, kind: m.job.phase } : { x: state.vex.x, y: state.vex.y, kind: 'talk' };
      default: return null;
    }
  }

  // ---------- car entry/exit ----------

  function enterCar(car) {
    let events = 0;
    if (car.driver === 'traffic') {
      // The driver bails out and runs.
      const ped = spawnPed(car.x + 20, car.y + 10);
      ped.state = 'flee';
      ped.fleeT = 3;
      ped.tx = ped.x + 120;
      ped.ty = ped.y;
    }
    car.driver = 'player';
    player.car = car;
    if (!car.stolen) {
      car.stolen = true;
      events |= commitCrime(1, car.x, car.y, true);
      floatText(car.x, car.y - 30, 'STOLEN', '#ffd23e');
    }
    if (car.target && state.mission.stage === 'm1') {
      state.mission.stage = 'm1d';
      refreshObjective();
    }
    return events | EV_ENTER;
  }

  function exitCar() {
    const car = player.car;
    if (!car) return;
    player.x = car.x + Math.cos(car.angle - Math.PI / 2) * 34;
    player.y = car.y + Math.sin(car.angle - Math.PI / 2) * 34;
    if (inWater(player.x, player.y) || circleVsBuilding(player.x, player.y, player.radius)) {
      player.x = car.x + Math.cos(car.angle + Math.PI / 2) * 34;
      player.y = car.y + Math.sin(car.angle + Math.PI / 2) * 34;
    }
    collideStatic(player, player.radius);
    car.driver = 'none';
    if (car.kind === 'traffic') car.kind = 'parked';
    car.speed = 0;
    player.car = null;
  }

  // ---------- combat ----------

  function meleeTarget() {
    const range = PLAYER.punchRange;
    let best = null;
    let bestD = range;
    const check = (ent) => {
      if (ent.state === 'down') return;
      const d = dist(player.x, player.y, ent.x, ent.y);
      if (d < bestD && Math.abs(angleDiff(angleTo(player.x, player.y, ent.x, ent.y), player.angle)) < 1.15) {
        best = ent;
        bestD = d;
      }
    };
    for (const ped of state.peds) check(ped);
    for (const cop of state.cops) check(cop);
    return best;
  }

  function doPunch() {
    let events = EV_PUNCH;
    const target = meleeTarget();
    burst(player.x + Math.cos(player.angle) * 22, player.y + Math.sin(player.angle) * 22, '#ffffff', 3, 60);
    if (target) {
      target.health -= PLAYER.punchDamage;
      target.x += Math.cos(player.angle) * 12;
      target.y += Math.sin(player.angle) * 12;
      collideStatic(target, target.radius);
      if (target.kind === 'cop') {
        events |= commitCrime(1, target.x, target.y, true);
        if (target.health <= 0 && target.state !== 'down') {
          target.state = 'down';
          target.downT = 25;
          events |= commitCrime(1.5, target.x, target.y, true);
        }
      } else {
        target.state = 'flee';
        target.fleeT = 3.5;
        events |= commitCrime(0.6, target.x, target.y, false);
        if (target.health <= 0 && target.state !== 'down') {
          target.state = 'down';
          target.downT = 25;
          events |= commitCrime(1, target.x, target.y, false);
        }
      }
      burst(target.x, target.y, '#ffd23e', 5, 80);
    }
    return events;
  }

  function doShoot() {
    if (player.ammo <= 0) return EV_DRY;
    player.ammo -= 1;
    let events = EV_SHOT;
    const range = 430;
    // Find the closest living target inside a narrow cone with clear line of sight.
    let target = null;
    let bestD = range;
    const consider = (ent) => {
      if (ent.state === 'down') return;
      const d = dist(player.x, player.y, ent.x, ent.y);
      if (d < bestD && Math.abs(angleDiff(angleTo(player.x, player.y, ent.x, ent.y), player.angle)) < 0.085
        && losClear(player.x, player.y, ent.x, ent.y)) {
        target = ent;
        bestD = d;
      }
    };
    for (const ped of state.peds) consider(ped);
    for (const cop of state.cops) consider(cop);
    const endX = player.x + Math.cos(player.angle) * (target ? bestD : range);
    const endY = player.y + Math.sin(player.angle) * (target ? bestD : range);
    state.parts.push({ x: player.x + Math.cos(player.angle) * 18, y: player.y + Math.sin(player.angle) * 18, vx: 0, vy: 0, t: 0, life: 0.06, color: '#ffe9a3', size: 7 });
    state.parts.push({ x: endX, y: endY, vx: 0, vy: 0, t: 0, life: 0.08, color: '#fff3c4', size: 4 });
    // Gunfire panics nearby pedestrians and is a crime when witnessed.
    for (const ped of state.peds) {
      if (ped.state !== 'down' && dist(player.x, player.y, ped.x, ped.y) < 260) {
        ped.state = 'flee';
        ped.fleeT = 3;
      }
    }
    events |= commitCrime(0.5, player.x, player.y, false);
    if (target) {
      target.health -= 55;
      burst(target.x, target.y, '#ff5a4e', 6, 90);
      if (target.kind === 'cop') {
        events |= commitCrime(0.8, target.x, target.y, true);
        if (target.health <= 0 && target.state !== 'down') {
          target.state = 'down';
          target.downT = 25;
          events |= commitCrime(1.2, target.x, target.y, true);
        }
      } else {
        if (target.health <= 0 && target.state !== 'down') {
          target.state = 'down';
          target.downT = 25;
          events |= commitCrime(1.2, target.x, target.y, false);
        } else {
          target.state = 'flee';
          target.fleeT = 4;
        }
      }
    }
    return events;
  }

  // ---------- per-entity updates ----------

  function driveTraffic(car, dt) {
    if (car.wps.length === 0) planRoute(car);
    const wp = car.wps[0];
    if (wp && dist(car.x, car.y, wp.x, wp.y) < 52) {
      car.wps.shift();
      if (car.wps.length === 0) chooseTurn(car);
      return;
    }
    if (!wp) return;
    const desired = angleTo(car.x, car.y, wp.x, wp.y);
    car.angle = turnToward(car.angle, desired, 1.9 * dt * clamp(Math.abs(car.speed) / 60 + 0.4, 0.4, 1.4));
    // Slow for anything close ahead.
    let target = CAR.trafficSpeed;
    const aheadX = car.x + Math.cos(car.angle) * 58;
    const aheadY = car.y + Math.sin(car.angle) * 58;
    for (const other of state.cars) {
      if (other !== car && dist(aheadX, aheadY, other.x, other.y) < 44) target = 0;
    }
    for (const ped of state.peds) if (ped.state !== 'down' && dist(aheadX, aheadY, ped.x, ped.y) < 34) target = 0;
    if (dist(aheadX, aheadY, player.x, player.y) < 36 && !player.car) target = 0;
    if (car.speed < target) car.speed = Math.min(target, car.speed + CAR.accel * 0.6 * dt);
    else car.speed = Math.max(target, car.speed - CAR.brake * dt);
    moveCar(car, dt);
  }

  function drivePolice(car, dt) {
    const target = player.car ?? player;
    const desired = angleTo(car.x, car.y, target.x, target.y);
    let steer = desired;
    // Obstacle probe: if a building or water is just ahead, veer to the clearer side.
    const probeD = 74;
    const px = car.x + Math.cos(car.angle) * probeD;
    const py = car.y + Math.sin(car.angle) * probeD;
    if (circleVsBuilding(px, py, 20) || inWater(px, py)) {
      const left = desired + 1.15;
      const right = desired - 1.15;
      const lx = car.x + Math.cos(left) * probeD;
      const ly = car.y + Math.sin(left) * probeD;
      steer = (!circleVsBuilding(lx, ly, 20) && !inWater(lx, ly)) ? left : right;
    }
    car.angle = turnToward(car.angle, steer, 2.4 * dt * clamp(Math.abs(car.speed) / 90 + 0.35, 0.35, 1.3));
    let target2 = CAR.policeSpeed;
    if (Math.abs(angleDiff(steer, car.angle)) > 1.2) target2 = 120;
    if (car.reverseT > 0) {
      car.reverseT -= dt;
      target2 = -90;
    } else if (Math.abs(car.speed) < 22) {
      car.stuckT += dt;
      if (car.stuckT > 1.1) {
        car.reverseT = 0.55;
        car.stuckT = 0;
      }
    } else car.stuckT = 0;
    if (car.speed < target2) car.speed = Math.min(target2, car.speed + CAR.accel * dt);
    else car.speed = Math.max(target2, car.speed - CAR.brake * dt);
    moveCar(car, dt);
    // Ramming the player's car is a crime scene of its own; ramming the player on foot hurts.
    if (!player.car && dist(car.x, car.y, player.x, player.y) < car.radius + player.radius + 2 && Math.abs(car.speed) > 70) {
      hurtPlayer(Math.abs(car.speed) / 16);
      player.x += Math.cos(car.angle) * 26;
      player.y += Math.sin(car.angle) * 26;
      collideStatic(player, player.radius);
      car.speed *= 0.4;
    }
  }

  function moveCar(car, dt) {
    const before = Math.abs(car.speed);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    // Water is a wall for cars.
    if (inWater(car.x, car.y)) {
      car.x -= Math.cos(car.angle) * car.speed * dt;
      car.y -= Math.sin(car.angle) * car.speed * dt;
      car.speed *= 0.3;
    }
    const hitBuilding = collideStatic(car, car.radius);
    if (hitBuilding && before > 40) {
      car.speed *= 0.42;
      if (car.driver === 'player' && before > 215) {
        hurtPlayer((before - 215) / 11);
        burst(car.x + Math.cos(car.angle) * 26, car.y + Math.sin(car.angle) * 26, '#ffd23e', 8, 120);
      }
      if (before > 120) burst(car.x, car.y, '#cccccc', 4, 70);
    }
    // Props: lamps snap, trees and crates stop the car.
    for (const prop of city.props) {
      if (prop.broken) continue;
      const d = dist(car.x, car.y, prop.x, prop.y);
      if (d < car.radius + prop.radius) {
        if (prop.kind === 'lamp') {
          prop.broken = true;
          car.speed *= 0.88;
        } else {
          const push = car.radius + prop.radius - d + 0.5;
          car.x += ((car.x - prop.x) / (d || 1)) * push;
          car.y += ((car.y - prop.y) / (d || 1)) * push;
          car.speed *= 0.45;
        }
      }
    }
  }

  function carCarCollisions(events) {
    const cars = state.cars;
    for (let i = 0; i < cars.length; i += 1) {
      for (let j = i + 1; j < cars.length; j += 1) {
        const a = cars[i];
        const b = cars[j];
        const d = dist(a.x, a.y, b.x, b.y);
        const min = a.radius + b.radius - 4;
        if (d > 0.01 && d < min) {
          const push = (min - d) / 2;
          const nx = (b.x - a.x) / d;
          const ny = (b.y - a.y) / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          const impact = Math.abs(a.speed) + Math.abs(b.speed);
          a.speed *= 0.55;
          b.speed *= 0.55;
          if (impact > 130) {
            burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffd23e', 6, 100);
            if (a.driver === 'player' || b.driver === 'player') {
              events |= EV_CRASH;
              const other = a.driver === 'player' ? b : a;
              if (other.kind === 'police') {
                const pc = a.driver === 'player' ? a : b;
                if (pc.ramT <= 0) {
                  events |= commitCrime(1, pc.x, pc.y, true);
                  pc.ramT = 2.5;
                  other.ramT = 2.5;
                }
              }
              if (impact > 300) events |= hurtPlayer((impact - 300) / 16);
            }
          }
        }
      }
    }
    return events;
  }

  function runOverCheck(car) {
    let events = 0;
    if (Math.abs(car.speed) < 85) return events;
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      if (dist(car.x, car.y, ped.x, ped.y) < car.radius + ped.radius - 2) {
        ped.state = 'down';
        ped.downT = 25;
        ped.health = 0;
        burst(ped.x, ped.y, '#a11f1f', 10, 110);
        if (car.driver === 'player') {
          events |= commitCrime(1.6, ped.x, ped.y, false) | EV_CRASH;
          floatText(ped.x, ped.y - 20, 'PEDESTRIAN DOWN', '#ff5a4e');
        }
        car.speed *= 0.82;
      }
    }
    return events;
  }

  function updatePed(ped, dt) {
    if (ped.state === 'down') {
      ped.downT -= dt;
      return;
    }
    let speed = PED.walkSpeed;
    if (ped.state === 'flee') {
      speed = PED.fleeSpeed;
      ped.fleeT -= dt;
      ped.tx = ped.x + (ped.x - player.x);
      ped.ty = ped.y + (ped.y - player.y);
      if (ped.fleeT <= 0) ped.state = 'wander';
    } else {
      ped.thinkT -= dt;
      if (ped.thinkT <= 0 || dist(ped.x, ped.y, ped.tx, ped.ty) < 14) {
        ped.thinkT = 2 + random() * 3;
        // Wander to another point in the same neighbourhood, on land.
        for (let tries = 0; tries < 6; tries += 1) {
          const tx = ped.x + (random() * 320 - 160);
          const ty = ped.y + (random() * 320 - 160);
          if (!inWater(tx, ty) && !circleVsBuilding(tx, ty, PED.radius)) {
            ped.tx = tx;
            ped.ty = ty;
            break;
          }
        }
      }
    }
    const desired = angleTo(ped.x, ped.y, ped.tx, ped.ty);
    ped.angle = turnToward(ped.angle, desired, 6 * dt);
    const nx = ped.x + Math.cos(ped.angle) * speed * dt;
    const ny = ped.y + Math.sin(ped.angle) * speed * dt;
    if (!inWater(nx, ny)) {
      ped.x = nx;
      ped.y = ny;
    } else {
      ped.angle += Math.PI / 2;
    }
    collideStatic(ped, ped.radius);
  }

  function updateCop(cop, dt) {
    if (cop.state === 'down') {
      cop.downT -= dt;
      return 0;
    }
    let events = 0;
    const target = player.car ?? player;
    const d = dist(cop.x, cop.y, target.x, target.y);
    if (stars() === 0) {
      // No heat: the officer stands down and walks away; the distance filter removes him.
      const away = angleTo(target.x, target.y, cop.x, cop.y);
      cop.angle = turnToward(cop.angle, away, 7 * dt);
      cop.x += Math.cos(cop.angle) * COP.walkSpeed * dt;
      cop.y += Math.sin(cop.angle) * COP.walkSpeed * dt;
      collideStatic(cop, cop.radius);
      return 0;
    }
    const desired = angleTo(cop.x, cop.y, target.x, target.y);
    cop.angle = turnToward(cop.angle, desired, 7 * dt);
    if (d > 26) {
      const nx = cop.x + Math.cos(cop.angle) * COP.walkSpeed * dt;
      const ny = cop.y + Math.sin(cop.angle) * COP.walkSpeed * dt;
      if (!inWater(nx, ny)) {
        cop.x = nx;
        cop.y = ny;
      }
      collideStatic(cop, cop.radius);
    }
    cop.punchT -= dt;
    cop.shootT -= dt;
    const playerSpeed = player.car ? Math.abs(player.car.speed) : player.speedNow;
    if (!state.gameOver && d < COP.punchRange + 14) {
      // The bust only closes on a player who is all but stopped: a car crawling in traffic,
      // turning at a corner or pinned for a moment still has a chance to pull away.
      if (playerSpeed < 14) {
        player.bustT += dt;
      } else if (cop.punchT <= 0 && !player.car) {
        cop.punchT = COP.punchCooldown;
        events |= hurtPlayer(COP.punchDamage);
      }
    }
    // Officers shoot at two stars and up, with line of sight.
    if (!state.gameOver && stars() >= 2 && cop.shootT <= 0 && d < COP.shootRange && d > 60 && losClear(cop.x, cop.y, target.x, target.y)) {
      cop.shootT = COP.shootCooldown * (0.75 + random() * 0.6);
      state.parts.push({ x: cop.x, y: cop.y, vx: 0, vy: 0, t: 0, life: 0.06, color: '#ffe9a3', size: 6 });
      events |= EV_SHOT;
      const hitChance = clamp(0.62 - d / 700, 0.18, 0.55);
      if (random() < hitChance) events |= hurtPlayer(COP.shootDamage);
    }
    return events;
  }

  // ---------- the step ----------

  function step(dt, input) {
    let events = 0;
    state.time += dt;

    // Dialogue freezes the world; any confirm press turns the page.
    if (state.dialogue) {
      if (input.confirm) {
        state.dialogue.index += 1;
        events |= EV_DIALOGUE;
        if (state.dialogue.index >= state.dialogue.lines.length) {
          const after = state.dialogue.after;
          state.dialogue = null;
          if (after) after();
          refreshObjective();
        }
      }
      return events;
    }
    if (state.gameOver) return events;

    if (state.banner) {
      state.banner.t -= dt;
      if (state.banner.t <= 0) state.banner = null;
    }

    // --- player ---
    player.punchT = Math.max(0, player.punchT - dt);
    player.shootT = Math.max(0, player.shootT - dt);
    player.hurtT += dt;
    if (player.hurtT > PLAYER.regenDelay && player.health > 0) {
      player.health = Math.min(PLAYER.health, player.health + PLAYER.regenRate * dt);
    }

    if (player.car) {
      const car = player.car;
      if (input.interact) {
        exitCar();
        events |= EV_ENTER;
      } else {
        if (player.autopilot) {
          car.driver = 'traffic';
          driveTraffic(car, dt);
          car.driver = 'player';
        } else {
          const throttle = -input.my;
          if (throttle > 0) car.speed += CAR.accel * throttle * dt * (car.speed < 0 ? 2.2 : 1);
          else if (throttle < 0) car.speed += (car.speed > 12 ? -CAR.brake : -CAR.accel * 0.62) * -throttle * dt;
          car.speed -= car.speed * CAR.drag * dt;
          car.speed = clamp(car.speed, -CAR.reverseMax, CAR.playerMax);
          if (Math.abs(car.speed) < 4 && throttle === 0) car.speed = 0;
          // Steering follows speed, with a floor so a slow car can still swing its nose
          // around a corner instead of crawling through the turn.
          let sf = clamp(car.speed / 110, -1, 1);
          if (sf !== 0 && Math.abs(sf) < 0.42) sf = 0.42 * Math.sign(sf);
          car.angle += input.mx * CAR.steer * sf * dt;
          moveCar(car, dt);
        }
        player.x = car.x;
        player.y = car.y;
        player.angle = car.angle;
        player.speedNow = Math.abs(car.speed);
        events |= runOverCheck(car);
      }
    } else {
      // On foot.
      const moving = input.mx !== 0 || input.my !== 0;
      if (input.aimX !== null && input.aimX !== undefined) {
        player.angle = angleTo(player.x, player.y, input.aimX, input.aimY);
      } else if (moving) {
        player.angle = Math.atan2(input.my, input.mx);
      }
      const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
      player.speedNow = moving ? speed : 0;
      const nx = player.x + input.mx * speed * dt;
      const ny = player.y + input.my * speed * dt;
      if (!inWater(nx, player.y)) player.x = nx;
      if (!inWater(player.x, ny)) player.y = ny;
      collideStatic(player, player.radius);

      if (input.interact) {
        // Near Vex?
        if (dist(player.x, player.y, state.vex.x, state.vex.y) < 62) {
          const stage = state.mission.stage;
          if (stage === 'intro') events |= startDialogue('intro', () => { state.mission.stage = 'm1'; });
          else if (stage === 'm2r' && state.mission.hasPackage) {
            events |= startDialogue('m2done', () => {
              state.mission.stage = 'm3';
              state.mission.hasPackage = false;
              state.heat = Math.max(state.heat, 3.2);
            });
            pay(MISSION_PAY.second, player.x, player.y);
            events |= EV_MISSION;
          } else if (stage === 'free' && !state.mission.job) {
            newJob();
            floatText(state.vex.x, state.vex.y - 30, 'NEW DELIVERY JOB', '#ffd23e');
            events |= EV_JOB;
            refreshObjective();
          }
        } else {
          // Enter the nearest car.
          let best = null;
          let bestD = 56;
          for (const car of state.cars) {
            if (car.driver === 'police' || car.driver === 'player') continue;
            const d = dist(player.x, player.y, car.x, car.y);
            if (d < bestD && Math.abs(car.speed) < 75) {
              best = car;
              bestD = d;
            }
          }
          if (best) events |= enterCar(best);
        }
      }
      if (input.punch && player.punchT <= 0) {
        player.punchT = PLAYER.punchCooldown;
        events |= doPunch();
      }
      if (input.shoot && player.shootT <= 0) {
        player.shootT = PLAYER.shootCooldown;
        events |= doShoot();
      }
    }

    // --- bust meter decay: it only holds while the player stays pinned; any real movement
    // (driving off, breaking away) shakes it off again. ---
    let copClose = false;
    for (const cop of state.cops) {
      if (cop.state !== 'down' && dist(cop.x, cop.y, player.x, player.y) < COP.punchRange + 14) copClose = true;
    }
    const playerSpeedNow = player.car ? Math.abs(player.car.speed) : player.speedNow;
    if (!copClose || playerSpeedNow >= 14) player.bustT = Math.max(0, player.bustT - dt * 1.6);
    if (player.bustT >= PLAYER.bustTime && !state.gameOver) {
      state.gameOver = 'busted';
      events |= EV_BUSTED;
    }

    // --- traffic and police ---
    let trafficCount = 0;
    for (const car of state.cars) {
      if (car.ramT > 0) car.ramT -= dt;
      if (car.driver === 'traffic') {
        trafficCount += 1;
        driveTraffic(car, dt);
        events |= runOverCheck(car);
      } else if (car.driver === 'police') {
        if (stars() === 0) {
          // No heat: the pursuit is called off — the car peels away into traffic and is
          // gone once it is out of the neighbourhood. It must never keep hunting.
          driveTraffic(car, dt);
          if (dist(car.x, car.y, player.x, player.y) > 420) car.dead = true;
        } else drivePolice(car, dt);
      }
    }
    if (trafficCount < 12 && random() < 0.06) spawnTraffic();
    state.cars = state.cars.filter((car) => !car.dead && dist(car.x, car.y, player.x, player.y) < 1500 || car.driver === 'player' || car.target);
    events |= carCarCollisions(events);

    for (const ped of state.peds) updatePed(ped, dt);
    state.peds = state.peds.filter((ped) => ped.state !== 'down' || ped.downT > 0);
    // Keep the sidewalks alive.
    if (state.peds.length < 22 && random() < 0.05) {
      const p = roadPointNear(player.x, player.y, 500, 800);
      if (!inWater(p.x, p.y)) spawnPed(p.x + 70, p.y + 40);
    }
    for (const cop of state.cops) events |= updateCop(cop, dt);
    state.cops = state.cops.filter((cop) => cop.state !== 'down' || cop.downT > 0);
    state.cops = state.cops.filter((cop) => stars() > 0 || dist(cop.x, cop.y, player.x, player.y) < 700);

    // --- wanted: sight, decay, spawning ---
    let seen = false;
    const sightCheck = (x, y) => dist(x, y, player.x, player.y) < WANTED.sight && losClear(x, y, player.x, player.y);
    for (const cop of state.cops) if (cop.state !== 'down' && sightCheck(cop.x, cop.y)) seen = true;
    for (const car of state.cars) if (car.kind === 'police' && sightCheck(car.x, car.y)) seen = true;
    if (seen) state.seenT = 0;
    else state.seenT += dt;
    const floorHeat = state.mission.stage === 'm3' ? 3 : 0;
    if (state.seenT > WANTED.evadeDelay && state.heat > floorHeat) {
      state.heat = Math.max(floorHeat, state.heat - WANTED.decay * dt);
    }
    const want = stars();
    state.spawnT -= dt;
    if (want > 0 && state.spawnT <= 0) {
      state.spawnT = 1.4;
      const copCars = state.cars.filter((c) => c.kind === 'police').length;
      const wantCars = [0, 1, 2, 3, 3, 4][want];
      const wantFoot = [0, 1, 2, 3, 4, 5][want];
      if (copCars < wantCars) spawnCopCar();
      else if (state.cops.length < wantFoot) spawnCopFoot();
    }
    if (want === 0) {
      state.cops = state.cops.filter((cop) => dist(cop.x, cop.y, player.x, player.y) < 500);
    }

    // --- pickups ---
    state.pickupT -= dt;
    if (state.pickupT <= 0) {
      state.pickupT = 6 + random() * 5;
      const cashCount = state.pickups.filter((p) => p.kind === 'cash').length;
      if (cashCount < 5) {
        const p = roadPointNear(player.x, player.y, 200, 850);
        addPickup(p.x + 66, p.y + 30, 'cash', PICKUP.cashMin + Math.floor(random() * (PICKUP.cashMax - PICKUP.cashMin)));
      }
    }
    for (const pickup of state.pickups) {
      pickup.t += dt;
      if (pickup.respawn > 0) {
        pickup.respawn -= dt;
        continue;
      }
      if (!player.car && dist(player.x, player.y, pickup.x, pickup.y) < PICKUP.radius + player.radius) {
        if (pickup.kind === 'cash') {
          pay(pickup.amount, player.x, player.y);
          pickup.respawn = 45;
          events |= EV_CASH;
        } else if (pickup.kind === 'ammo') {
          player.ammo += pickup.amount;
          floatText(player.x, player.y - 22, `+${pickup.amount} AMMO`, '#39c2ff');
          pickup.respawn = 25;
          events |= EV_PICKUP;
        } else if (pickup.kind === 'health' && player.health < PLAYER.health) {
          player.health = Math.min(PLAYER.health, player.health + pickup.amount);
          floatText(player.x, player.y - 22, `+${pickup.amount} HP`, '#57d977');
          pickup.respawn = 30;
          events |= EV_PICKUP;
        }
      }
    }

    // --- missions ---
    const m = state.mission;
    if (m.stage === 'm1' && player.car && player.car.target) {
      m.stage = 'm1d';
      refreshObjective();
    }
    if (m.stage === 'm1d' && player.car && player.car.target) {
      const z = spots.garageZone;
      if (player.car.x > z.x && player.car.x < z.x + z.width && player.car.y > z.y && player.car.y < z.y + z.height) {
        exitCar();
        player.car = null;
        const car = state.cars.find((c) => c.target);
        if (car) {
          car.target = false;
          car.kind = 'parked';
        }
        pay(MISSION_PAY.first, player.x, player.y);
        state.banner = { title: 'MISSION COMPLETE', sub: `The coupe is delivered. +$${MISSION_PAY.first}`, t: 3.6 };
        events |= EV_MISSION;
        events |= startDialogue('m1done', () => { state.mission.stage = 'm2'; });
      }
    }
    if (m.stage === 'm2' && !player.car && dist(player.x, player.y, spots.package.x, spots.package.y) < 30) {
      m.hasPackage = true;
      m.stage = 'm2r';
      state.heat = Math.max(state.heat, 2.2);
      state.seenT = 0;
      floatText(player.x, player.y - 26, 'PACKAGE PICKED UP — THE HEAT IS ON', '#ffd23e');
      events |= EV_MISSION;
      refreshObjective();
    }
    if (m.stage === 'm3') {
      const p = player.car ?? player;
      if (dist(p.x, p.y, spots.dockEscape.x, spots.dockEscape.y) < 52) {
        pay(MISSION_PAY.third, player.x, player.y);
        state.heat = 0;
        state.banner = { title: 'MISSION COMPLETE', sub: `You lost them at the harbour. +$${MISSION_PAY.third}`, t: 3.6 };
        events |= EV_MISSION;
        events |= startDialogue('m3done', () => {
          state.mission.stage = 'free';
          newJob();
        });
      }
    }
    if (m.stage === 'free' && m.job) {
      const job = m.job;
      if (!player.car && dist(player.x, player.y, job.x, job.y) < 30) {
        if (job.phase === 'pickup') {
          job.phase = 'dropoff';
          const dests = [
            { x: spots.garage.x, y: spots.garage.y },
            { x: 640, y: 640 },
            { x: 1560, y: 1560 },
            { x: spots.dockEscape.x, y: spots.dockEscape.y - 70 },
          ];
          const dest = dests[Math.floor(random() * dests.length)];
          job.pay = MISSION_PAY.jobBase + Math.floor(dist(job.x, job.y, dest.x, dest.y) / 12);
          job.x = dest.x;
          job.y = dest.y;
          floatText(player.x, player.y - 24, 'PACKAGE ON BOARD', '#ffd23e');
          events |= EV_JOB;
        } else {
          pay(job.pay, player.x, player.y);
          state.banner = { title: 'DELIVERY COMPLETE', sub: `Another happy customer. +$${job.pay}`, t: 3 };
          events |= EV_MISSION;
          newJob();
        }
        refreshObjective();
      }
    }

    // --- effects ---
    for (const part of state.parts) {
      part.t += dt;
      part.x += part.vx * dt;
      part.y += part.vy * dt;
    }
    state.parts = state.parts.filter((part) => part.t < part.life);
    for (const fl of state.floats) {
      fl.t += dt;
      fl.y -= 26 * dt;
    }
    state.floats = state.floats.filter((fl) => fl.t < 1.4);

    return events;
  }

  // ---------- reset / save ----------

  function reset(hard) {
    state.cars = [];
    state.peds = [];
    state.cops = [];
    state.pickups = [];
    state.parts = [];
    state.floats = [];
    state.heat = 0;
    state.seenT = 99;
    state.gameOver = null;
    state.dialogue = null;
    state.banner = null;
    player.health = PLAYER.health;
    player.car = null;
    player.bustT = 0;
    player.hurtT = 99;
    player.x = spots.spawn.x;
    player.y = spots.spawn.y;
    player.angle = Math.PI / 2;
    if (hard) {
      player.cash = 0;
      player.ammo = 0;
      state.mission.stage = 'intro';
      state.mission.hasPackage = false;
      state.mission.job = null;
    }
    if (state.mission.stage === 'm1d') state.mission.stage = 'm1';
    if (state.mission.stage === 'm2r') {
      state.mission.stage = 'm2';
      state.mission.hasPackage = false;
    }
    // The gold coupe for the first job.
    const coupe = makeCar(spots.targetCar.x, spots.targetCar.y, -Math.PI / 2, 'parked', '#e8b62a');
    coupe.target = state.mission.stage === 'm1' || state.mission.stage === 'intro';
    spawnParked();
    for (let index = 0; index < 9; index += 1) spawnTraffic();
    spawnPeds();
    fixedPickups();
    refreshObjective();
  }

  function saveData() {
    return {
      cash: player.cash, ammo: player.ammo,
      stage: state.mission.stage === 'm1d' ? 'm1' : state.mission.stage === 'm2r' ? 'm2' : state.mission.stage,
      x: Math.round(player.x), y: Math.round(player.y),
    };
  }

  // Build the opening scene.
  if (save && typeof save.cash === 'number') {
    player.cash = save.cash;
    player.ammo = save.ammo | 0;
    if (['m1', 'm2', 'm3', 'free'].includes(save.stage)) state.mission.stage = save.stage;
    reset(false);
    if (Number.isFinite(save.x) && Number.isFinite(save.y) && !inWater(save.x, save.y) && !circleVsBuilding(save.x, save.y, player.radius)) {
      player.x = save.x;
      player.y = save.y;
    }
    if (state.mission.stage === 'free') newJob();
  } else {
    reset(true);
  }
  refreshObjective();

  return {
    state,
    step,
    reset,
    saveData,
    stars,
    missionMarker,
    /** Test/autopilot hook used by the screenshot staging: the player's car drives itself. */
    setAutopilot(on) {
      player.autopilot = on;
    },
    /** Screenshot staging: raise the heat directly. */
    setHeat(value) {
      state.heat = value;
      state.seenT = 0;
    },
    /** Screenshot staging: put the player into the nearest stealable car. */
    enterNearestCar() {
      let best = null;
      let bestD = Infinity;
      for (const car of state.cars) {
        if (car.driver === 'police' || car.driver === 'player') continue;
        const d = dist(player.x, player.y, car.x, car.y);
        if (d < bestD) {
          best = car;
          bestD = d;
        }
      }
      if (best) enterCar(best);
      return best;
    },
  };
}
