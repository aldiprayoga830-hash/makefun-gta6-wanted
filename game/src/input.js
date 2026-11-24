// Keyboard and pointer input. Held keys give the movement axes; one-shot presses (interact,
// punch, shoot, pause, confirm) are queued as bit flags and taken once by the loop, so a press
// between two frames is never lost and never counted twice. The mouse position is tracked for
// aiming, and a click is both a confirm (on menus) and a punch (in the world) — the loop
// decides which by the screen it is on.

export const ACTION_INTERACT = 1;
export const ACTION_PUNCH = 2;
export const ACTION_SHOOT = 4;
export const ACTION_PAUSE = 8;
export const ACTION_CONFIRM = 16;
export const ACTION_NEW = 32;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);

export function createInput(target) {
  const held = { up: false, down: false, left: false, right: false, run: false };
  let actions = 0;
  const mouse = { x: 0, y: 0, seen: false };

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code)) held.up = true;
    else if (DOWN.has(event.code)) held.down = true;
    else if (LEFT.has(event.code)) held.left = true;
    else if (RIGHT.has(event.code)) held.right = true;
    else if (RUN.has(event.code)) held.run = true;
    else if (event.code === 'KeyE') {
      if (!event.repeat) actions |= ACTION_INTERACT | ACTION_CONFIRM;
    } else if (event.code === 'KeyJ') {
      if (!event.repeat) actions |= ACTION_PUNCH;
    } else if (event.code === 'KeyK') {
      if (!event.repeat) actions |= ACTION_SHOOT;
    } else if (event.code === 'KeyP' || event.code === 'Escape') {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (event.code === 'Enter' || event.code === 'Space') {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (event.code === 'KeyN') {
      if (!event.repeat) actions |= ACTION_NEW;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (UP.has(event.code)) held.up = false;
    else if (DOWN.has(event.code)) held.down = false;
    else if (LEFT.has(event.code)) held.left = false;
    else if (RIGHT.has(event.code)) held.right = false;
    else if (RUN.has(event.code)) held.run = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.up = held.down = held.left = held.right = held.run = false;
  });
  window.addEventListener('pointermove', (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.seen = true;
  });
  target.addEventListener('pointerdown', (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.seen = true;
    actions |= ACTION_PUNCH | ACTION_CONFIRM;
  });

  return {
    /** Movement axes, each -1, 0 or 1 (y grows downward, like the screen). */
    axes() {
      return {
        mx: (held.right ? 1 : 0) - (held.left ? 1 : 0),
        my: (held.down ? 1 : 0) - (held.up ? 1 : 0),
        run: held.run,
      };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    mouse,
  };
}
