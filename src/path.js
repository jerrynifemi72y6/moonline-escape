import * as THREE from 'three';

export const LANE_W = 2.6;
export const LANE_X = [-LANE_W, 0, LANE_W];
export const CORRIDOR_W = 8.6;

const HALF = Math.PI / 2;

// ---------------------------------------------------------------- helpers
function dirFor(yaw) {
  return new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
}
function rightFor(yaw) {
  return new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
}

function makeRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Batches many boxes into one geometry so a whole city block costs a single
 * draw call. Essential for keeping an Infinix Note 8 comfortably above 30fps.
 */
class Batcher {
  constructor() {
    this.pos = [];
    this.norm = [];
    this.col = [];
    this.idx = [];
    this.vertCount = 0;
    this.c = new THREE.Color();
  }

  box(cx, cy, cz, sx, sy, sz, color) {
    this.c.set(color);
    const r = this.c.r, g = this.c.g, b = this.c.b;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const faces = [
      [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]]],
      [[0, -1, 0], [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]]],
      [[0, 0, 1], [[-hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz], [hx, -hy, hz]]],
      [[0, 0, -1], [[hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
    ];

    for (const [n, verts] of faces) {
      const base = this.vertCount;
      for (const v of verts) {
        this.pos.push(cx + v[0], cy + v[1], cz + v[2]);
        this.norm.push(n[0], n[1], n[2]);
        this.col.push(r, g, b);
        this.vertCount++;
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  build(material) {
    if (!this.vertCount) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    return new THREE.Mesh(geo, material);
  }
}

const litMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });

// ---------------------------------------------------------------- path
export function createPath(scene, startS = 0) {
  const segments = [];
  const container = new THREE.Group();
  scene.add(container);

  let cursorS = startS;
  let yaw = 0;
  let origin = new THREE.Vector3(0, 0, 0);
  let rngSeed = 77213;
  let sinceTurn = 0;

  function addSegment() {
    const rng = makeRng(rngSeed++);
    const len = 68 + Math.floor(rng() * 36);
    sinceTurn++;
    const wantTurn = sinceTurn >= 2 && rng() < 0.9;
    const turn = wantTurn ? (rng() < 0.5 ? 'left' : 'right') : null;
    if (wantTurn) sinceTurn = 0;

    const seg = {
      startS: cursorS,
      len,
      yaw,
      origin: origin.clone(),
      turn,
      obstacles: [],
      cells: [],
      group: new THREE.Group(),
    };

    buildSegment(scene, seg, container, rng);
    segments.push(seg);

    cursorS += len;
    const d = dirFor(yaw);
    origin = origin.clone().addScaledVector(d, len);
    if (turn === 'left') yaw -= HALF;
    if (turn === 'right') yaw += HALF;
  }

  return {
    segments,
    ensureAhead(playerS, ahead = 280) {
      while (cursorS < playerS + ahead) addSegment();
    },
    prune(playerS) {
      for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i];
        if (seg.startS + seg.len < playerS - 70) {
          container.remove(seg.group);
          seg.group.clear();
          segments.splice(i, 1);
        }
      }
    },
    segmentAt(s) {
      for (const seg of segments) {
        if (s >= seg.startS && s < seg.startS + seg.len) return seg;
      }
      return segments[segments.length - 1];
    },
    positionAt(s, laneX, y = 0) {
      const seg = this.segmentAt(s);
      const local = s - seg.startS;
      const d = dirFor(seg.yaw);
      const r = rightFor(seg.yaw);
      return new THREE.Vector3(
        seg.origin.x + d.x * local + r.x * laneX,
        y,
        seg.origin.z + d.z * local + r.z * laneX
      );
    },
    yawAt(s) {
      return this.segmentAt(s).yaw;
    },
    reset() {
      for (const seg of segments) {
        container.remove(seg.group);
        seg.group.clear();
      }
      segments.length = 0;
      cursorS = 0;
      yaw = 0;
      origin = new THREE.Vector3(0, 0, 0);
      rngSeed = 77213;
      sinceTurn = 0;
    },
  };
}

// ---------------------------------------------------------------- segment
const BUILDING_COLORS = [0x2a3157, 0x343d6e, 0x242c4e, 0x3a2f63, 0x2c3a63];
const WINDOW_COLORS = [0xffd9a0, 0xfff1c4, 0x9fe8ff, 0xffb3e6, 0xb8ffe0];

function buildSegment(scene, seg, container, rng) {
  const g = seg.group;
  const len = seg.len;

  g.position.copy(seg.origin);
  g.rotation.y = -seg.yaw;
  container.add(g);

  const lit = new Batcher();   // lambert-shaded geometry
  const glow = new Batcher();  // self-lit neon

  // ---------- track bed
  lit.box(0, -0.35, -len / 2, CORRIDOR_W + 5.5, 0.7, len + 10, 0x0e1226);

  // gravel between rails
  lit.box(0, -0.02, -len / 2, CORRIDOR_W + 1.2, 0.08, len, 0x1a1f30);

  // sleepers
  for (let z = 0; z < len; z += 2.6) {
    lit.box(0, 0.06, -z, CORRIDOR_W + 0.6, 0.12, 0.55, 0x2a2318);
  }

  // rails for each lane
  for (const lx of LANE_X) {
    for (const off of [-0.72, 0.72]) {
      lit.box(lx + off, 0.14, -len / 2, 0.12, 0.14, len, 0x8b93a8);
      glow.box(lx + off, 0.22, -len / 2, 0.05, 0.03, len, 0x2be8ff);
    }
  }

  // platform edges
  for (const sx of [-1, 1]) {
    const px = sx * (CORRIDOR_W / 2 + 2.2);
    lit.box(px, 0.45, -len / 2, 3.6, 0.9, len, 0x161a2e);
    glow.box(px - sx * 1.8, 1.0, -len / 2, 0.12, 0.1, len, 0xff2e88);
  }

  // ---------- city
  for (let z = 0; z < len; z += 13) {
    for (const side of [-1, 1]) {
      if (rng() > 0.75) continue;
      const dist = 12 + rng() * 24;
      const w = 6 + rng() * 9;
      const h = 14 + rng() * 46;
      const bx = side * dist;
      const bz = -z - rng() * 8;
      const color = BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)];

      lit.box(bx, h / 2 - 1, bz, w, h, w, color);

      // roof edge neon
      if (rng() < 0.45) {
        const neon = rng() < 0.5 ? 0x00e5ff : 0xff2e88;
        glow.box(bx, h - 1, bz, w * 1.02, 0.35, w * 1.02, neon);
      }

      // lit floor bands facing the track
      const bands = 5 + Math.floor(rng() * 5);
      for (let b = 0; b < bands; b++) {
        const by = 3 + rng() * (h - 6);
        const wc = WINDOW_COLORS[Math.floor(rng() * WINDOW_COLORS.length)];
        glow.box(
          bx - side * (w / 2 + 0.05),
          by,
          bz,
          0.14,
          1.15,
          w * (0.6 + rng() * 0.35),
          wc
        );
      }

      // vertical signboard
      if (rng() < 0.3) {
        const signColor = [0x00e5ff, 0xff2e88, 0xffb02e, 0x8cff00][Math.floor(rng() * 4)];
        glow.box(bx - side * (w / 2 + 0.2), h * 0.6, bz + w * 0.3, 0.2, h * 0.35, 1.4, signColor);
      }
    }
  }

  // ---------- overhead gantries
  for (let z = 14; z < len; z += 34) {
    for (const sx of [-1, 1]) {
      lit.box(sx * (CORRIDOR_W / 2 + 4.2), 3.6, -z, 0.6, 7.2, 0.6, 0x222a45);
    }
    lit.box(0, 7.1, -z, CORRIDOR_W + 9.6, 0.55, 0.55, 0x2a3454);
    for (const lx of LANE_X) {
      glow.box(lx, 6.75, -z, 1.5, 0.18, 0.3, 0xfff0c0);
    }
  }

  // ---------- platform lamps
  for (let z = 8; z < len; z += 18) {
    for (const sx of [-1, 1]) {
      const px = sx * (CORRIDOR_W / 2 + 1.4);
      lit.box(px, 2.2, -z, 0.16, 4.4, 0.16, 0x2b3350);
      glow.box(px, 4.5, -z, 0.7, 0.24, 0.7, 0xfff2c8);
    }
  }

  // ---------- corner: parapet, chevrons, guide rail
  if (seg.turn) {
    lit.box(0, 0.55, -len - 0.2, CORRIDOR_W + 5.5, 1.1, 0.6, 0x1c2450);
    glow.box(0, 1.12, -len + 0.1, CORRIDOR_W + 5.2, 0.16, 0.12, 0xff2e88);

    for (let i = 0; i < 3; i++) {
      glow.box(
        (seg.turn === 'left' ? -1 : 1) * (1.2 + i * 1.6),
        2.4 + i * 0.12,
        -len + 0.35,
        1.35,
        1.35,
        0.14,
        i === 0 ? 0x00e5ff : 0x00b8d4
      );
    }

    const guideColor = seg.turn === 'left' ? 0xff2e88 : 0x8cff00;
    glow.box((seg.turn === 'left' ? -1 : 1) * (CORRIDOR_W / 2 - 0.3), 0.2, -len + 3.6, 0.16, 0.14, 7, guideColor);
  }

  // ---------- obstacles + trains + coins
  const safeStart = 24;
  const safeEnd = seg.turn ? len - 18 : len - 8;
  let z = safeStart;

  while (z < safeEnd) {
    const freeLane = Math.floor(rng() * 3);
    const laneSet = [0, 1, 2].filter((l) => l !== freeLane);
    const placed = [];
    const roll = rng();

    if (roll < 0.3) {
      // ---- parked train: long, unmissable, must change lane
      const lane = laneSet[Math.floor(rng() * laneSet.length)];
      const trainLen = 16 + rng() * 10;
      const trainZ = -z;
      const bodyColor = [0x2a3f6b, 0x4a2f5e, 0x24405a][Math.floor(rng() * 3)];
      lit.box(LANE_X[lane], 1.7, trainZ - trainLen / 2, 2.3, 3.4, trainLen, bodyColor);
      lit.box(LANE_X[lane], 3.35, trainZ - trainLen / 2, 2.0, 0.3, trainLen - 1.2, 0x11162a);
      // lit window strip
      for (let wz = 1.5; wz < trainLen - 1; wz += 2.2) {
        glow.box(LANE_X[lane] + 1.18, 2.5, trainZ - wz, 0.1, 0.7, 1.3, 0xffe9b0);
        glow.box(LANE_X[lane] - 1.18, 2.5, trainZ - wz, 0.1, 0.7, 1.3, 0xffe9b0);
      }
      // headlights
      glow.box(LANE_X[lane] - 0.6, 1.5, trainZ + 0.1, 0.35, 0.35, 0.2, 0xfff6d0);
      glow.box(LANE_X[lane] + 0.6, 1.5, trainZ + 0.1, 0.35, 0.35, 0.2, 0xfff6d0);

      seg.obstacles.push({ from: seg.startS + z, to: seg.startS + z + trainLen, lane, type: 'train' });
      placed.push(lane);
    } else {
      const count = rng() < 0.55 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const lane = laneSet[i];
        const t = roll < 0.55 ? 'barrier' : roll < 0.85 ? 'gate' : 'block';

        if (t === 'barrier') {
          lit.box(LANE_X[lane], 0.55, -z, 2.1, 1.1, 0.9, 0xff2e88);
          glow.box(LANE_X[lane], 1.15, -z, 2.1, 0.14, 0.95, 0xffe0ef);
          seg.obstacles.push({ from: seg.startS + z - 0.5, to: seg.startS + z + 0.5, lane, type: 'barrier' });
        } else if (t === 'gate') {
          for (const sx of [-1, 1]) {
            lit.box(LANE_X[lane] + sx * 1.0, 1.3, -z, 0.2, 2.6, 0.3, 0x333c5c);
          }
          lit.box(LANE_X[lane], 2.75, -z, 2.4, 0.5, 0.5, 0xffb02e);
          glow.box(LANE_X[lane], 3.05, -z, 2.2, 0.12, 0.55, 0xffd88a);
          seg.obstacles.push({ from: seg.startS + z - 0.4, to: seg.startS + z + 0.4, lane, type: 'gate' });
        } else {
          lit.box(LANE_X[lane], 1.35, -z, 2.2, 2.7, 1.5, 0x2b3566);
          glow.box(LANE_X[lane], 2.72, -z, 2.2, 0.12, 1.55, 0x00e5ff);
          seg.obstacles.push({ from: seg.startS + z - 0.8, to: seg.startS + z + 0.8, lane, type: 'block' });
        }
        placed.push(lane);
      }
    }

    // ---- coin arc in the free lane
    if (rng() < 0.85) {
      const n = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const cz = z + 2 + i * 2.6;
        const arc = Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 0.9;
        const coin = new THREE.Mesh(coinGeo, coinMat);
        coin.position.set(LANE_X[freeLane], 1.2 + arc, -cz);
        coin.rotation.x = Math.PI / 2;
        g.add(coin);
        seg.cells.push({ s: seg.startS + cz, lane: freeLane, mesh: coin, taken: false });
      }
    }

    z += 26 + rng() * 16;
  }

  const litMesh = lit.build(litMaterial);
  if (litMesh) g.add(litMesh);
  const glowMesh = glow.build(glowMaterial);
  if (glowMesh) g.add(glowMesh);
}

const coinGeo = new THREE.TorusGeometry(0.42, 0.14, 8, 14);
const coinMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
