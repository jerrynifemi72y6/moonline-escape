import * as THREE from 'three';

export const LANE_W = 2.4;
export const LANE_X = [-LANE_W, 0, LANE_W];
export const CORRIDOR_W = 9.6;

const HALF = Math.PI / 2;

// ---------------------------------------------------------------- helpers
function dirFor(yaw) {
  return new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
}
function rightFor(yaw) {
  return new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
}

const geoCache = {};
function box(w, h, d) {
  const k = `${w.toFixed(2)}_${h.toFixed(2)}_${d.toFixed(2)}`;
  if (!geoCache[k]) geoCache[k] = new THREE.BoxGeometry(w, h, d);
  return geoCache[k];
}
const matCache = {};
function mat(color) {
  if (!matCache[color]) matCache[color] = new THREE.MeshLambertMaterial({ color });
  return matCache[color];
}
const glowCache = {};
function glow(color) {
  if (!glowCache[color]) glowCache[color] = new THREE.MeshBasicMaterial({ color });
  return glowCache[color];
}

// seeded rng so a segment always looks the same once built
function makeRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---------------------------------------------------------------- path system
export function createPath(scene, startS = 0) {
  const segments = [];
  const container = new THREE.Group();
  scene.add(container);

  let cursorS = startS;
  let yaw = 0;
  let origin = new THREE.Vector3(0, 0, 0);
  let rngSeed = 20261;
  let sinceTurn = 0;

  function addSegment() {
    const rng = makeRng(rngSeed++);
    const len = 70 + Math.floor(rng() * 45);
    sinceTurn++;
    // first few segments run straight so the player can settle in
    const wantTurn = sinceTurn >= 2 && rng() < 0.85;
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

    // advance path cursor
    cursorS += len;
    const d = dirFor(yaw);
    origin = origin.clone().addScaledVector(d, len);
    if (turn === 'left') yaw -= HALF;
    if (turn === 'right') yaw += HALF;

    return seg;
  }

  return {
    segments,
    ensureAhead(playerS, ahead = 260) {
      while (cursorS < playerS + ahead) addSegment();
    },
    prune(playerS) {
      for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i];
        if (seg.startS + seg.len < playerS - 60) {
          container.remove(seg.group);
          disposeTree(seg.group);
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
    // world position for a point on the path
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
        disposeTree(seg.group);
      }
      segments.length = 0;
      cursorS = 0;
      yaw = 0;
      origin = new THREE.Vector3(0, 0, 0);
      rngSeed = 20261;
      sinceTurn = 0;
    },
  };
}

function disposeTree(obj) {
  // geometries/materials are shared via caches, so only detach
  obj.clear();
}

// ---------------------------------------------------------------- segment build
const OBSTACLE_SPECS = {
  barrier: { w: 1.7, h: 1.05, d: 1.0, color: 0xff2e88, y: 0.52 },
  gate: { w: 2.1, h: 1.5, d: 0.5, color: 0xffb02e, y: 2.25 },
  block: { w: 2.1, h: 2.7, d: 1.4, color: 0x2b3566, y: 1.35 },
};

function buildSegment(scene, seg, container, rng) {
  const g = seg.group;
  const len = seg.len;

  // place group at segment origin with its yaw
  g.position.copy(seg.origin);
  g.rotation.y = Math.atan2(Math.sin(seg.yaw), -Math.cos(seg.yaw)) + Math.PI;
  container.add(g);

  // ---- deck
  const deck = new THREE.Mesh(box(CORRIDOR_W + 1.6, 0.5, len + 8), mat(0x141a33));
  deck.position.set(0, -0.25, -len / 2);
  g.add(deck);

  // ---- edge rails
  for (const sx of [-(CORRIDOR_W / 2), CORRIDOR_W / 2]) {
    const rail = new THREE.Mesh(box(0.16, 0.07, len), glow(0x00e5ff));
    rail.position.set(sx, 0.06, -len / 2);
    g.add(rail);
  }

  // ---- lane dashes
  for (const dx of [-LANE_W / 2, LANE_W / 2]) {
    for (let z = 4; z < len; z += 6) {
      const dash = new THREE.Mesh(box(0.09, 0.02, 2.4), glow(0xffb02e));
      dash.position.set(dx, 0.03, -z);
      g.add(dash);
    }
  }

  // ---- pylons below the deck
  for (let z = 6; z < len; z += 22) {
    for (const sx of [-4.6, 4.6]) {
      const p = new THREE.Mesh(box(0.7, 26, 0.7), mat(0x0d1226));
      p.position.set(sx, -13.5, -z);
      g.add(p);
    }
  }

  // ---- city blocks on both sides
  for (let z = 0; z < len; z += 12) {
    for (const side of [-1, 1]) {
      if (rng() > 0.62) continue;
      const h = 10 + rng() * 34;
      const w = 5 + rng() * 7;
      const b = new THREE.Mesh(box(w, h, w), mat(rng() < 0.5 ? 0x0b1130 : 0x111a3d));
      b.position.set(side * (9 + rng() * 20), h / 2 - 12, -z - rng() * 6);
      g.add(b);

      // neon band on the facade
      if (rng() < 0.5) {
        const bandColor = rng() < 0.5 ? 0xff2e88 : 0x00e5ff;
        const band = new THREE.Mesh(box(w * 0.96, 0.3, 0.16), glow(bandColor));
        band.position.set(b.position.x, b.position.y + h * 0.22, b.position.z + w / 2 + 0.1);
        g.add(band);
      }
    }
  }

  // ---- corner: low parapet + floating chevrons (kept low so the chase
  // camera can swing through the bend without clipping into geometry)
  if (seg.turn) {
    const parapet = new THREE.Mesh(box(CORRIDOR_W + 1.6, 1.0, 0.5), mat(0x1c2450));
    parapet.position.set(0, 0.5, -len - 0.2);
    g.add(parapet);

    const stripe = new THREE.Mesh(box(CORRIDOR_W + 1.2, 0.18, 0.1), glow(0xff2e88));
    stripe.position.set(0, 1.0, -len + 0.05);
    g.add(stripe);

    // chevrons float above the parapet, pointing into the turn
    for (let i = 0; i < 3; i++) {
      const chev = new THREE.Mesh(box(1.4, 1.4, 0.12), glow(0x00e5ff));
      chev.position.set(
        (seg.turn === 'left' ? -1 : 1) * (1.0 + i * 1.5),
        2.3 + i * 0.15,
        -len + 0.3
      );
      chev.rotation.z = Math.PI / 4;
      chev.scale.setScalar(1 - i * 0.16);
      g.add(chev);
    }

    // guide rail sweeping into the turn so the corner direction reads instantly
    const guide = new THREE.Mesh(box(0.14, 0.12, 7), glow(seg.turn === 'left' ? 0xff2e88 : 0x8cff00));
    guide.position.set(
      (seg.turn === 'left' ? -1 : 1) * (CORRIDOR_W / 2 - 0.2),
      0.1,
      -len + 3.4
    );
    guide.rotation.y = (seg.turn === 'left' ? -1 : 1) * 0.6;
    g.add(guide);
  }

  // ---- obstacles (kept clear of the turn zone)
  const safeStart = 22;
  const safeEnd = seg.turn ? len - 16 : len - 6;
  let z = safeStart;
  while (z < safeEnd) {
    const roll = rng();
    const freeLane = Math.floor(rng() * 3);
    const maxCount = rng() < 0.5 ? 2 : 1;
    const lanes = [0, 1, 2].filter((l) => l !== freeLane).slice(0, maxCount);

    for (const lane of lanes) {
      const t = roll < 0.42 ? 'barrier' : roll < 0.76 ? 'gate' : 'block';
      const spec = OBSTACLE_SPECS[t];
      const m = new THREE.Mesh(box(spec.w, spec.h, spec.d), mat(spec.color));
      m.position.set(LANE_X[lane], spec.y, -z);
      g.add(m);

      const edge = new THREE.Mesh(box(spec.w * 0.95, 0.09, 0.09), glow(0x00e5ff));
      edge.position.set(0, spec.h / 2 - 0.07, 0);
      m.add(edge);

      seg.obstacles.push({ s: seg.startS + z, lane, type: t });
    }

    // cell trail in the free lane
    if (rng() < 0.7) {
      const n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(octa(), glow(0x8cff00));
        m.position.set(LANE_X[freeLane], 1.15, -(z + 3 + i * 3.4));
        m.userData.spin = true;
        g.add(m);
        seg.cells.push({ s: seg.startS + z + 3 + i * 3.4, lane: freeLane, mesh: m, taken: false });
      }
    }

    z += 15 + rng() * 12;
  }
}

let octaGeo = null;
function octa() {
  if (!octaGeo) octaGeo = new THREE.OctahedronGeometry(0.34, 0);
  return octaGeo;
}
