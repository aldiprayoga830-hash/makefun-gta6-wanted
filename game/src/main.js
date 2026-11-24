// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The
// game moves between the title, play, paused, wasted and busted screens; the save (cash,
// story progress, position) is written to localStorage whenever it changes.
//
// ?seed=N fixes the city layout. ?shot=start|play|chase|end (with &seed=N) stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { CAR, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld, cameraFor,
  EV_BUSTED, EV_CASH, EV_CRASH, EV_DIALOGUE, EV_DRY, EV_ENTER, EV_HURT, EV_JOB, EV_MISSION, EV_PICKUP, EV_PUNCH, EV_SHOT, EV_WASTED,
} from './world.js';
import {
  ACTION_CONFIRM, ACTION_INTERACT, ACTION_NEW, ACTION_PAUSE, ACTION_PUNCH, ACTION_SHOOT, createInput,
} from './input.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_COMPLETE, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const audio = createAudio();

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

// A screenshot run must be the same game every time: no save is loaded for one.
const savedGame = shot ? null : readSave();
const world = createWorld(createRandom(seed), savedGame);
const renderer = createRenderer(canvas);

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world, scene.screen, { hasSave: false });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let hasSave = savedGame !== null;
  let accumulator = 0;
  let last = performance.now();
  let lastSavedJson = JSON.stringify(world.saveData());
  let saveCheckT = 0;
  let lastObjective = '';

  function announce(message) {
    status.textContent = message;
  }

  function persist() {
    const json = JSON.stringify(world.saveData());
    if (json !== lastSavedJson) {
      lastSavedJson = json;
      writeSave(world.saveData());
      hasSave = true;
    }
  }

  function startPlay(fresh) {
    if (fresh) {
      world.reset(true);
      lastSavedJson = '';
      persist();
    }
    screen = SCREEN_PLAY;
    audio.unlock();
    announce(fresh ? 'New game. Meet Vex at the plaza.' : 'Welcome back to Port Meridian.');
  }

  function backOnStreet() {
    world.reset(false);
    lastSavedJson = '';
    persist();
    screen = SCREEN_PLAY;
    announce('Back on the street.');
  }

  function playEvents(events) {
    if (events & EV_CASH) audio.cash();
    else if (events & EV_PICKUP) audio.pickup();
    if (events & EV_PUNCH) audio.punch();
    if (events & EV_SHOT) audio.shot();
    if (events & EV_DRY) audio.dry();
    if (events & EV_HURT) audio.hurt();
    if (events & EV_CRASH) audio.crash();
    if (events & EV_ENTER) audio.enter();
    if (events & EV_MISSION) audio.mission();
    else if (events & EV_JOB) audio.pickup();
    if (events & EV_DIALOGUE) audio.dialogue();
    if (events & EV_WASTED) audio.wasted();
    if (events & EV_BUSTED) audio.busted();
  }

  function aimPoint() {
    if (!input.mouse.seen || world.state.player.car) return { aimX: null, aimY: null };
    const view = renderer.view;
    const lx = (input.mouse.x * (window.devicePixelRatio || 1) - view.x) / view.scale;
    const ly = (input.mouse.y * (window.devicePixelRatio || 1) - view.y) / view.scale;
    const cam = cameraFor(world.state.player.x, world.state.player.y);
    return { aimX: cam.x + lx, aimY: cam.y + ly };
  }

  function stepOnce(actions) {
    const axes = input.axes();
    let { mx, my } = axes;
    if (mx !== 0 && my !== 0) {
      mx *= Math.SQRT1_2;
      my *= Math.SQRT1_2;
    }
    const aim = aimPoint();
    const events = world.step(STEP, {
      mx, my,
      run: axes.run,
      interact: (actions & ACTION_INTERACT) !== 0,
      punch: (actions & ACTION_PUNCH) !== 0,
      shoot: (actions & ACTION_SHOOT) !== 0,
      confirm: (actions & (ACTION_CONFIRM | ACTION_INTERACT)) !== 0,
      aimX: aim.aimX,
      aimY: aim.aimY,
    });
    playEvents(events);
    if (world.state.gameOver === 'wasted' && screen === SCREEN_PLAY) {
      screen = SCREEN_WASTED;
      announce('Wasted.');
    } else if (world.state.gameOver === 'busted' && screen === SCREEN_PLAY) {
      screen = SCREEN_BUSTED;
      announce('Busted.');
    }
    if (world.state.objective !== lastObjective) {
      lastObjective = world.state.objective;
      announce(lastObjective);
    }
    saveCheckT += STEP;
    if (saveCheckT > 0.5) {
      saveCheckT = 0;
      persist();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();

    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_NEW) startPlay(true);
      else if (actions & ACTION_CONFIRM) startPlay(!hasSave);
      // The city lives behind the title.
      while (accumulator >= STEP) {
        world.step(STEP, { mx: 0, my: 0, run: false, interact: false, punch: false, shoot: false, confirm: false, aimX: null, aimY: null });
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      accumulator = 0;
    } else if (screen === SCREEN_WASTED || screen === SCREEN_BUSTED) {
      if (actions & ACTION_CONFIRM) backOnStreet();
      accumulator = 0;
    } else {
      // Play. Pause wins over stepping; the rest of the presses go to the first step only.
      if ((actions & ACTION_PAUSE) && !world.state.dialogue) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
        accumulator = 0;
      } else {
        let first = true;
        while (accumulator >= STEP && screen === SCREEN_PLAY) {
          stepOnce(first ? actions : 0);
          first = false;
          accumulator -= STEP;
        }
      }
    }

    // Ambience: the engine note and the nearest siren.
    const state = world.state;
    let sirenDist = null;
    if (world.stars() > 0) {
      for (const car of state.cars) {
        if (car.kind !== 'police') continue;
        const d = Math.hypot(car.x - state.player.x, car.y - state.player.y);
        if (sirenDist === null || d < sirenDist) sirenDist = d;
      }
      for (const cop of state.cops) {
        if (cop.state === 'down') continue;
        const d = Math.hypot(cop.x - state.player.x, cop.y - state.player.y);
        if (sirenDist === null || d < sirenDist) sirenDist = d;
      }
    }
    audio.update(
      screen === SCREEN_PLAY && state.player.car ? Math.abs(state.player.car.speed) / CAR.playerMax : null,
      screen === SCREEN_PLAY ? sirenDist : null,
    );

    renderer.draw(world, screen, { hasSave });
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      persist();
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      }
    }
  });

  announce('Wanted: Port Meridian. Press Enter to play.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
