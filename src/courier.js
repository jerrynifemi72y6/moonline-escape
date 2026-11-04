import * as THREE from 'three';

/**
 * The courier: a low-poly figure built from primitives, rigged by hand.
 * Every limb is a pivot group so simple procedural animation reads clearly
 * on a small phone screen.
 */
export function createCourier() {
  const root = new THREE.Group();

  const suitDark = new THREE.MeshLambertMaterial({ color: 0x1b2140 });
  const suitMid = new THREE.MeshLambertMaterial({ color: 0x2b3566 });
  const accent = new THREE.MeshLambertMaterial({ color: 0x00e5ff });
  const visor = new THREE.MeshBasicMaterial({ color: 0x7df9ff });
  const packMat = new THREE.MeshLambertMaterial({ color: 0xff2e88 });

  // body pivot (lets us lean the whole figure)
  const body = new THREE.Group();
  root.add(body);

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.42), suitDark);
  pelvis.position.y = 0.95;
  body.add(pelvis);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.86, 0.46), suitMid);
  torso.position.y = 1.48;
  body.add(torso);

  // chest light strip
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.02), accent);
  strip.position.set(0, 1.62, 0.24);
  body.add(strip);

  // head
  const head = new THREE.Group();
  head.position.y = 2.06;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.4), suitMid);
  head.add(skull);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.03), visor);
  face.position.set(0, 0.02, 0.2);
  head.add(face);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.44), accent);
  hood.position.y = 0.24;
  head.add(hood);

  // energy pack
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.22), packMat);
  pack.position.set(0, 1.55, -0.3);
  body.add(pack);

  // arms (pivot at shoulder)
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.46, 1.82, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.22), suitMid);
    upper.position.y = -0.25;
    pivot.add(upper);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.44, 0.2), suitDark);
    fore.position.y = -0.7;
    pivot.add(fore);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.22), accent);
    cuff.position.y = -0.9;
    pivot.add(cuff);
    body.add(pivot);
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // legs (pivot at hip)
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.2, 0.92, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.26), suitDark);
    thigh.position.y = -0.25;
    pivot.add(thigh);
    const calf = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.44, 0.24), suitMid);
    calf.position.y = -0.7;
    pivot.add(calf);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.42), accent);
    boot.position.set(0, -0.95, 0.06);
    pivot.add(boot);
    body.add(pivot);
    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  root.traverse((o) => { if (o.isMesh) o.castShadow = false; });

  return {
    root,
    parts: { body, head, armL, armR, legL, legR },
  };
}

/**
 * Procedural animation. `state` drives which pose we blend toward:
 * run | jump | slide | hit
 */
export function animateCourier(courier, state, t, speedRatio) {
  const { body, head, armL, armR, legL, legR } = courier.parts;

  if (state === 'run') {
    const cycle = t * (6 + speedRatio * 6);
    const swing = Math.sin(cycle) * (0.7 + speedRatio * 0.35);

    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.85;
    armR.rotation.x = swing * 0.85;
    armL.rotation.z = 0.08;
    armR.rotation.z = -0.08;

    body.position.y = Math.abs(Math.sin(cycle)) * 0.07;
    body.rotation.x = -0.12 - speedRatio * 0.1;
    body.rotation.z = Math.sin(cycle * 0.5) * 0.03;
    head.rotation.x = 0.06;
    head.rotation.y = Math.sin(cycle * 0.35) * 0.06;
  } else if (state === 'jump') {
    legL.rotation.x = -0.9;
    legR.rotation.x = -0.55;
    armL.rotation.x = -2.2;
    armR.rotation.x = -2.0;
    armL.rotation.z = 0.35;
    armR.rotation.z = -0.35;
    body.position.y = 0;
    body.rotation.x = -0.2;
    body.rotation.z = 0;
    head.rotation.x = -0.12;
    head.rotation.y = 0;
  } else if (state === 'slide') {
    legL.rotation.x = 0.5;
    legR.rotation.x = 0.2;
    armL.rotation.x = 0.9;
    armR.rotation.x = 1.1;
    armL.rotation.z = 0.3;
    armR.rotation.z = -0.3;
    body.position.y = -0.55;
    body.rotation.x = 0.95;
    body.rotation.z = 0;
    head.rotation.x = -0.6;
    head.rotation.y = 0;
  } else if (state === 'hit') {
    const wobble = Math.sin(t * 30) * 0.12;
    legL.rotation.x = -0.4 + wobble;
    legR.rotation.x = 0.3 - wobble;
    armL.rotation.x = -2.6;
    armR.rotation.x = -2.4;
    armL.rotation.z = 0.6;
    armR.rotation.z = -0.6;
    body.position.y = 0.1;
    body.rotation.x = 0.55;
    body.rotation.z = wobble;
    head.rotation.x = 0.4;
    head.rotation.y = 0;
  }
}
