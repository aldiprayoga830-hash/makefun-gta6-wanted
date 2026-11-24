// Every tuning number and colour for WANTED: Port Meridian in one place. The view is a fixed
// 1280x720 logical area that the renderer scales to the window; the world itself is a
// 2400x2400 city that the camera moves across, so no rule below depends on the screen size.

export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const WORLD = {
  size: 2400,
  /** South of this y the ground is harbour water, except on the two piers. */
  waterY: 2140,
  piers: [
    { x: 596, y: 2140, width: 88, height: 200 },
    { x: 1496, y: 2140, width: 88, height: 200 },
  ],
};

/** Road centre lines on both axes; traffic lanes sit LANE px to the right of the heading. */
export const ROADS = { centres: [320, 820, 1320, 1820], half: 55, lane: 27 };

export const PLAYER = {
  radius: 11,
  walkSpeed: 178,
  runSpeed: 252,
  health: 100,
  /** Health per second regained after this many quiet seconds. */
  regenDelay: 6,
  regenRate: 7,
  punchRange: 40,
  punchDamage: 34,
  punchCooldown: 0.34,
  shootCooldown: 0.26,
  /** Standing next to a policeman this long, all but stopped, means busted. */
  bustTime: 1.3,
};

export const CAR = {
  radius: 23,
  length: 56,
  width: 28,
  accel: 265,
  brake: 430,
  reverseMax: 95,
  drag: 0.55,
  /** Radians per second of steering at full lock, scaled down as speed rises. */
  steer: 2.5,
  trafficSpeed: 148,
  policeSpeed: 305,
  playerMax: 330,
};

export const PED = { radius: 10, walkSpeed: 62, fleeSpeed: 168, health: 100 };

export const COP = {
  radius: 11,
  walkSpeed: 196,
  health: 100,
  punchRange: 30,
  punchDamage: 5,
  punchCooldown: 0.85,
  shootRange: 350,
  shootDamage: 7,
  shootCooldown: 1.35,
};

export const WANTED = {
  max: 5,
  /** A crime counts in full when a pedestrian or officer is within this distance. */
  witness: 310,
  /** An officer this close with line of sight is "seeing" the player: no decay. */
  sight: 350,
  /** Seconds unseen before the heat starts to drain. */
  evadeDelay: 5,
  /** Heat per second drained while unseen. */
  decay: 0.11,
};

export const MISSION_PAY = { first: 400, second: 600, third: 1000, jobBase: 150 };

export const PICKUP = { radius: 17, cashMin: 25, cashMax: 85, ammo: 12, health: 30 };

export const SAVE_KEY = 'wanted-port-meridian.save.v1';

export const PALETTE = {
  backdrop: '#0d0f14',
  grass: '#3d6b35',
  grassDark: '#35602e',
  sidewalk: '#9aa0a3',
  sidewalkEdge: '#7e8387',
  lot: '#8b8f91',
  parking: '#565b61',
  parkingLine: '#c8cdd2',
  road: '#33373d',
  roadEdge: '#e8e8e2',
  lane: '#d8b93a',
  crosswalk: '#cfd3d6',
  water: '#14506e',
  waterDark: '#0f4260',
  dock: '#7a6a52',
  pier: '#6e5f49',
  sand: '#a68f5f',
  roofShadow: 'rgba(0,0,0,0.28)',
  marker: '#ffd23e',
  markerAlt: '#39c2ff',
  player: '#ffb347',
  police: '#2b4bd8',
  policeLight: '#ff4040',
  blood: '#a11f1f',
  panel: 'rgba(16,19,26,0.92)',
  panelEdge: '#ffd23e',
  text: '#f2f4f6',
  muted: '#a7aeb8',
  good: '#57d977',
  bad: '#ff5a4e',
  star: '#ffd23e',
  starOff: 'rgba(255,255,255,0.18)',
  health: '#57d977',
  healthLow: '#ff5a4e',
  cash: '#8be26a',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
