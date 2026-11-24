// Port Meridian itself: the road grid, the city blocks between the roads, the buildings and
// props that fill them, and the handful of places the story cares about. Generation is driven
// by the seeded random the world is created with, so a seed always builds the same city.
// Blocks are indexed by their position between roads: block (1,1) is the plaza where the
// player starts, (4,1) holds Vex's garage, (2,2) the car park of the first job, (4,3) the
// warehouse of the second, and the whole southern row is the dock district above the water.
import { ROADS, WORLD } from './config.js';

/** Block edges on one axis: the land between one road's far edge and the next road's near edge. */
const EDGES = [0, 265, 375, 765, 875, 1265, 1375, 1765, 1875, 2400];

const NAMES = [
  'MERIDIAN BANK', 'HOTEL AZURE', 'NOODLE HOUSE', 'PIER 9 GYM', 'CITY PHARMACY', 'KTV NEON',
  'BAKERY SOL', 'PORT OFFICES', 'MARINA MALL', '24H MART', 'TACO BAR', 'CITY LIBRARY',
  'BAY CLINIC', 'OLD BARBER', 'ARCADE NOVA', 'FISH MARKET', 'CUSTOMS HOUSE', 'PIZZA DOCKS',
  'HOTEL PALMS', 'INK & TONIC', 'SUSHI KAI', 'GYM IRON', 'PAWN SHOP', 'LAUNDRY 24',
  'BOOKS & CO', 'DENTAL CARE', 'MOTO WORKS', 'CAFE LUMEN', 'LIQUOR KING', 'FLORIST',
];

const ROOFS = ['#8a4f43', '#6e5a6e', '#4f6e8a', '#7a6248', '#5d7263', '#94557f', '#546a7d', '#7d5a46'];
const TRIMS = ['#e8dcc8', '#cfd8dc', '#e6c9a8', '#d8dee9', '#f0e6d2'];

export function blockRange(index) {
  return { from: EDGES[index * 2], to: EDGES[index * 2 + 1] };
}

export function createCity(random) {
  const buildings = [];
  const props = [];
  const lots = [];
  let nameIndex = Math.floor(random() * NAMES.length);

  function nextName() {
    nameIndex = (nameIndex + 1) % NAMES.length;
    return NAMES[nameIndex];
  }

  function addBuilding(x, y, width, height, named) {
    const building = {
      x, y, width, height,
      color: ROOFS[Math.floor(random() * ROOFS.length)],
      trim: TRIMS[Math.floor(random() * TRIMS.length)],
      name: named ? nextName() : null,
      floors: 2 + Math.floor(random() * 5),
    };
    buildings.push(building);
    return building;
  }

  function addProp(kind, x, y) {
    props.push({ kind, x, y, radius: kind === 'tree' ? 10 : kind === 'crate' ? 14 : 4 });
  }

  function treesIn(x, y, width, height, count) {
    for (let index = 0; index < count; index += 1) {
      addProp('tree', x + 14 + random() * (width - 28), y + 14 + random() * (height - 28));
    }
  }

  // Lamps stand on the sidewalk edge along every road, both sides, spaced along its length.
  for (const centre of ROADS.centres) {
    for (const side of [-1, 1]) {
      for (let along = 130; along < WORLD.size; along += 260) {
        addProp('lamp', centre + side * (ROADS.half + 9), along + (random() * 30 - 15));
        addProp('lamp', along + (random() * 30 - 15), centre + side * (ROADS.half + 9));
      }
    }
  }

  const spots = {};

  for (let bx = 0; bx < 5; bx += 1) {
    for (let by = 0; by < 5; by += 1) {
      const xr = blockRange(bx);
      const yr = blockRange(by);
      const x = xr.from;
      const y = yr.from;
      const width = xr.to - xr.from;
      const height = yr.to - yr.from;

      if (by === 4) {
        // The dock district: warehouses on the land, crates and parked cars, then water.
        lots.push({ x, y, width, height: WORLD.waterY - y, kind: 'dock' });
        addBuilding(x + 40, y + 26, Math.min(210, width - 90), 120, true);
        if (width > 300) addBuilding(x + width - 250, y + 26, 200, 120, false);
        for (let index = 0; index < 7; index += 1) {
          addProp('crate', x + 30 + random() * (width - 60), y + 190 + random() * 60);
        }
        continue;
      }

      if (bx === 1 && by === 1) {
        // The starting plaza: open paving, trees, and Vex waiting by the corner.
        lots.push({ x, y, width, height, kind: 'plaza' });
        treesIn(x, y, width, height, 7);
        spots.spawn = { x: x + width / 2 - 30, y: y + 44 };
        spots.vex = { x: x + width / 2 + 26, y: y + 44 };
        continue;
      }

      if (bx === 4 && by === 1) {
        // Vex's garage: one big building, a forecourt, and the delivery zone in front of it.
        const building = addBuilding(x + 60, y + 30, width - 120, 130, false);
        building.name = "VEX'S GARAGE";
        lots.push({ x: x + 30, y: y + 185, width: width - 60, height: 150, kind: 'garage' });
        spots.garageZone = { x: x + 70, y: y + 205, width: width - 140, height: 110 };
        spots.garage = { x: x + width / 2, y: y + 260 };
        continue;
      }

      if (bx === 2 && by === 2) {
        // A public car park: the first job's target car waits in the middle of it.
        lots.push({ x: x + 16, y: y + 16, width: width - 32, height: height - 32, kind: 'parking' });
        spots.targetCar = { x: x + width / 2, y: y + height / 2 };
        treesIn(x, y, 60, 60, 1);
        continue;
      }

      if (bx === 4 && by === 3) {
        // The warehouse the second job's package is lifted from.
        const building = addBuilding(x + 50, y + 40, width - 100, 170, false);
        building.name = 'WAREHOUSE 7';
        lots.push({ x: x + 30, y: y + 230, width: width - 60, height: height - 260, kind: 'parking' });
        spots.package = { x: x + width / 2, y: y + 300 };
        for (let index = 0; index < 4; index += 1) addProp('crate', x + 40 + index * 44, y + 240);
        continue;
      }

      // An ordinary block: four lots in a 2x2 grid, each a building, a car park or a park.
      const midX = x + width / 2;
      const midY = y + height / 2;
      const cells = [
        { x: x + 14, y: y + 14, width: width / 2 - 24, height: height / 2 - 24 },
        { x: midX + 10, y: y + 14, width: width / 2 - 24, height: height / 2 - 24 },
        { x: x + 14, y: midY + 10, width: width / 2 - 24, height: height / 2 - 24 },
        { x: midX + 10, y: midY + 10, width: width / 2 - 24, height: height / 2 - 24 },
      ];
      for (const cell of cells) {
        const roll = random();
        if (roll < 0.62) {
          addBuilding(cell.x + 8, cell.y + 8, cell.width - 16, cell.height - 16, cell.width > 190);
        } else if (roll < 0.82) {
          lots.push({ ...cell, kind: 'parking' });
        } else {
          lots.push({ ...cell, kind: 'park' });
          treesIn(cell.x, cell.y, cell.width, cell.height, 4);
        }
      }
    }
  }

  // The escape point of the third job: the far end of the western pier.
  spots.dockEscape = { x: WORLD.piers[0].x + WORLD.piers[0].width / 2, y: WORLD.piers[0].y + WORLD.piers[0].height - 26 };

  return { buildings, props, lots, spots };
}

/** Is this point on a road (either axis, within the asphalt)? */
export function onRoad(x, y) {
  for (const centre of ROADS.centres) {
    if (Math.abs(x - centre) <= ROADS.half || Math.abs(y - centre) <= ROADS.half) return true;
  }
  return false;
}

/** Is this point water? The piers and the dock land are not. */
export function inWater(x, y) {
  if (y < WORLD.waterY) return false;
  for (const pier of WORLD.piers) {
    if (x >= pier.x && x <= pier.x + pier.width && y >= pier.y && y <= pier.y + pier.height) return false;
  }
  return true;
}
