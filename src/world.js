import * as THREE from 'three';

export const LANE_X = [-2.4, 0, 2.4];
export const TRACK_WIDTH = 9;

/**
 * Milestone 1 environment: an elevated railway ribbon that streams toward the
 * player. Ground modules and rail posts are pooled and recycled, never rebuilt.
 * Scenery, skyline and the chase drone arrive in Milestone 2.
 */
export function buildEnvironment(scene) {
  scene.background = new THREE.Color(0x0a1026);
  scene.fog = new THREE.Fog(0x0a1026, 45, 115);

  const hemi = new THREE.HemisphereLight(0x6b8cff, 0x120f2e, 1.15);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xbfd4ff, 1.35);
  moon.position.set(-18, 30, 14);
  scene.add(moon);

  const rim = new THREE.DirectionalLight(0xff2e88, 0.6);
  rim.position.set(16, 10, -22);
  scene.add(rim);

  const MODULE_LEN = 40;
  const MODULE_COUNT = 5;

  const deckGeo = new THREE.BoxGeometry(TRACK_WIDTH + 3, 0.5, MODULE_LEN);
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x141a33 });
  const stripGeo = new THREE.BoxGeometry(0.16, 0.06, MODULE_LEN);
  const cyanMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  const amberMat = new THREE.MeshBasicMaterial({ color: 0xffb02e });

  const modules = [];
  for (let i = 0; i < MODULE_COUNT; i++) {
    const g = new THREE.Group();

    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.y = -0.25;
    g.add(deck);

    // lane dividers (amber dashes on the deck)
    const dashGeo = new THREE.BoxGeometry(0.08, 0.02, 2.2);
    for (const dx of [-1.2, 1.2]) {
      for (let d = 0; d < 8; d++) {
        const dash = new THREE.Mesh(dashGeo, amberMat);
        dash.position.set(dx, 0.02, -MODULE_LEN / 2 + 2.5 + d * 5);
        g.add(dash);
      }
    }

    // edge rails glowing cyan
    for (const sx of [-(TRACK_WIDTH / 2), TRACK_WIDTH / 2]) {
      const strip = new THREE.Mesh(stripGeo, cyanMat);
      strip.position.set(sx, 0.06, 0);
      g.add(strip);
    }

    g.position.z = -i * MODULE_LEN;
    scene.add(g);
    modules.push(g);
  }

  // support pylons so the railway reads as elevated
  const pylonGeo = new THREE.BoxGeometry(0.7, 26, 0.7);
  const pylonMat = new THREE.MeshLambertMaterial({ color: 0x0d1226 });
  const pylons = [];
  for (let i = 0; i < 10; i++) {
    for (const sx of [-4.6, 4.6]) {
      const p = new THREE.Mesh(pylonGeo, pylonMat);
      p.position.set(sx, -13.5, -i * 20 - 5);
      scene.add(p);
      pylons.push(p);
    }
  }

  // distant skyline blocks (simple silhouettes, no shadows)
  const towerMat = new THREE.MeshLambertMaterial({ color: 0x0b1130 });
  const towers = [];
  const towerGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 34; i++) {
    const h = 12 + Math.random() * 42;
    const t = new THREE.Mesh(towerGeo, towerMat);
    const side = Math.random() < 0.5 ? -1 : 1;
    t.scale.set(4 + Math.random() * 8, h, 4 + Math.random() * 8);
    t.position.set(side * (16 + Math.random() * 34), h / 2 - 12, -Math.random() * 260);
    scene.add(t);
    towers.push(t);
  }

  return {
    modules,
    update(dt, speed) {
      const farZ = -(MODULE_COUNT - 1) * MODULE_LEN;
      for (const m of modules) {
        m.position.z += speed * dt;
        if (m.position.z > MODULE_LEN) m.position.z = farZ + (m.position.z - MODULE_LEN);
      }
      const travel = speed * dt;
      for (const p of pylons) {
        p.position.z += travel;
        if (p.position.z > 20) p.position.z -= 200;
      }
      for (const t of towers) {
        t.position.z += travel * 0.35;
        if (t.position.z > 40) t.position.z -= 280;
      }
    },
    reset() {
      modules.forEach((m, i) => { m.position.z = -i * MODULE_LEN; });
      pylons.forEach((p, i) => { p.position.z = -Math.floor(i / 2) * 20 - 5; });
    },
  };
}
