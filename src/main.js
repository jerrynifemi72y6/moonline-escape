import * as THREE from 'three';
import { buildEnvironment, LANE_X } from './world.js';
import { createCourier, animateCourier } from './courier.js';

// ---------------------------------------------------------------- renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 260);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const env = buildEnvironment(scene);

// ---------------------------------------------------------------- player
const courier = createCourier();
const playerGroup = new THREE.Group();
playerGroup.add(courier.root);
scene.add(playerGroup);

const player = {
  lane: 1,
  x: LANE_X[1],
  y: 0,
  vy: 0,
  sliding: false,
  slideTimer: 0,
  state: 'run',
  animTime: 0,
  hitTimer: 0,
  lean: 0,
};

// ---------------------------------------------------------------- pools
const OBSTACLE_TYPES = {
  barrier: { w: 1.7, h: 1.05, d: 1.0, color: 0xff2e88, y: 0.52 },
  gate: { w: 2.0, h: 1.5, d: 0.5, color: 0xffb02e, y: 2.25 },
  block: { w: 2.0, h: 2.7, d: 1.4, color: 0x2b3566, y: 1.35 },
};

const materialCache = {};
function matFor(color) {
  if (!materialCache[color]) materialCache[color] = new THREE.MeshLambertMaterial({ color });
  return materialCache[color];
}

const obstaclePools = {};
for (const [type, spec] of Object.entries(OBSTACLE_TYPES)) {
  const pool = [];
  const geo = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(geo, matFor(spec.color));
    m.visible = false;
    m.position.set(0, spec.y, -999);
    scene.add(m);
    pool.push({ mesh: m, type, active: false, lane: 1, z: 0 });
  }
  obstaclePools[type] = pool;
}

// glowing edge bar so obstacles read at speed
const edgeGeo = new THREE.BoxGeometry(1, 0.08, 0.08);
const edgeMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
for (const pool of Object.values(obstaclePools)) {
  for (const o of pool) {
    const e = new THREE.Mesh(edgeGeo, edgeMat);
    e.position.y = OBSTACLE_TYPES[o.type].h / 2 - 0.06;
    e.scale.x = OBSTACLE_TYPES[o.type].w * 0.95;
    o.mesh.add(e);
  }
}

const cellGeo = new THREE.OctahedronGeometry(0.34, 0);
const cellMat = new THREE.MeshBasicMaterial({ color: 0x8cff00 });
const cells = [];
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(cellGeo, cellMat);
  m.visible = false;
  scene.add(m);
  cells.push({ mesh: m, active: false, lane: 1, z: 0 });
}

function acquireObstacle(type) {
  const pool = obstaclePools[type];
  const free = pool.find((o) => !o.active);
  if (!free) return null;
  free.active = true;
  free.mesh.visible = true;
  return free;
}

function acquireCell() {
  const free = cells.find((c) => !c.active);
  if (!free) return null;
  free.active = true;
  free.mesh.visible = true;
  return free;
}

// ---------------------------------------------------------------- game state
const STATE = { MENU: 0, RUN: 1, OVER: 2 };
let state = STATE.MENU;

const BASE_SPEED = 16;
const MAX_SPEED = 34;
let speed = BASE_SPEED;
let distance = 0;
let cellCount = 0;
let score = 0;
let spawnTimer = 0;
let best = Number(localStorage.getItem('moonline.best') || 0);

const hudDistance = document.getElementById('hudDistance');
const hudCells = document.getElementById('hudCells');
const hudScore = document.getElementById('hudScore');
const startScreen = document.getElementById('startScreen');
const overScreen = document.getElementById('overScreen');
const overStats = document.getElementById('overStats');

function resetRun() {
  player.lane = 1;
  player.x = LANE_X[1];
  player.y = 0;
  player.vy = 0;
  player.sliding = false;
  player.slideTimer = 0;
  player.state = 'run';
  player.hitTimer = 0;
  player.lean = 0;

  speed = BASE_SPEED;
  distance = 0;
  cellCount = 0;
  score = 0;
  spawnTimer = 0.6;

  for (const pool of Object.values(obstaclePools)) {
    for (const o of pool) { o.active = false; o.mesh.visible = false; o.z = -999; }
  }
  for (const c of cells) { c.active = false; c.mesh.visible = false; c.z = -999; }
  env.reset();
  updateHud();
}

function startRun() {
  resetRun();
  startScreen.classList.add('hidden');
  overScreen.classList.add('hidden');
  state = STATE.RUN;
}

function endRun() {
  state = STATE.OVER;
  player.state = 'hit';
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

function updateHud() {
  hudDistance.textContent = `${Math.floor(distance)} m`;
  hudCells.textContent = String(cellCount);
  hudScore.textContent = String(score);
}

// ---------------------------------------------------------------- input
function moveLane(dir) {
  if (state !== STATE.RUN || player.state === 'hit') return;
  player.lane = THREE.MathUtils.clamp(player.lane + dir, 0, 2);
  player.lean = -dir * 0.35;
}

function jump() {
  if (state !== STATE.RUN || player.state === 'hit') return;
  if (player.y > 0.02 || player.sliding) return;
  player.vy = 8.6;
  player.y = 0.03;
  player.state = 'jump';
}

function slide() {
  if (state !== STATE.RUN || player.state === 'hit') return;
  if (player.y > 0.02) {
    // fast-fall into a slide
    player.vy = -18;
    player.sliding = true;
    player.slideTimer = 0.7;
    return;
  }
  player.sliding = true;
  player.slideTimer = 0.7;
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
  const dt = performance.now() - touchStart.time;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (Math.max(absX, absY) < 26) {
    if (dt < 300) {
      if (state === STATE.MENU) startRun();
      else if (state === STATE.OVER) startRun();
      else jump();
    }
  } else if (absX > absY) {
    moveLane(dx > 0 ? 1 : -1);
  } else {
    if (dy < 0) jump();
    else slide();
  }
  touchStart = null;
}, { passive: true });

document.getElementById('playBtn').addEventListener('click', startRun);
document.getElementById('againBtn').addEventListener('click', startRun);

// ---------------------------------------------------------------- spawning
function spawnRow() {
  const difficulty = THREE.MathUtils.clamp(distance / 900, 0, 1);
  const freeLane = Math.floor(Math.random() * 3);
  const blocked = [0, 1, 2].filter((l) => l !== freeLane);
  const count = Math.random() < 0.45 + difficulty * 0.25 ? 2 : 1;

  for (let i = 0; i < count; i++) {
    const lane = blocked[i];
    const roll = Math.random();
    const type = roll < 0.42 ? 'barrier' : roll < 0.76 ? 'gate' : 'block';
    const o = acquireObstacle(type);
    if (!o) continue;
    o.lane = lane;
    o.z = -105 - Math.random() * 12;
    o.mesh.position.set(LANE_X[lane], OBSTACLE_TYPES[type].y, o.z);
  }

  // cell trail in the free lane
  if (Math.random() < 0.75) {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const c = acquireCell();
      if (!c) break;
      c.lane = freeLane;
      c.z = -112 - i * 4;
      c.mesh.position.set(LANE_X[freeLane], 1.15, c.z);
    }
  }
}

// ---------------------------------------------------------------- update
const clock = new THREE.Clock();

function updatePlayer(dt) {
  player.animTime += dt;

  // lane glide
  const targetX = LANE_X[player.lane];
  player.x += (targetX - player.x) * Math.min(1, dt * 14);
  player.lean += (0 - player.lean) * Math.min(1, dt * 8);

  // vertical
  if (player.y > 0 || player.vy !== 0) {
    player.vy -= 24 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      if (player.sliding) player.state = 'slide';
      else player.state = 'run';
    } else if (player.vy < 0 && player.y < 2.2 && player.sliding) {
      // fast-fall retains slide intent
      player.state = 'slide';
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

  if (player.hitTimer > 0) player.hitTimer -= dt;

  playerGroup.position.set(player.x, player.y, 0);
  playerGroup.rotation.z = player.lean;
  playerGroup.rotation.y = player.lean * 0.6;

  const speedRatio = (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
  animateCourier(courier, player.state, player.animTime, THREE.MathUtils.clamp(speedRatio, 0, 1));
}

function collides(o, type) {
  const laneMatch = o.lane === player.lane && Math.abs(player.x - LANE_X[o.lane]) < 1.5;
  const zMatch = Math.abs(o.z) < 1.6;
  if (!laneMatch || !zMatch) return false;

  // player capsule approximation
  const playerTop = player.sliding ? 0.95 : player.y + 1.9;
  const playerBottom = player.sliding ? 0 : player.y;

  if (type === 'barrier') {
    // low bar: cleared only by being airborne above it
    return playerBottom < 1.05;
  }
  if (type === 'gate') {
    // overhead gate: clear by sliding under it
    return !(player.sliding && player.y < 0.4);
  }
  // solid block: always
  return true;
}

function update(dt) {
  if (state !== STATE.RUN) {
    if (state === STATE.MENU) {
      // idle: character runs in place so the menu is alive
      player.animTime += dt;
      animateCourier(courier, 'run', player.animTime, 0.2);
      env.update(dt, 6);
    }
    return;
  }

  speed = Math.min(MAX_SPEED, BASE_SPEED + distance * 0.012);
  distance += speed * dt;
  score = Math.floor(distance) + cellCount * 25;

  env.update(dt, speed);
  updatePlayer(dt);

  // move + collide obstacles
  for (const pool of Object.values(obstaclePools)) {
    for (const o of pool) {
      if (!o.active) continue;
      o.z += speed * dt;
      o.mesh.position.z = o.z;

      if (collides(o, o.type)) {
        o.active = false;
        o.mesh.visible = false;
        o.z = -999;
        endRun();
        return;
      }
      if (o.z > 12) {
        o.active = false;
        o.mesh.visible = false;
        o.z = -999;
      }
    }
  }

  // cells
  for (const c of cells) {
    if (!c.active) continue;
    c.z += speed * dt;
    c.mesh.position.z = c.z;
    c.mesh.rotation.y += dt * 3;
    c.mesh.rotation.x += dt * 1.2;

    if (c.z > 10) { c.active = false; c.mesh.visible = false; c.z = -999; continue; }

    if (c.lane === player.lane && Math.abs(c.z) < 1.4 && Math.abs(player.y - 1.15) < 1.5) {
      c.active = false;
      c.mesh.visible = false;
      c.z = -999;
      cellCount++;
      score += 25;
    }
  }

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnRow();
    const gap = THREE.MathUtils.lerp(1.25, 0.72, THREE.MathUtils.clamp(distance / 1200, 0, 1));
    spawnTimer = gap;
  }

  updateHud();
  updateCamera(dt);
}

const camLook = new THREE.Vector3();
function updateCamera(dt) {
  const speedRatio = (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
  const back = 6.6 + speedRatio * 0.8;
  const height = 3.3 + speedRatio * 0.35;
  camera.position.x += (player.x * 0.55 - camera.position.x) * Math.min(1, dt * 6);
  camera.position.y += (height - camera.position.y) * Math.min(1, dt * 5);
  camera.position.z += (back - camera.position.z) * Math.min(1, dt * 5);

  camLook.set(player.x * 0.5, 1.35 + player.y * 0.35, -7);
  camera.lookAt(camLook);
}

// ---------------------------------------------------------------- loop
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// initial camera placement
camera.position.set(0, 3.3, 6.6);
camera.lookAt(0, 1.35, -7);
resetRun();
overScreen.classList.add('hidden');
frame();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
