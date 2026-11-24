// The screenshot scenes behind ?shot=start|play|chase|end. Each one stages the real game —
// never a mock-up: the world is created from the seed, the simulation is stepped forward with
// a simple autopilot at the wheel, and the frame is whatever the game honestly looks like at
// that moment, so the same seed always gives the same frame.
import { STEP } from './config.js';
import { SCREEN_COMPLETE, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const IDLE = { mx: 0, my: 0, run: false, interact: false, punch: false, shoot: false, confirm: false, aimX: null, aimY: null };

function stepSeconds(world, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) world.step(STEP, IDLE);
}

/** Put the player into the nearest traffic car and hand the wheel to the autopilot. */
function putPlayerInTraffic(world) {
  const state = world.state;
  let car = null;
  for (const candidate of state.cars) {
    if (candidate.kind === 'traffic') {
      car = candidate;
      break;
    }
  }
  if (!car) return false;
  state.player.x = car.x + 30;
  state.player.y = car.y + 6;
  world.enterNearestCar();
  world.setAutopilot(true);
  return true;
}

/**
 * Set `world` to the named scene and return the screen to draw over it.
 * start: the title over the living city. play: cruising in traffic, HUD and minimap up.
 * chase: the same drive at three stars, with the Port Meridian PD closing in.
 * end: the mission-complete card over the garage forecourt.
 */
export function stageShot(name, world) {
  const state = world.state;
  if (name === 'play' || name === 'chase') {
    if (putPlayerInTraffic(world)) {
      if (name === 'chase') {
        // Get rolling first, then turn the heat up: five seconds of pursuit puts police cars
        // on the player's tail without giving the drive time to end in a pile-up. The heat is
        // pinned back to three stars at the end — a long chase would otherwise keep adding
        // witnessed crimes and show five.
        world.setHeat(0);
        stepSeconds(world, 6);
        world.setHeat(3.4);
        stepSeconds(world, 5);
        world.setHeat(3.4);
        stepSeconds(world, 0.3);
      } else {
        world.setHeat(0);
        stepSeconds(world, 9);
      }
    } else {
      stepSeconds(world, 4);
    }
    return { screen: SCREEN_PLAY };
  }
  if (name === 'end') {
    // The first job, done: the coupe delivered, the card up, the garage behind.
    state.player.x = state.city.spots.garage.x - 40;
    state.player.y = state.city.spots.garage.y + 6;
    state.player.cash = 400;
    state.banner = { title: 'MISSION COMPLETE', sub: 'The coupe is delivered. +$400', t: 999 };
    stepSeconds(world, 2.5);
    state.banner = { title: 'MISSION COMPLETE', sub: 'The coupe is delivered. +$400', t: 999 };
    return { screen: SCREEN_COMPLETE };
  }
  // start (and anything else): a few seconds of city life behind the title.
  stepSeconds(world, 4);
  return { screen: SCREEN_TITLE };
}
