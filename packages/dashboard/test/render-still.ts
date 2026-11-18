// Renders the seal's still image from the real 3D scene: loads the built page, waits for the live WebGL seal,
// poses it at rest (no crack, no tilt), hides everything else, captures it on a transparent background and
// encodes a WebP under 60 KB into src/landing/seal-still.webp. Rebuild afterwards.
//   npx vite build && npx vite preview --port 4300 &  node test/render-still.ts [http://localhost:4300/]
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const URL0 = process.argv[2] ?? 'http://localhost:4300/';
const OUT = fileURLToPath(new URL('../src/landing/seal-still.webp', import.meta.url));
const EXTENT = 2.6; // world units across the image; must match STILL_EXTENT in src/landing/main.ts
const SIZE = 640, MAX = 60_000;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const W = 1440, H = 900;
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.goto(URL0, { waitUntil: 'load' });
await page.waitForFunction(() => (window as any).SEAL?.ready && (window as any).SEAL.fade === 1, null, { timeout: 30000 });
await page.waitForTimeout(3000); // the intro has finished
await page.evaluate(() => {
  Object.assign((window as any).SEAL, { x: 0, y: 0, scale: 1, opacity: 1, tilt: 0, spin: 0, crack: 0 });
  for (const el of document.body.children) if (el.id !== 'seal-gl') (el as HTMLElement).style.visibility = 'hidden';
  document.documentElement.style.background = document.body.style.background = 'transparent';
  // the page's film-grain overlay (body::after) is not part of the seal
  const st = document.createElement('style'); st.textContent = 'body::after,body::before{display:none!important}'; document.head.append(st);
});
await page.waitForTimeout(500);
const px = H / (2 * Math.tan((15 * Math.PI) / 180) * 8); // CSS px per world unit at the seal (base = 1 at 1440×900)
const side = EXTENT * px;
const png = await page.screenshot({ omitBackground: true, clip: { x: W / 2 - side / 2, y: H / 2 - side / 2, width: side, height: side } });
// encode with cwebp (brew install webp), lowering quality until it fits; alpha is compressed lossy too
const tmp = join(mkdtempSync(join(tmpdir(), 'seal-')), 'seal.png');
writeFileSync(tmp, png);
if (process.env.KEEP_PNG) writeFileSync(process.env.KEEP_PNG, png);
let done = '';
for (let q = 88; q >= 40 && !done; q -= 4) {
  const r = spawnSync('cwebp', ['-quiet', '-q', String(q), '-alpha_q', '80', '-m', '6', '-sharp_yuv', '-resize', String(SIZE), String(SIZE), tmp, '-o', OUT]);
  if (r.status !== 0) throw new Error(`cwebp failed: ${r.stderr}`);
  const n = statSync(OUT).size;
  if (n <= MAX) done = `seal-still.webp: ${SIZE}×${SIZE}, quality ${q}, ${n} bytes`;
}
if (!done) throw new Error('could not fit under 60 KB');
console.log(done);
await browser.close();
