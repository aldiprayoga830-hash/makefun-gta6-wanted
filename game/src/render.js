// Drawing only: the world's state and the current screen in, pixels out. The camera follows
// the player across the 2400x2400 city; everything is flat shapes and canvas text. The HUD
// (health, cash, stars, weapon, objective), the minimap, dialogue boxes, banners and the
// title / pause / wasted / busted panels are drawn in the fixed 1280x720 logical view.
import { CAR, FONT, PALETTE, PLAYER, ROADS, VIEW, WORLD } from './config.js';
import { cameraFor } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_WASTED = 'wasted';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_COMPLETE = 'complete';

const MAP_SIZE = 176;
const MAP_SCALE = MAP_SIZE / WORLD.size;

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW.width, height / VIEW.height);
    view.x = (width - VIEW.width * view.scale) / 2;
    view.y = (height - VIEW.height * view.scale) / 2;
  }

  function font(size, weight) {
    const key = `${weight || ''}${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight ? '700 ' : ''}${size}px ${FONT}`);
    return fonts.get(key);
  }

  function text(value, x, y, size, color, align, weight) {
    context.font = font(size, weight);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.fillText(value, x, y);
  }

  function wrap(value, maxChars) {
    const words = value.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).trim().length > maxChars && line) {
        lines.push(line);
        line = word;
      } else line = (line + ' ' + word).trim();
    }
    if (line) lines.push(line);
    return lines;
  }

  // ---------- the world ----------

  function drawWorld(state) {
    const city = state.city;
    const cam = cameraFor(state.player.x, state.player.y);
    const x0 = cam.x - 60;
    const y0 = cam.y - 60;
    const x1 = cam.x + VIEW.width + 60;
    const y1 = cam.y + VIEW.height + 60;
    context.save();
    context.translate(-cam.x, -cam.y);

    // Land, then water and piers.
    context.fillStyle = PALETTE.grass;
    context.fillRect(cam.x, cam.y, VIEW.width, VIEW.height);
    context.fillStyle = PALETTE.water;
    context.fillRect(x0, WORLD.waterY, x1 - x0, WORLD.size - WORLD.waterY);
    context.fillStyle = PALETTE.waterDark;
    for (let wx = Math.floor(x0 / 130) * 130; wx < x1; wx += 130) {
      context.fillRect(wx + ((wx * 7) % 40), WORLD.waterY + 60 + ((wx * 13) % 120), 52, 5);
    }
    for (const pier of WORLD.piers) {
      context.fillStyle = PALETTE.pier;
      context.fillRect(pier.x, pier.y, pier.width, pier.height);
    }

    // City blocks: sidewalk base, then the lots on them.
    context.fillStyle = PALETTE.sidewalk;
    const edges = [0, 265, 375, 765, 875, 1265, 1375, 1765, 1875, 2400];
    for (let bx = 0; bx < 5; bx += 1) {
      for (let by = 0; by < 5; by += 1) {
        const bx0 = edges[bx * 2];
        const by0 = edges[by * 2];
        const bw = edges[bx * 2 + 1] - bx0;
        const bh = Math.min(edges[by * 2 + 1], WORLD.waterY) - by0;
        if (bx0 > x1 || by0 > y1 || bx0 + bw < x0 || by0 + bh < y0) continue;
        context.fillRect(bx0, by0, bw, bh);
      }
    }
    for (const lot of city.lots) {
      if (lot.x > x1 || lot.y > y1 || lot.x + lot.width < x0 || lot.y + lot.height < y0) continue;
      if (lot.kind === 'parking' || lot.kind === 'garage') {
        context.fillStyle = PALETTE.parking;
        context.fillRect(lot.x, lot.y, lot.width, lot.height);
        context.strokeStyle = PALETTE.parkingLine;
        context.lineWidth = 2;
        for (let px = lot.x + 16; px < lot.x + lot.width - 20; px += 46) {
          context.strokeRect(px, lot.y + 10, 34, 20);
          context.strokeRect(px, lot.y + lot.height - 30, 34, 20);
        }
      } else if (lot.kind === 'park') {
        context.fillStyle = PALETTE.grassDark;
        context.fillRect(lot.x, lot.y, lot.width, lot.height);
      } else if (lot.kind === 'dock') {
        context.fillStyle = PALETTE.dock;
        context.fillRect(lot.x, lot.y, lot.width, lot.height);
      } else if (lot.kind === 'plaza') {
        context.fillStyle = PALETTE.lot;
        context.fillRect(lot.x, lot.y, lot.width, lot.height);
      }
    }

    // Roads, lane dashes and crosswalks.
    context.fillStyle = PALETTE.road;
    for (const c of ROADS.centres) {
      context.fillRect(c - ROADS.half, 0, ROADS.half * 2, WORLD.size);
      context.fillRect(0, c - ROADS.half, WORLD.size, ROADS.half * 2);
    }
    context.strokeStyle = PALETTE.lane;
    context.lineWidth = 3;
    context.setLineDash([26, 22]);
    for (const c of ROADS.centres) {
      context.beginPath();
      context.moveTo(c, Math.max(0, y0));
      context.lineTo(c, Math.min(WORLD.size, y1));
      context.stroke();
      context.beginPath();
      context.moveTo(Math.max(0, x0), c);
      context.lineTo(Math.min(WORLD.size, x1), c);
      context.stroke();
    }
    context.setLineDash([]);
    context.fillStyle = PALETTE.crosswalk;
    for (const cx of ROADS.centres) {
      for (const cy of ROADS.centres) {
        if (cx + 70 < x0 || cy + 70 < y0 || cx - 70 > x1 || cy - 70 > y1) continue;
        for (let s = -44; s <= 44; s += 16) {
          context.fillRect(cx + s - 5, cy - ROADS.half + 4, 10, 12);
          context.fillRect(cx + s - 5, cy + ROADS.half - 16, 10, 12);
          context.fillRect(cx - ROADS.half + 4, cy + s - 5, 12, 10);
          context.fillRect(cx + ROADS.half - 16, cy + s - 5, 12, 10);
        }
      }
    }

    // Buildings: shadow, roof, trim, name.
    for (const b of city.buildings) {
      if (b.x > x1 || b.y > y1 || b.x + b.width < x0 || b.y + b.height < y0) continue;
      context.fillStyle = PALETTE.roofShadow;
      context.fillRect(b.x + 7, b.y + 9, b.width, b.height);
      context.fillStyle = b.color;
      context.fillRect(b.x, b.y, b.width, b.height);
      context.strokeStyle = b.trim;
      context.lineWidth = 3;
      context.strokeRect(b.x + 2, b.y + 2, b.width - 4, b.height - 4);
      context.fillStyle = 'rgba(255,255,255,0.10)';
      const stepX = 44;
      for (let wx = b.x + 18; wx < b.x + b.width - 20; wx += stepX) {
        for (let wy = b.y + 16; wy < b.y + b.height - 18; wy += 40) {
          context.fillRect(wx, wy, 16, 10);
        }
      }
      if (b.name && b.width > 130) {
        context.save();
        context.shadowColor = 'rgba(0,0,0,0.65)';
        context.shadowBlur = 4;
        text(b.name, b.x + b.width / 2, b.y + b.height / 2 + 5, 15, '#ffffff', 'center', true);
        context.restore();
      }
    }

    // Props.
    for (const prop of city.props) {
      if (prop.x < x0 || prop.y < y0 || prop.x > x1 || prop.y > y1) continue;
      if (prop.kind === 'tree') {
        context.fillStyle = '#2c5426';
        context.beginPath();
        context.arc(prop.x, prop.y, 15, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#3f7a34';
        context.beginPath();
        context.arc(prop.x - 3, prop.y - 3, 10, 0, Math.PI * 2);
        context.fill();
      } else if (prop.kind === 'crate') {
        context.fillStyle = prop.broken ? '#5a4a33' : '#9a7b4f';
        context.fillRect(prop.x - 13, prop.y - 13, 26, 26);
        context.strokeStyle = '#6e5836';
        context.lineWidth = 2;
        context.strokeRect(prop.x - 13, prop.y - 13, 26, 26);
      } else if (prop.kind === 'lamp') {
        context.fillStyle = prop.broken ? '#44484d' : '#2f3338';
        context.fillRect(prop.x - 2, prop.y - 2, 4, 4);
        if (!prop.broken) {
          context.fillStyle = '#ffe9a3';
          context.beginPath();
          context.arc(prop.x, prop.y, 3, 0, Math.PI * 2);
          context.fill();
        }
      }
    }

    // The garage delivery zone.
    const zone = city.spots.garageZone;
    context.strokeStyle = PALETTE.marker;
    context.lineWidth = 3;
    context.setLineDash([12, 8]);
    context.strokeRect(zone.x, zone.y, zone.width, zone.height);
    context.setLineDash([]);

    // Pickups.
    for (const pickup of state.pickups) {
      if (pickup.respawn > 0) continue;
      if (pickup.x < x0 || pickup.y < y0 || pickup.x > x1 || pickup.y > y1) continue;
      const bob = Math.sin(pickup.t * 4) * 3;
      if (pickup.kind === 'cash') {
        context.fillStyle = '#8be26a';
        context.beginPath();
        context.arc(pickup.x, pickup.y + bob, 10, 0, Math.PI * 2);
        context.fill();
        text('$', pickup.x, pickup.y + bob + 5, 13, '#14501c', 'center', true);
      } else if (pickup.kind === 'ammo') {
        context.fillStyle = '#39c2ff';
        context.fillRect(pickup.x - 9, pickup.y - 7 + bob, 18, 14);
        text('9mm', pickup.x, pickup.y + bob + 4, 9, '#0b2c40', 'center', true);
      } else {
        context.fillStyle = '#ffffff';
        context.beginPath();
        context.arc(pickup.x, pickup.y + bob, 10, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#d92b2b';
        context.fillRect(pickup.x - 2, pickup.y - 7 + bob, 4, 14);
        context.fillRect(pickup.x - 7, pickup.y - 2 + bob, 14, 4);
      }
    }

    // Mission marker: a column of light and a bouncing chevron.
    const marker = state.marker;
    if (marker && !state.dialogue) {
      const pulse = 0.55 + 0.3 * Math.sin(state.time * 5);
      const grad = context.createLinearGradient(0, marker.y - 300, 0, marker.y);
      grad.addColorStop(0, 'rgba(255,210,62,0)');
      grad.addColorStop(1, `rgba(255,210,62,${pulse})`);
      context.fillStyle = grad;
      context.fillRect(marker.x - 13, marker.y - 300, 26, 300);
      context.strokeStyle = PALETTE.marker;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(marker.x, marker.y, 20 + 3 * Math.sin(state.time * 5), 0, Math.PI * 2);
      context.stroke();
      const bounce = Math.abs(Math.sin(state.time * 3.4)) * 10;
      context.fillStyle = PALETTE.marker;
      context.beginPath();
      context.moveTo(marker.x - 11, marker.y - 52 - bounce);
      context.lineTo(marker.x + 11, marker.y - 52 - bounce);
      context.lineTo(marker.x, marker.y - 38 - bounce);
      context.closePath();
      context.fill();
    }

    // Vex.
    drawPerson(state.vex.x, state.vex.y, state.vex.angle, '#8e44ad', true);
    text('VEX', state.vex.x, state.vex.y - 24, 12, '#e9c6ff', 'center', true);

    // Pedestrians and officers.
    for (const ped of state.peds) drawBody(ped);
    for (const cop of state.cops) drawBody(cop);

    // Cars.
    for (const car of state.cars) drawCar(car, state.time);

    // The player, when on foot.
    if (!state.player.car) {
      drawPerson(state.player.x, state.player.y, state.player.angle, PALETTE.player, false);
      if (state.player.ammo > 0) {
        context.strokeStyle = '#22262c';
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(state.player.x, state.player.y);
        context.lineTo(state.player.x + Math.cos(state.player.angle) * 20, state.player.y + Math.sin(state.player.angle) * 20);
        context.stroke();
      }
    }

    // Particles and floating texts.
    for (const part of state.parts) {
      context.globalAlpha = 1 - part.t / part.life;
      context.fillStyle = part.color;
      context.fillRect(part.x - part.size / 2, part.y - part.size / 2, part.size, part.size);
    }
    context.globalAlpha = 1;
    for (const fl of state.floats) {
      context.globalAlpha = 1 - fl.t / 1.4;
      text(fl.text, fl.x, fl.y, 15, fl.color, 'center', true);
    }
    context.globalAlpha = 1;
    context.restore();
  }

  function drawBody(ent) {
    if (ent.state === 'down') {
      context.fillStyle = PALETTE.blood;
      context.beginPath();
      context.arc(ent.x, ent.y, 13, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = ent.color;
      context.beginPath();
      context.ellipse(ent.x, ent.y, 15, 7, ent.angle, 0, Math.PI * 2);
      context.fill();
      return;
    }
    drawPerson(ent.x, ent.y, ent.angle, ent.color, ent.kind === 'cop');
  }

  function drawPerson(x, y, angle, color, isCop) {
    context.fillStyle = 'rgba(0,0,0,0.3)';
    context.beginPath();
    context.arc(x + 2, y + 3, 10, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, 10, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#e8b98d';
    context.beginPath();
    context.arc(x, y, 6, 0, Math.PI * 2);
    context.fill();
    if (isCop) {
      context.fillStyle = '#16265e';
      context.beginPath();
      context.arc(x, y, 6.5, Math.PI * 0.9, Math.PI * 2.1);
      context.fill();
    }
    context.strokeStyle = 'rgba(0,0,0,0.45)';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * 12, y + Math.sin(angle) * 12);
    context.stroke();
  }

  function drawCar(car, time) {
    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.angle);
    context.fillStyle = 'rgba(0,0,0,0.32)';
    context.fillRect(-CAR.length / 2 + 3, -CAR.width / 2 + 4, CAR.length, CAR.width);
    context.fillStyle = car.color;
    context.beginPath();
    context.roundRect(-CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 7);
    context.fill();
    if (car.kind === 'police') {
      context.fillStyle = '#f2f4f6';
      context.fillRect(-8, -CAR.width / 2, 17, CAR.width);
      const flash = Math.floor(time * 4) % 2 === 0;
      context.fillStyle = flash ? PALETTE.policeLight : '#3a6bff';
      context.fillRect(-4, -9, 9, 7);
      context.fillStyle = flash ? '#3a6bff' : PALETTE.policeLight;
      context.fillRect(-4, 2, 9, 7);
    }
    context.fillStyle = '#1c2733';
    context.fillRect(2, -CAR.width / 2 + 3, 12, CAR.width - 6);
    context.fillRect(-CAR.length / 2 + 6, -CAR.width / 2 + 3, 8, CAR.width - 6);
    context.fillStyle = '#14161a';
    for (const [wx, wy] of [[-19, -15], [19, -15], [-19, 11], [19, 11]]) {
      context.fillRect(wx - 6, wy, 12, 5);
    }
    if (car.target) {
      context.strokeStyle = PALETTE.marker;
      context.lineWidth = 3;
      context.beginPath();
      context.roundRect(-CAR.length / 2 - 3, -CAR.width / 2 - 3, CAR.length + 6, CAR.width + 6, 9);
      context.stroke();
    }
    context.restore();
  }

  // ---------- HUD and panels (logical view space) ----------

  function drawMinimap(state, stars) {
    const mx = VIEW.width - MAP_SIZE - 16;
    const my = 16;
    context.fillStyle = 'rgba(10,24,34,0.88)';
    context.fillRect(mx, my, MAP_SIZE, MAP_SIZE);
    context.fillStyle = '#476b3f';
    context.fillRect(mx, my, MAP_SIZE, WORLD.waterY * MAP_SCALE);
    context.strokeStyle = 'rgba(220,225,230,0.75)';
    context.lineWidth = 2;
    for (const c of ROADS.centres) {
      context.beginPath();
      context.moveTo(mx + c * MAP_SCALE, my);
      context.lineTo(mx + c * MAP_SCALE, my + MAP_SIZE);
      context.stroke();
      context.beginPath();
      context.moveTo(mx, my + c * MAP_SCALE);
      context.lineTo(mx + MAP_SIZE, my + c * MAP_SCALE);
      context.stroke();
    }
    const dot = (x, y, color, size) => {
      context.fillStyle = color;
      context.fillRect(mx + x * MAP_SCALE - size / 2, my + y * MAP_SCALE - size / 2, size, size);
    };
    for (const car of state.cars) if (car.kind === 'police') dot(car.x, car.y, '#5f83ff', 5);
    for (const cop of state.cops) if (cop.state !== 'down') dot(cop.x, cop.y, '#5f83ff', 4);
    if (state.marker) {
      const pulse = 5 + 2 * Math.sin(state.time * 5);
      dot(state.marker.x, state.marker.y, PALETTE.marker, pulse + 3);
    }
    // The player: a white arrow in the facing direction.
    const px = mx + state.player.x * MAP_SCALE;
    const py = my + state.player.y * MAP_SCALE;
    context.save();
    context.translate(px, py);
    context.rotate(state.player.angle);
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.moveTo(7, 0);
    context.lineTo(-5, -4.5);
    context.lineTo(-5, 4.5);
    context.closePath();
    context.fill();
    context.restore();
    context.strokeStyle = 'rgba(255,255,255,0.35)';
    context.lineWidth = 1;
    context.strokeRect(mx, my, MAP_SIZE, MAP_SIZE);
    // Wanted stars under the map.
    for (let index = 0; index < 5; index += 1) {
      text('★', mx + 6 + index * 33, my + MAP_SIZE + 30, 30, index < stars ? PALETTE.star : PALETTE.starOff, 'left', true);
    }
  }

  function drawHud(state, stars, screen) {
    const player = state.player;
    // Health.
    context.fillStyle = 'rgba(10,12,16,0.72)';
    context.fillRect(18, 16, 232, 22);
    const frac = Math.max(0, player.health / PLAYER.health);
    context.fillStyle = frac < 0.3 ? PALETTE.healthLow : PALETTE.health;
    context.fillRect(20, 18, 228 * frac, 18);
    text('HP', 26, 33, 14, '#0d0f14', 'left', true);
    // Cash.
    text(`$ ${player.cash.toLocaleString('en-US')}`, 20, 68, 25, PALETTE.cash, 'left', true);
    // Weapon.
    const weapon = player.car ? 'DRIVING' : player.ammo > 0 ? `PISTOL · ${player.ammo}` : 'FISTS';
    text(weapon, 20, VIEW.height - 20, 19, PALETTE.text, 'left', true);
    text(player.car ? 'E — get out · WASD — drive' : 'E — enter car / talk · J — punch · K — shoot · Shift — run', 20, VIEW.height - 46, 14, PALETTE.muted, 'left');
    // Objective pill, top centre.
    if (state.objective) {
      context.font = font(16, true);
      const w = context.measureText(state.objective).width + 30;
      context.fillStyle = 'rgba(10,12,16,0.72)';
      context.beginPath();
      context.roundRect((VIEW.width - w) / 2, 14, w, 30, 15);
      context.fill();
      text(state.objective, VIEW.width / 2, 36, 16, PALETTE.marker, 'center', true);
    }
    drawMinimap(state, stars);
    // Bust meter.
    if (player.bustT > 0.04 && !state.gameOver) {
      const frac2 = Math.min(1, player.bustT / PLAYER.bustTime);
      context.fillStyle = 'rgba(10,12,16,0.8)';
      context.fillRect(VIEW.width / 2 - 130, VIEW.height - 120, 260, 20);
      context.fillStyle = PALETTE.bad;
      context.fillRect(VIEW.width / 2 - 128, VIEW.height - 118, 256 * frac2, 16);
      text('THEY ARE ON YOU — MOVE!', VIEW.width / 2, VIEW.height - 130, 16, PALETTE.bad, 'center', true);
    }
    // Mission banner (the complete screen shows the same text on its own panel instead).
    if (state.banner && screen !== SCREEN_COMPLETE) {
      const alpha = Math.min(1, state.banner.t);
      context.globalAlpha = alpha;
      context.fillStyle = PALETTE.panel;
      context.beginPath();
      context.roundRect(VIEW.width / 2 - 330, 92, 660, 96, 10);
      context.fill();
      context.strokeStyle = PALETTE.panelEdge;
      context.lineWidth = 2;
      context.stroke();
      text(state.banner.title, VIEW.width / 2, 132, 30, PALETTE.marker, 'center', true);
      text(state.banner.sub, VIEW.width / 2, 164, 17, PALETTE.text, 'center');
      context.globalAlpha = 1;
    }
    // Dialogue box.
    if (state.dialogue) {
      const line = state.dialogue.lines[state.dialogue.index];
      context.fillStyle = PALETTE.panel;
      context.beginPath();
      context.roundRect(140, VIEW.height - 168, VIEW.width - 280, 132, 10);
      context.fill();
      context.strokeStyle = PALETTE.panelEdge;
      context.lineWidth = 2;
      context.stroke();
      text(line.who.toUpperCase(), 168, VIEW.height - 128, 17, PALETTE.marker, 'left', true);
      const lines = wrap(line.text, 74);
      lines.forEach((part, index) => text(part, 168, VIEW.height - 96 + index * 26, 19, PALETTE.text, 'left'));
      text('E / Enter ▸', VIEW.width - 168, VIEW.height - 52, 15, PALETTE.muted, 'right');
    }
  }

  function drawPanel(title, titleColor, lines, prompt) {
    context.fillStyle = 'rgba(5,6,9,0.62)';
    context.fillRect(0, 0, VIEW.width, VIEW.height);
    const width = 760;
    const height = 150 + lines.length * 30 + 70;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2 - 20;
    context.fillStyle = PALETTE.panel;
    context.beginPath();
    context.roundRect(x, y, width, height, 12);
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.stroke();
    text(title, VIEW.width / 2, y + 84, 52, titleColor, 'center', true);
    lines.forEach((line, index) => text(line, VIEW.width / 2, y + 140 + index * 30, 19, PALETTE.text, 'center'));
    if (prompt) text(prompt, VIEW.width / 2, y + height - 30, 20, PALETTE.marker, 'center', true);
  }

  const STORY = [
    'Port Meridian runs on two things: harbour money and other people\'s cars.',
    'You are new in town, broke, and good behind a wheel. Vex, the fixer at the',
    'plaza, has work — if you do not mind the attention of the Port Meridian PD.',
  ];
  const CONTROLS = [
    'WASD / arrows — move & drive      Shift — run',
    'E — talk / steal car / get out     J or click — punch',
    'K — pistol (needs ammo)            P / Esc — pause',
  ];

  /** Paint one frame: the world, then the HUD or the panel for the screen the game is on. */
  function draw(world, screen, opts) {
    const state = world.state;
    state.marker = world.missionMarker();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    context.textBaseline = 'alphabetic';
    drawWorld(state);
    if (screen === SCREEN_TITLE) {
      context.fillStyle = 'rgba(5,6,10,0.55)';
      context.fillRect(0, 0, VIEW.width, VIEW.height);
      text('WANTED', VIEW.width / 2, 168, 96, PALETTE.marker, 'center', true);
      text('P O R T   M E R I D I A N', VIEW.width / 2, 216, 30, PALETTE.text, 'center', true);
      STORY.forEach((line, index) => text(line, VIEW.width / 2, 286 + index * 27, 19, PALETTE.text, 'center'));
      CONTROLS.forEach((line, index) => text(line, VIEW.width / 2, 404 + index * 26, 17, PALETTE.muted, 'center'));
      if (opts && opts.hasSave) {
        text('ENTER — Continue      N — New game', VIEW.width / 2, 540, 24, PALETTE.good, 'center', true);
      } else {
        text('ENTER — New game', VIEW.width / 2, 540, 24, PALETTE.good, 'center', true);
      }
      text('A tiny open-world crime spree in one HTML file. No police were harmed. (Several were.)', VIEW.width / 2, 640, 14, PALETTE.muted, 'center');
      return;
    }
    drawHud(state, world.stars(), screen);
    if (screen === SCREEN_PAUSED) drawPanel('PAUSED', PALETTE.text, ['The city holds its breath.'], 'P / Esc — resume');
    else if (screen === SCREEN_WASTED) drawPanel('WASTED', PALETTE.bad, ['You wake up at Bay Clinic. The city kept your money and your dignity is negotiable.'], 'ENTER — back on the street');
    else if (screen === SCREEN_BUSTED) drawPanel('BUSTED', '#7fa8ff', ['Port Meridian PD walks you to a cell. You walk out later — poorer in time, same in cash.'], 'ENTER — back on the street');
    else if (screen === SCREEN_COMPLETE) {
      const banner = state.banner ?? { title: 'MISSION COMPLETE', sub: 'The coupe is delivered.' };
      drawPanel(banner.title, PALETTE.good, [banner.sub, `Cash on hand: $ ${state.player.cash.toLocaleString('en-US')}`], '');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, view };
}
