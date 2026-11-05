import * as THREE from 'three';
import { createPath, LANE_X } from './path.js';
import { createCourier, animateCourier } from './courier.js';

// ---------------------------------------------------------------- renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1026);
scene.fog = new THREE.Fog(0x0a1026, 50, 135);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 320);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

// lights
scene.add(new THREE.HemisphereLight(0x6b8cff, 0x120f2e, 1.15));
const moonLight = new THREE.DirectionalLight(0xbfd4ff, 1.3);
moonLight.position.set(-18, 30, 14);
scene.add(moonLight);
const rimLight = new THREE.DirectionalLight(0xff2e88, 0.55);
rimLight.position.set(16, 10, -22);
scene.add(rimLight);

// ---------------------------------------------------------------- world
const path = createPath(scene);
const courier = createCourier();
scene.add(courier.root);

// ---------------------------------------------------------------- state
const STATE = { MENU: 0, RUN: 1, OVER: 2 };
let state = STATE.MENU;

const BASE_SPEED = 17;
const MAX_SPEED = 33;
const TURN_WINDOW = 20;
// test harness: ?auto=1 takes every corner automatically
const AUTO_TURN = new URLSearchParams(location.search).has('auto');

let speed = BASE_SPEED;
let distance = 0;
let cellCount = 0;
let score = 0;
let best = Number(localStorage.getItem('moonline.best') || 0);
let swapLR = localStorage.getItem('moonline.swapLR') === '1';
let swapUD = localStorage.getItem('moonline.swapUD') === '1';

const player = {
  s: 6,
  lane: 1,
  x: 0,
  y: 0,
  vy: 0,
  sliding: false,
  slideTimer: 0,
  state: 'run',
  animTime: 0,
  lean: 0,
  yaw: 0,
  turnArmed: null,   // 'left' | 'right' | null for the upcoming corner
  turnCrash: false,
};

let activeSeg = null;
let camYaw = 0;
let camPos = new THREE.Vector3(0, 3.4, 7);
const camLook = new THREE.Vector3();

// ---------------------------------------------------------------- HUD
const hudDistance = document.getElementById('hudDistance');
const hudCells = document.getElementById('hudCells');
const hudScore = document.getElementById('hudScore');
const turnHint = document.getElementById('turnHint');
const startScreen = document.getElementById('startScreen');
const overScreen = document.getElementById('overScreen');
const overStats = document.getElementById('overStats');
const swapLRBtn = document.getElementById('swapLR');
const swapUDBtn = document.getElementById('swapUD');

function paintSettings() {
  swapLRBtn.textContent = swapLR ? 'LEFT / RIGHT: SWAPPED' : 'LEFT / RIGHT: NORMAL';
  swapUDBtn.textContent = swapUD ? 'UP / DOWN: SWAPPED' : 'UP / DOWN: NORMAL';
}
paintSettings();

swapLRBtn.addEventListener('click', () => {
  swapLR = !swapLR;
  localStorage.setItem('moonline.swapLR', swapLR ? '1' : '0');
  paintSettings();
});
swapUDBtn.addEventListener('click', () => {
  swapUD = !swapUD;
  localStorage.setItem('moonline.swapUD', swapUD ? '1' : '0');
  paintSettings();
});

function updateHud() {
  hudDistance.textContent = `${Math.floor(distance)} m`;
  hudCells.textContent = String(cellCount);
  hudScore.textContent = String(score);
}

// ---------------------------------------------------------------- run control
function resetRun() {
  path.reset();
  path.ensureAhead(0, 300);

  player.s = 6;
  player.lane = 1;
  player.x = 0;
  player.y = 0;
  player.vy = 0;
  player.sliding = false;
  player.slideTimer = 0;
  player.state = 'run';
  player.yaw = path.yawAt(6);
  player.turnArmed = null;
  player.turnCrash = false;
  player.lean = 0;

  camYaw = player.yaw;
  activeSeg = null;
  speed = BASE_SPEED;
  distance = 0;
  cellCount = 0;
  score = 0;

  const p = path.positionAt(player.s, 0, 0);
  courier.root.position.copy(p);
  camPos.copy(p).add(new THREE.Vector3(Math.sin(camYaw) * -7, 3.4, Math.cos(camYaw) * 7));
  updateHud();
}

function startRun() {
  resetRun();
  startScreen.classList.add('hidden');
  overScreen.classList.add('hidden');
  turnHint.classList.add('hidden');
  state = STATE.RUN;
}

function endRun() {
  if (state === STATE.OVER) return;
  state = STATE.OVER;
  player.state = 'hit';
  turnHint.classList.add('hidden');
  if (score > best) {
    best = score;
    localStorage.setItem('moonline.best', String(best));
  }
  overStats.innerHTML = `
    <div class="stat"><span>DISTANCE</span><b>${Math.floor(distance)} m</b></div>
    <div class="stat"><span>CELLS</span><b>${cellCount}</b></div>
    <div class="stat"><span>SCORE</span><b>${score}</b></div>
    <div class="stat"><span>BEST</span><b>${best}</b></div>`;
  overScreen.classList.remove('hidden');
}

// ---------------------------------------------------------------- input
function laneDelta(dir) {
  return swapLR ? -dir : dir;
}

function moveLane(dir) {
  if (state !== STATE.RUN || player.state === 'hit') return;
  const seg = path.segmentAt(player.s);
  const toEnd = seg.startS + seg.len - player.s;

  // near a corner a swipe is a turn command, not a lane change
  if (seg.turn && toEnd < TURN_WINDOW && toEnd > -1) {
    if ((dir > 0 && seg.turn === 'right') || (dir < 0 && seg.turn === 'left')) {
      player.turnArmed = seg.turn;
      turnHint.textContent = 'TURN LOCKED';
      turnHint.classList.add('locked');
      return;
    }
    // wrong direction: still allow the lane nudge, but no turn
  }

  player.lane = THREE.MathUtils.clamp(player.lane + laneDelta(dir), 0, 2);
  player.lean = -laneDelta(dir) * 0.3;
}

function jump() {
  if (state !== STATE.RUN || player.state === 'hit') return;
  if (player.y > 0.02 || player.sliding) return;
  player.vy = 8.8;
  player.y = 0.03;
  player.state = 'jump';
}

function slide() {
  if (state !== STATE.RUN || player.state === 'hit') return;
  if (player.y > 0.02) {
    player.vy = -20;
    player.sliding = true;
    player.slideTimer = 0.72;
    return;
  }
  player.sliding = true;
  player.slideTimer = 0.72;
}

// keyboard
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') moveLane(-1);
  else if (k === 'arrowright' || k === 'd') moveLane(1);
  else if (k === 'arrowup' || k === 'w' || k === ' ') { e.preventDefault(); jump(); }
  else if (k === 'arrowdown' || k === 's') { e.preventDefault(); slide(); }
});

// swipe
let touchStart = null;
const surface = document.getElementById('app');
surface.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
}, { passive: true });

surface.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const elapsed = performance.now() - touchStart.time;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  touchStart = null;

  if (Math.max(absX, absY) < 26) {
    if (elapsed < 300) {
      if (state === STATE.MENU || state === STATE.OVER) startRun();
      else jump();
    }
    return;
  }

  if (absX > absY) {
    const dir = dx > 0 ? 1 : -1;
    moveLane(dir);
  } else {
    const up = dy < 0;
    const wantsJump = swapUD ? !up : up;
    if (wantsJump) jump();
    else slide();
  }
}, { passive: true });

document.getElementById('playBtn').addEventListener('click', startRun);
document.getElementById('againBtn').addEventListener('click', startRun);


// ---------------------------------------------------------------- test harness
function autopilot() {
  for (const sg of path.segments) {
    for (const obs of sg.obstacles) {
      const gap = obs.s - player.s;
      if (gap < 1 || gap > 14) continue;
      if (obs.lane === player.lane) {
        if (obs.type === 'barrier') { jump(); return; }
        if (obs.type === 'gate') { slide(); return; }
        const free = [0, 1, 2].find((l) => l !== obs.lane);
        if (free !== undefined) { moveLane(free - player.lane > 0 ? 1 : -1); return; }
      }
    }
  }
}

// ---------------------------------------------------------------- gameplay
const clock = new THREE.Clock();

function collides(obs) {
  if (obs.lane !== player.lane) return false;
  if (Math.abs(obs.s - player.s) > 1.7) return false;
  if (obs.type === 'barrier') return player.y < 1.02;
  if (obs.type === 'gate') return !(player.sliding && player.y < 0.45);
  return true;
}


const DEBUG = new URLSearchParams(location.search).has('debug');
function paintDebug() {
  if (!DEBUG) return;
  let el = document.getElementById('dbg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dbg';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#8cff00;background:rgba(0,0,0,.6);padding:6px 8px;border-radius:6px;z-index:50;white-space:pre;';
    document.body.appendChild(el);
  }
  const seg = path.segmentAt(player.s);
  el.textContent = `s=${player.s.toFixed(1)} lane=${player.lane} x=${player.x.toFixed(2)} spd=${speed.toFixed(1)}
seg=${seg.startS.toFixed(0)}+${seg.len} turn=${seg.turn || '-'} toEnd=${(seg.startS + seg.len - player.s).toFixed(1)}
armed=${player.turnArmed || '-'} y=${player.y.toFixed(2)} slide=${player.sliding}`;
}

function updateRun(dt) {
  player.animTime += dt;
  speed = Math.min(MAX_SPEED, BASE_SPEED + distance * 0.011);
  player.s += speed * dt;
  distance = player.s - 6;
  score = Math.floor(distance) + cellCount * 25;

  // lane glide (pull to lane centre through an armed corner so the offset
  // doesn't pop when the corridor changes direction)
  const segNow = path.segmentAt(player.s);
  const nearCorner = segNow.turn && player.turnArmed && (segNow.startS + segNow.len - player.s) < 9;
  const targetX = nearCorner ? 0 : LANE_X[player.lane];
  player.x += (targetX - player.x) * Math.min(1, dt * 15);
  player.lean += (0 - player.lean) * Math.min(1, dt * 7);

  // vertical motion
  if (player.y > 0 || player.vy !== 0) {
    player.vy -= 25 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      player.state = player.sliding ? 'slide' : 'run';
    } else {
      player.state = 'jump';
    }
  }

  if (player.sliding) {
    player.slideTimer -= dt;
    player.state = 'slide';
    if (player.slideTimer <= 0) {
      player.sliding = false;
      if (player.y <= 0) player.state = 'run';
    }
  }

  // ---- corner logic (crossing detected by segment change)
  const seg = path.segmentAt(player.s);

  if (activeSeg && seg !== activeSeg) {
    // we just crossed a segment boundary: was a turn required?
    if (activeSeg.turn && player.turnArmed !== activeSeg.turn) {
      endRun();
      return;
    }
    player.turnArmed = null;
    player.lane = 1;
    player.x = 0;
    turnHint.classList.add('hidden');
    turnHint.classList.remove('locked');
  }
  activeSeg = seg;

  const toEnd = seg.startS + seg.len - player.s;

  if (seg.turn && toEnd < TURN_WINDOW && toEnd > 0) {
    if (AUTO_TURN) player.turnArmed = seg.turn;
    turnHint.classList.remove('hidden');
    if (player.turnArmed !== seg.turn) {
      turnHint.textContent = seg.turn === 'left' ? '◀  SWIPE LEFT' : 'SWIPE RIGHT  ▶';
      turnHint.classList.remove('locked');
    }
  } else if (!player.turnArmed) {
    turnHint.classList.add('hidden');
  }

  // ---- world streaming
  path.ensureAhead(player.s, 300);
  path.prune(player.s);

  if (AUTO_TURN) autopilot();

  // ---- obstacle collision
  for (const sg of path.segments) {
    for (const obs of sg.obstacles) {
      if (Math.abs(obs.s - player.s) > 2) continue;
      if (collides(obs)) {
        endRun();
        return;
      }
    }
  }

  // ---- cells
  for (const sg of path.segments) {
    for (const c of sg.cells) {
      if (c.taken) continue;
      if (Math.abs(c.s - player.s) < 1.5 && c.lane === player.lane) {
        c.taken = true;
        c.mesh.visible = false;
        cellCount++;
        score += 25;
      }
    }
  }

  // animated pickups
  const t = player.animTime;
  for (const sg of path.segments) {
    for (const c of sg.cells) {
      if (!c.taken) {
        c.mesh.rotation.y = t * 2.2;
        c.mesh.rotation.x = t * 0.9;
      }
    }
  }

  // ---- place the courier
  const worldPos = path.positionAt(player.s, player.x, player.y);
  courier.root.position.copy(worldPos);
  player.yaw = path.yawAt(player.s);
  courier.root.rotation.y = player.yaw + Math.PI;
  courier.root.rotation.z = player.lean;

  const ratio = THREE.MathUtils.clamp((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);
  animateCourier(courier, player.state, player.animTime, ratio);

  updateCamera(dt, worldPos, player.yaw);
  updateHud();
  paintDebug();
}

function updateCamera(dt, worldPos, yaw) {
  // shortest-arc yaw smoothing so corners swing instead of snapping
  let diff = yaw - camYaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  camYaw += diff * Math.min(1, dt * 7);

  const speedRatio = THREE.MathUtils.clamp((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);
  const back = 6.8 + speedRatio * 0.9;
  const height = 3.5 + speedRatio * 0.3;

  const targetPos = new THREE.Vector3(
    worldPos.x - Math.sin(camYaw) * back,
    height + worldPos.y * 0.35,
    worldPos.z + Math.cos(camYaw) * back
  );
  camPos.lerp(targetPos, Math.min(1, dt * 9));
  camera.position.copy(camPos);

  camLook.set(
    worldPos.x + Math.sin(camYaw) * 8,
    1.5 + worldPos.y * 0.4,
    worldPos.z - Math.cos(camYaw) * 8
  );
  camera.lookAt(camLook);
}

function updateMenu(dt) {
  player.animTime += dt;
  animateCourier(courier, 'run', player.animTime, 0.25);
  const worldPos = path.positionAt(player.s, 0, 0);
  courier.root.position.copy(worldPos);
  courier.root.rotation.y = player.yaw + Math.PI;
  updateCamera(dt, worldPos, player.yaw);
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state === STATE.RUN) updateRun(dt);
  else if (state === STATE.MENU) updateMenu(dt);
  else if (state === STATE.OVER) {
    // let the stumble read, keep the camera alive
    player.animTime += dt;
    animateCourier(courier, 'hit', player.animTime, 0);
    const worldPos = path.positionAt(player.s, player.x, player.y);
    updateCamera(dt, worldPos, player.yaw);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resetRun();
overScreen.classList.add('hidden');
frame();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
