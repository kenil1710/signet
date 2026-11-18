// Responsive + reduced-motion check of the built landing page, with screenshots into docs/demo/site/.
//   npx vite build && npx vite preview --port 4300 &  node test/site-check.ts [http://localhost:4300/]
// Fails on: a page error, any request to another host (no CDN), sideways scroll, or text cut off at the right edge.
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL0 = process.argv[2] ?? 'http://localhost:4300/';
const OUT = fileURLToPath(new URL('../../../docs/demo/site/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const problems: string[] = [];

async function overflow(page: Page, tag: string) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const cut: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest('.mq-track, canvas, #loader, .bigword, .h-track, [aria-hidden="true"]')) continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (b.right > vw + 1 && el.children.length === 0 && (el.textContent ?? '').trim()) cut.push(`${el.tagName.toLowerCase()}.${el.className}: "${el.textContent!.trim().slice(0, 40)}" right=${Math.round(b.right)}`);
    }
    return { sw: document.documentElement.scrollWidth, vw, cut: cut.slice(0, 8) };
  });
  if (r.sw > r.vw) problems.push(`${tag}: sideways scroll (scrollWidth ${r.sw} > ${r.vw})`);
  for (const c of r.cut) problems.push(`${tag}: cut off ${c}`);
}

async function run(width: number, height: number, reduced: boolean) {
  const tag = `${width}${reduced ? '-reduced-motion' : ''}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference', deviceScaleFactor: 1 /* full-page pictures over 16,384 px tall come out blank in Chromium */ });
  const page = await ctx.newPage();
  const origin = new globalThis.URL(URL0).origin;
  page.on('pageerror', (e) => problems.push(`${tag}: page error ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${tag}: console ${m.text()}`));
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push(`${tag}: outside request ${r.url()}`); });
  await page.goto(URL0, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('loader') || getComputedStyle(document.getElementById('loader')!).display === 'none', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const full = width < 960 || reduced;
  if (full) {
    // stacked layout: walk down so scroll-triggered pieces run, then one full-page picture
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += height / 2) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(120); await overflow(page, `${tag}@${y}`); }
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}${tag}-full.png`, fullPage: true });
  } else {
    // pinned scenes: one picture per scene, at the scroll position where it is on screen
    const spots = await page.evaluate(() => {
      const top = (q: string) => { const e = document.querySelector(q); return e ? e.getBoundingClientRect().top + window.scrollY : 0; };
      const vh = window.innerHeight;
      return [['1-hero-sealed', 0], ['2-hero-tampered', vh * 1.1], ['3-hero-blocked', vh * 2.1], ['4-attack-diff', top('.atk-pin') + vh * 1.4], ['5-attack-blocked', top('.atk-pin') + vh * 3.2],
        ['6-how', top('.h-pin') + vh * 0.6], ['7-rule', top('#rule')], ['8-bench', top('#bench')], ['9-proof', top('#proof')], ['10-teams', top('#teams')], ['11-cta', top('#cta') + vh * 0.2]] as [string, number][];
    });
    for (const [name, y] of spots) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await page.waitForTimeout(name === '9-proof' ? 4500 : 1600);
      await overflow(page, `${tag}/${name}`);
      await page.screenshot({ path: `${OUT}${tag}-${name}.png` });
    }
  }
  await browser.close();
}

// old dashboard addresses on the home page still reach the dashboard
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const h of ['#/prove', '#/p/demoswap.localhost']) {
    await page.goto(URL0 + h);
    await page.waitForURL(/app\.html#\//, { timeout: 5000 }).catch(() => {});
    if (!page.url().endsWith('app.html' + h)) problems.push(`${h}: not redirected to app.html (at ${page.url()})`);
  }
  await browser.close();
}
await run(390, 844, false);
await run(768, 1024, false);
await run(1280, 800, false);
await run(1440, 900, false);
await run(1280, 800, true);
await run(390, 844, true);
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log('site check: no page errors, no outside requests, no sideways scroll, nothing cut off at 390/768/1280/1440 and with reduced motion');
