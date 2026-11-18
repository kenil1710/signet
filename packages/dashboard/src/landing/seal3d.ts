// The 3D wax seal (from docs/design/landing-v2.html, unchanged in look). Loaded by main.ts after the first paint.
// It draws only while the tab is visible and the seal is showing (opacity > 0), and caps the pixel ratio at 2.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Seal } from './main.ts';

// Setup is split into short steps that give the main thread back in between, so a phone stays responsive.
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

export async function start(S: Seal, reduce: boolean): Promise<void> {
  const canvas = document.getElementById('seal-gl') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 8);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  await breathe();

  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch { /* no font API */ }

  /* ---- wax outline: a slightly uneven blob, like poured wax ---- */
  const Rf = (t: number) => 1 + 0.038 * Math.sin(5 * t + 1.3) + 0.024 * Math.sin(9 * t + 0.4) + 0.014 * Math.sin(14 * t + 2.1) + 0.008 * Math.sin(23 * t + 0.7);
  const OUT = 300;
  const outline: [number, number][] = Array.from({ length: OUT }, (_, i) => { const t = (i / OUT) * Math.PI * 2, r = Rf(t); return [r * Math.cos(t), r * Math.sin(t)]; });

  /* ---- impression texture, mapped in shape space (-1.2..1.2) ---- */
  const N = 1024, K = N / 2.4, C = N / 2;
  const sPath = new Path2D('M17.5 9.5c-.8-1.3-2.1-2-3.6-2-2.2 0-3.7 1.3-3.7 3.1 0 1.8 1.4 2.6 3.9 3.2 1.9.5 2.8 1 2.8 2.2 0 1.2-1.2 2-2.8 2-1.7 0-3-.8-3.6-2.1');
  function heightCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d')!;
    g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, N, N);
    // raised lip pushed up by the stamp
    const lip = g.createRadialGradient(C, C, K * 0.8, C, C, K * 1.0);
    lip.addColorStop(0, '#3c3c3c'); lip.addColorStop(0.25, '#2e2e2e'); lip.addColorStop(0.55, '#d8d8d8'); lip.addColorStop(1, '#8a8a8a');
    g.fillStyle = lip; g.beginPath(); g.arc(C, C, K * 1.05, 0, Math.PI * 2); g.fill();
    // flat pressed field
    g.fillStyle = '#5a5a5a'; g.beginPath(); g.arc(C, C, K * 0.8, 0, Math.PI * 2); g.fill();
    g.filter = 'blur(2px)';
    // dotted ring
    g.fillStyle = '#d0d0d0';
    for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; g.beginPath(); g.arc(C + Math.cos(a) * K * 0.53, C + Math.sin(a) * K * 0.53, K * 0.012, 0, Math.PI * 2); g.fill(); }
    // lettering
    const txt = 'SIGNET · SEALED ON X LAYER · RELEASE 42 · ';
    g.font = `700 ${Math.round(K * 0.085)}px "Archivo Variable", Archivo, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const step = (Math.PI * 2) / txt.length;
    for (let i = 0; i < txt.length; i++) { const a = -Math.PI / 2 + i * step; g.save(); g.translate(C + Math.cos(a) * K * 0.67, C + Math.sin(a) * K * 0.67); g.rotate(a + Math.PI / 2); g.fillText(txt[i]!, 0, 0); g.restore(); }
    // the S
    g.save(); g.translate(C, C); const sc = K * 0.075; g.scale(sc, sc); g.translate(-13.85, -13.5);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3.4; g.lineCap = 'round'; g.stroke(sPath); g.restore();
    g.filter = 'none';
    return cv;
  }
  /// wax grain, a band of rows at a time
  async function grain(cv: HTMLCanvasElement): Promise<void> {
    const g = cv.getContext('2d')!, band = 128;
    for (let y = 0; y < N; y += band) {
      const img = g.getImageData(0, y, N, band), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 10; d[i]! += n; d[i + 1]! += n; d[i + 2]! += n; }
      g.putImageData(img, 0, y);
      await breathe();
    }
  }
  const hc = heightCanvas();
  await breathe();
  await grain(hc);
  const bump = new THREE.CanvasTexture(hc);
  bump.repeat.set(1 / 2.4, 1 / 2.4); bump.offset.set(0.5, 0.5); bump.anisotropy = 8;

  const wax = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#9E2416'), roughness: 0.46, metalness: 0,
    bumpMap: bump, bumpScale: 4.5,
    clearcoat: 0.35, clearcoatRoughness: 0.35,
    sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ff7a5c'),
    envMapIntensity: 0.55,
  });
  const waxSide = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#8E1F13'), roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new THREE.Color('#ff7a5c'), envMapIntensity: 0.6 });
  const innerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6a36'), side: THREE.DoubleSide, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

  const EX = { depth: 0.12, bevelEnabled: true, bevelThickness: 0.085, bevelSize: 0.07, bevelOffset: -0.07, bevelSegments: 7, curveSegments: 1, steps: 1 };
  function shapeOf(pts: [number, number][]): THREE.Shape { const s = new THREE.Shape(); s.moveTo(pts[0]![0], pts[0]![1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i]![0], pts[i]![1]); s.closePath(); return s; }
  function extrude(pts: [number, number][]): THREE.ExtrudeGeometry { const g = new THREE.ExtrudeGeometry(shapeOf(pts), EX); g.translate(0, 0, -EX.depth / 2); return g; }

  const seal = new THREE.Group();
  const intact = new THREE.Mesh(extrude(outline), [wax, waxSide]);
  seal.add(intact);
  await breathe();

  /* ---- shards: cracks run from an off-centre point to the edge ---- */
  let rs = 11; const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  const c0: [number, number] = [0.07, -0.05];
  const angs = [0.25, 1.12, 1.95, 2.8, 3.62, 4.45, 5.4];
  const cracks = angs.map((a) => {
    const idx = Math.round((a / (Math.PI * 2)) * OUT) % OUT, end = outline[idx]!, pts: [number, number][] = [];
    const steps = 7, dx = end[0] - c0[0], dy = end[1] - c0[1], len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    for (let j = 1; j < steps; j++) { const t = j / steps, jit = (rnd() - 0.5) * 0.11 * Math.sin(t * Math.PI); pts.push([c0[0] + dx * t + nx * jit, c0[1] + dy * t + ny * jit]); }
    return { idx, pts };
  });
  const shards = new THREE.Group(); shards.visible = false; seal.add(shards);
  const shardData: { m: THREE.Mesh; dir: THREE.Vector2; z: number; rx: number; ry: number; rz: number; d: number }[] = [];
  for (let k = 0; k < cracks.length; k++) {
    const A = cracks[k]!, B = cracks[(k + 1) % cracks.length]!;
    const poly: [number, number][] = [c0, ...A.pts];
    let i = A.idx; const stop = B.idx; let guard = 0;
    while (i !== stop && guard++ < OUT) { poly.push(outline[i]!); i = (i + 1) % OUT; }
    poly.push(outline[stop]!);
    poly.push(...B.pts.slice().reverse());
    const m = new THREE.Mesh(extrude(poly), [wax, waxSide]);
    let cx = 0, cy = 0; poly.forEach((p) => { cx += p[0]; cy += p[1]; }); cx /= poly.length; cy /= poly.length;
    const dir = new THREE.Vector2(cx - c0[0], cy - c0[1]).normalize();
    shardData.push({ m, dir, z: (rnd() - 0.5) * 0.16, rx: (rnd() - 0.5) * 0.22, ry: (rnd() - 0.5) * 0.22, rz: (rnd() - 0.5) * 0.08, d: 0.07 + rnd() * 0.06 });
    shards.add(m);
    await breathe();
  }
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.86, 64), innerMat); seal.add(core);
  const coreLight = new THREE.PointLight(0xff5a2e, 0, 6); coreLight.position.set(0, 0, 0.4); seal.add(coreLight);
  scene.add(seal);

  /* lighting: warm key, red rim, cool kicker */
  const key = new THREE.DirectionalLight(0xfff1e6, 3.2); key.position.set(-3, 4, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff5533, 2.4); rim.position.set(4, -2, -3); scene.add(rim);
  const kick = new THREE.DirectionalLight(0xa9b8ff, 0.7); kick.position.set(5, 3, 2); scene.add(kick);
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));

  const mouse = { x: 0, y: 0 }, sm = { x: 0, y: 0 }; let shake = 0;
  addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });
  S.thud = () => { shake = 1; };

  function size(): void { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  size(); addEventListener('resize', size);

  const clock = new THREE.Clock();
  // compile the shaders off the main thread where the browser allows it, for both the whole and the broken seal
  shards.visible = true;
  try { await renderer.compileAsync(scene, camera); } catch { /* falls back to compiling on first render */ }
  shards.visible = false;
  await breathe();
  renderer.render(scene, camera);
  S.ready = true;

  // The frame loop stops while the tab is hidden; it skips drawing while the seal is faded out (opacity 0).
  let raf = 0;
  function frame(): void {
    raf = 0;
    if (document.hidden) return;
    const t = clock.getElapsedTime();
    canvas.style.opacity = String(S.opacity);
    if (S.opacity > 0.01) {
      const vh = 2 * Math.tan(THREE.MathUtils.degToRad(15)) * 8, vw = vh * camera.aspect;
      const base = S.mobile ? Math.min(0.8, vw / 3) : Math.min(1, vw / 5.6);
      shake *= 0.9;
      seal.position.set(S.x * vw + (Math.random() - 0.5) * 0.05 * shake, S.y * vh + (Math.random() - 0.5) * 0.05 * shake, 0);
      seal.scale.setScalar(Math.max(0.0001, S.scale * base));
      sm.x += (mouse.x - sm.x) * 0.05; sm.y += (mouse.y - sm.y) * 0.05;
      const idle = reduce ? 0 : 1;
      seal.rotation.x = -0.18 + S.tilt * 0.5 + Math.sin(t * 0.4) * 0.06 * idle + sm.y * 0.35;
      seal.rotation.y = 0.22 + Math.sin(t * 0.33) * 0.14 * idle + sm.x * 0.5 + S.spin;
      seal.rotation.z = Math.sin(t * 0.22) * 0.03 * idle - S.tilt * 0.15;
      const c = S.crack;
      intact.visible = c < 0.003; shards.visible = !intact.visible;
      if (shards.visible) shardData.forEach((s) => { s.m.position.set(s.dir.x * s.d * c, s.dir.y * s.d * c, s.z * c); s.m.rotation.set(s.rx * c, s.ry * c, s.rz * c); });
      innerMat.opacity = Math.min(1, c * 1.6);
      coreLight.intensity = c * 9;
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !raf) raf = requestAnimationFrame(frame); });
  raf = requestAnimationFrame(frame);
}
