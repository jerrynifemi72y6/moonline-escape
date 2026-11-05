import * as THREE from 'three';

/**
 * Sky, moon and star field. Cheap: one gradient dome, one moon sprite,
 * one points cloud for stars. All static, so it costs nothing per frame.
 */
export function buildSky(scene) {
  // gradient dome
  const skyGeo = new THREE.SphereGeometry(400, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x1b1148) },
      midColor: { value: new THREE.Color(0x3b1f6e) },
      botColor: { value: new THREE.Color(0x0a0a1e) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 botColor;
      varying vec3 vWorld;
      void main() {
        float h = normalize(vWorld).y;
        vec3 c = mix(botColor, midColor, smoothstep(-0.1, 0.35, h));
        c = mix(c, topColor, smoothstep(0.25, 0.9, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // moon
  const moonCanvas = document.createElement('canvas');
  moonCanvas.width = moonCanvas.height = 256;
  const mctx = moonCanvas.getContext('2d');
  const grad = mctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,245,1)');
  grad.addColorStop(0.35, 'rgba(240,245,255,0.95)');
  grad.addColorStop(0.55, 'rgba(180,200,255,0.35)');
  grad.addColorStop(1, 'rgba(120,150,255,0)');
  mctx.fillStyle = grad;
  mctx.fillRect(0, 0, 256, 256);
  // faint craters
  mctx.fillStyle = 'rgba(200,210,235,0.5)';
  mctx.beginPath(); mctx.arc(105, 105, 12, 0, Math.PI * 2); mctx.fill();
  mctx.beginPath(); mctx.arc(150, 140, 18, 0, Math.PI * 2); mctx.fill();
  mctx.beginPath(); mctx.arc(120, 160, 9, 0, Math.PI * 2); mctx.fill();

  const moonTex = new THREE.CanvasTexture(moonCanvas);
  const moonMat = new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false });
  const moon = new THREE.Sprite(moonMat);
  moon.scale.set(120, 120, 1);
  moon.position.set(-150, 110, -300);
  scene.add(moon);

  // stars
  const starCount = 260;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 330;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.9 + 0.05);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.8 + 20;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xcfe0ff, size: 2.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 })
  );
  scene.add(stars);

  return { sky, moon, stars };
}
