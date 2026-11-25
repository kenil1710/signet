// Signet landing page. The markup, copy, motion and section order come from docs/design/landing-v2.html (approved,
// final). This file is that design's script, ported to npm modules (gsap 3.12.5 + ScrollTrigger, lenis 1.1.13,
// three 0.160.0 in seal3d.ts), with four build changes:
//   1. the policy simulator looks every answer up in circuit #6's truth table (sim.ts), not in page code
//   2. the proof terminal shows lines copied from a real `pnpm verify:claims` run (verify-output.ts)
//   3. links come from one config file (config.ts)
//   4. performance: the 3D seal starts after first paint and stops drawing when hidden; so does the gates canvas
import './landing.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { expected as POLICY_TABLE } from '@signet/circuit/artifacts/policy.json';
import { makeSim, INPUT_NAMES, type SimState } from './sim.ts';
import { VERIFY_OUTPUT } from './verify-output.ts';

export interface Seal { x: number; y: number; scale: number; opacity: number; spin: number; tilt: number; crack: number; ready: boolean; mobile: boolean; fade: number; thud?: () => void }
declare global {
  interface Window { SEAL: Seal }
}
const S: Seal = (window.SEAL = { x: 0, y: 0.03, scale: 0, opacity: 1, spin: 0, tilt: 0, crack: 0, ready: false, mobile: window.innerWidth < 960, fade: 0 });
if (S.mobile) S.y = (window.innerHeight / 2 - 240) / window.innerHeight;

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement = HTMLElement>(q: string, r: ParentNode = document) => r.querySelector<T>(q)!;
const $$ = <T extends HTMLElement = HTMLElement>(q: string, r: ParentNode = document) => Array.from(r.querySelectorAll<T>(q));


// The 3D seal starts after the first paint, so it never delays the text. (Two frames: the first runs before paint.)
// The seal shows at once as a still image rendered from the real 3D scene (test/render-still.ts), placed and sized
// exactly where the 3D seal draws. The live WebGL seal starts when the browser is idle after load (on touch
// devices: on the first touch or scroll), then the image
// fades into it. Reduced motion: the still image only, no WebGL.
const still = $<HTMLImageElement>('#seal-still');
const STILL_EXTENT = 2.6; // world units across the image; must match test/render-still.ts
let stillAlpha = 1;
function placeStill(): void {
  const W = window.innerWidth, H = window.innerHeight;
  const vhw = 2 * Math.tan((15 * Math.PI) / 180) * 8, vww = (vhw * W) / H; // the camera's view at the seal (fov 30, z 8)
  const base = S.mobile ? Math.min(0.8, vww / 3) : Math.min(1, vww / 5.6);
  const size = STILL_EXTENT * Math.max(0, S.scale) * base * (H / vhw);
  const cx = W / 2 + S.x * W, cy = H / 2 - S.y * H;
  still.style.width = still.style.height = `${size}px`;
  still.style.transform = `translate3d(${cx - size / 2}px, ${cy - size / 2}px, 0)`;
  still.style.opacity = String(S.opacity * stillAlpha);
}
let stillRaf = 0;
const followStill = () => { placeStill(); stillRaf = stillAlpha > 0 ? requestAnimationFrame(followStill) : 0; };
if (reduce) {
  placeStill();
  window.addEventListener('scroll', placeStill, { passive: true });
  window.addEventListener('resize', placeStill);
} else {
  followStill();
  const goLive = () => void import('./seal3d.ts').then((m) => m.start(S)).then(() => {
    const f = { v: 0 };
    gsap.to(f, { v: 1, duration: 0.8, ease: 'power2.inOut', onUpdate: () => { S.fade = f.v; stillAlpha = 1 - f.v; },
      onComplete: () => { stillAlpha = 0; still.style.display = 'none'; cancelAnimationFrame(stillRaf); } });
  }).catch(() => { /* no WebGL: the still image stays */ });
  const whenIdle = () => ('requestIdleCallback' in window ? requestIdleCallback(goLive, { timeout: 2000 }) : setTimeout(goLive, 200));
  if (window.matchMedia('(pointer: coarse)').matches) {
    // touch devices: the shader compile is a long task on a phone, so it waits for the first touch or scroll
    // (the still image covers the wait); desktop starts on idle
    const events = ['touchstart', 'pointerdown', 'scroll', 'keydown'] as const;
    const first = () => { events.forEach((t) => window.removeEventListener(t, first)); goLive(); };
    events.forEach((t) => window.addEventListener(t, first, { passive: true }));
  } else if (document.readyState === 'complete') requestAnimationFrame(whenIdle);
  else window.addEventListener('load', () => requestAnimationFrame(whenIdle), { once: true });
}

/* hero lines always fit the screen, whatever font width loads */
function fitHero(): void {
  if (window.innerWidth < 960) {
    $$('.h-l1,.h-l2').forEach((el) => (el.style.fontSize = ''));
    return;
  }
  ([['.h-l1', 0.74, 72], ['.h-l2', 0.9, 150]] as const).forEach(([q, share, max]) => {
    const el = $(q);
    el.style.fontSize = '100px';
    const spans = $$(':scope > span', el);
    const a = spans[0]!.getBoundingClientRect();
    const b = spans[spans.length - 1]!.getBoundingClientRect();
    const w = b.right - a.left;
    if (!w) return;
    el.style.fontSize = Math.min(max, (100 * (window.innerWidth * share)) / w) + 'px';
  });
}
fitHero();
if (document.fonts) void document.fonts.ready.then(() => { fitHero(); ScrollTrigger.refresh(); });
window.addEventListener('resize', fitHero);

/* header turns solid after the hero */
const hdr = $('#hdr');
const onScroll = () => hdr.classList.toggle('solid', window.scrollY > window.innerHeight * 2.2 || (S.mobile && window.scrollY > 40));
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- policy simulator: answers from circuit #6's truth table ---------- */
const sim = makeSim(POLICY_TABLE);
const st: SimState = { a: true, b: false, c: false, tier: 0, wait: 1, f: false, e: false };
const bitsEl = $('#bits');
bitsEl.innerHTML = INPUT_NAMES.map((n) => `<div class="bit"><small>${n}</small><b>0</b></div>`).join('');
const gates = (function () {
  const cv = $<HTMLCanvasElement>('#gates');
  const ctx = cv.getContext('2d')!;
  type Node = { x: number; y: number; l: number; i: number };
  let W = 0, H = 0, nodes: Node[] = [], edges: { a: Node; b: Node }[] = [], pulses: { e: { a: Node; b: Node }; t: number; v: number; c: string }[] = [];
  let outState = { pub: false, unf: false }, inBits: boolean[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const layers = [9, 8, 8, 7, 6, 5, 2];
  function build(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed = 7; nodes = []; edges = [];
    layers.forEach((n, li) => { const x = 18 + (li * (W - 36)) / (layers.length - 1); for (let i = 0; i < n; i++) nodes.push({ x, y: 14 + ((i + 0.5) * (H - 28)) / n, l: li, i }); });
    const byL = (l: number) => nodes.filter((n) => n.l === l);
    for (let l = 1; l < layers.length; l++) byL(l).forEach((n) => { const prev = byL(l - 1); for (let k = 0; k < 2; k++) edges.push({ a: prev[Math.floor(rnd() * prev.length)]!, b: n }); });
  }
  // drawn only while the canvas is on screen and the tab is visible
  let visible = false, raf = 0;
  function draw(): void {
    raf = 0;
    paint();
    loop();
  }
  function paint(): void {
    ctx.clearRect(0, 0, W, H);
    edges.forEach((e) => { ctx.strokeStyle = 'rgba(255,240,230,.07)'; ctx.lineWidth = 1; ctx.beginPath(); const mx = (e.a.x + e.b.x) / 2; ctx.moveTo(e.a.x, e.a.y); ctx.bezierCurveTo(mx, e.a.y, mx, e.b.y, e.b.x, e.b.y); ctx.stroke(); });
    pulses = pulses.filter((p) => p.t < 1);
    pulses.forEach((p) => { p.t += p.v; if (p.t < 0) return; const e = p.e, u = p.t, mx = (e.a.x + e.b.x) / 2;
      const bx = (1 - u) ** 3 * e.a.x + 3 * (1 - u) ** 2 * u * mx + 3 * (1 - u) * u * u * mx + u ** 3 * e.b.x, by = (1 - u) ** 3 * e.a.y + 3 * (1 - u) ** 2 * u * e.a.y + 3 * (1 - u) * u * u * e.b.y + u ** 3 * e.b.y;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, 7); g.addColorStop(0, p.c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill(); });
    nodes.forEach((n) => {
      if (n.l === 0) { ctx.fillStyle = inBits[n.i] ? '#F2EDE9' : '#2A2522'; ctx.beginPath(); ctx.arc(n.x, n.y, 4, 0, Math.PI * 2); ctx.fill(); }
      else if (n.l === layers.length - 1) { const on = n.i === 0 ? outState.pub : outState.unf; ctx.fillStyle = on ? '#5AD9A0' : '#2A2522'; if (on) { ctx.shadowColor = '#5AD9A0'; ctx.shadowBlur = 16; } ctx.beginPath(); ctx.arc(n.x, n.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
      else { ctx.fillStyle = '#0B0A09'; ctx.strokeStyle = '#4A423D'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(n.x - 6, n.y - 6); ctx.lineTo(n.x, n.y - 6); ctx.arc(n.x, n.y, 6, -Math.PI / 2, Math.PI / 2); ctx.lineTo(n.x - 6, n.y + 6); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    });
  }
  const loop = () => { if (visible && !document.hidden && !raf) raf = requestAnimationFrame(draw); };
  new IntersectionObserver(([en]) => { visible = !!en?.isIntersecting; loop(); }).observe(cv);
  document.addEventListener('visibilitychange', loop);
  function pulse(r: { bits: boolean[]; pub: boolean; unf: boolean }): void {
    inBits = r.bits; outState = { pub: r.pub, unf: r.unf };
    if (!reduce) edges.forEach((e) => { pulses.push({ e, t: -(e.b.l * 0.24) - Math.random() * 0.15, v: 0.035, c: e.a.l === 0 && !inBits[e.a.i] ? 'rgba(130,120,115,.45)' : 'rgba(214,61,39,.95)' }); });
    if (visible) loop();
    else paint(); // off screen: show the new state without animating it
  }
  // resizing a canvas clears it, so paint the current state again right away
  const rebuild = () => { build(); paint(); };
  rebuild();
  window.addEventListener('resize', rebuild);
  return { pulse };
})();
function renderSim(): void {
  const r = sim.run(st);
  $$('.bit', bitsEl).forEach((el, i) => { el.classList.toggle('on', r.bits[i]!); el.querySelector('b')!.textContent = r.bits[i] ? '1' : '0'; });
  $('#oPub').classList.toggle('on', r.pub); $('#oPubV').textContent = r.pub ? '1' : '0';
  $('#oUnf').classList.toggle('on', r.unf); $('#oUnfV').textContent = r.unf ? '1' : '0';
  $('#why').textContent = r.why;
  gates.pulse(r);
}
function press(el: HTMLElement, v: boolean): void { el.setAttribute(el.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-pressed', v ? 'true' : 'false'); }
(['a', 'b', 'c'] as const).forEach((k) => { const el = $('#ap-' + k); el.addEventListener('click', () => { st[k] = !st[k]; press(el, st[k]); renderSim(); }); });
([0, 1, 2, 3] as const).forEach((t) => $('#tier-' + t).addEventListener('click', () => { st.tier = t; [0, 1, 2, 3].forEach((u) => press($('#tier-' + u), u === t)); renderSim(); }));
$<HTMLInputElement>('#wait').addEventListener('input', (e) => { st.wait = Number((e.target as HTMLInputElement).value) as 0 | 1 | 2; renderSim(); });
(['f', 'e'] as const).forEach((k) => { const el = $('#sw-' + k); el.addEventListener('click', () => { st[k] = !st[k]; press(el, st[k]); renderSim(); }); });
renderSim();

$('#copyProc').addEventListener('click', async (e) => {
  const b = e.currentTarget as HTMLButtonElement;
  try { await navigator.clipboard.writeText($('#proc').textContent!); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy'; }
  setTimeout(() => (b.textContent = 'Copy'), 1800);
});

/* the proof terminal: real `pnpm verify:claims` lines */
const esc = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
const shellLines = VERIFY_OUTPUT.map(([kind, text]) =>
  kind === 'cmd' ? `<span class="p">$</span> ${esc(text.replace(/^\$ /, ''))}` : kind === 'ok' ? `<span class="ok">${esc(text)}</span>` : `<span class="dim">${esc(text)}</span>`);
const shellText = shellLines.join('\n');

/* ---------- hero beats ---------- */
const hero = $('#hero');
const BEATS = [
  { files: '7 / 7 match the seal', stat: 'Sealed · 2 of 3 approved',
    lede: "Signet brings DeWEB's trust guarantee to every website: no migration, your own domain, plus approval rules for every release." },
  { files: '6 / 7 · app-2aa5a3e0.js changed', stat: 'Seal broken',
    lede: "<b>February 2025.</b> One tampered JavaScript file on Safe{Wallet}'s site, about $1.5B taken from Bybit. The smart contracts were never touched." },
  { files: '6 / 7 · verified copy available', stat: 'Signature refused · $0 sent',
    lede: "<b>Signet Guard sees the broken seal before your wallet does.</b> The signature request stops, and you're offered the verified copy." },
];
let beat = -1;
function setBeat(i: number): void {
  if (i === beat) return; beat = i; hero.dataset.beat = String(i);
  $$('.beats span').forEach((s) => s.classList.toggle('on', Number(s.dataset.b) === i));
  const b = BEATS[i]!;
  const swap = (el: HTMLElement, html: string) => { if (reduce) { el.innerHTML = html; return; }
    gsap.to(el, { opacity: 0, y: -6, duration: 0.18, onComplete: () => { el.innerHTML = html; gsap.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3 }); } }); };
  swap($('#hFiles'), b.files); swap($('#hStat'), b.stat); swap($('#lede'), b.lede);
}
function setWho(sel: string, on: boolean): void { const el = $(sel); el.classList.toggle('on', on); el.querySelector('.stt')!.textContent = on ? 'approved' : 'waiting'; }
/// The end state of the pinned scenes, shown as normal sections (phones, and reduced motion).
function finalScenes(): void {
  setWho('#wA', true); setWho('#wB', true);
  ($('#tlRing') as unknown as SVGElement).style.strokeDashoffset = '0';
  $('#tlTxt').textContent = '0:00:00';
  $('#pubLamp').classList.add('on'); $('#pubVal').textContent = '1';
  $('#fAppSt').textContent = 'changed'; $('#fAppSt').style.color = '#FF8E77';
}

function staticMode(): void {
  document.documentElement.classList.add('static');
  S.scale = 1;
  placeStill();
  const ld = document.getElementById('loader'); if (ld) ld.remove();
  $$('.term .ln').forEach((l) => (l.style.opacity = '1'));
  $('#shell').innerHTML = shellText;
  finalScenes();
  const f = () => { S.opacity = window.scrollY < window.innerHeight * 0.55 ? 1 : 0; placeStill(); }; f(); window.addEventListener('scroll', f, { passive: true });
}

if (reduce) staticMode();
else animated();

function animated(): void {
  gsap.registerPlugin(ScrollTrigger);

  /* smooth scroll */
  let lenis: Lenis | null = null;
  try {
    lenis = new Lenis({ lerp: 0.085 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis!.raf(t * 1000)); gsap.ticker.lagSmoothing(0);
    lenis.stop();
    $$<HTMLAnchorElement>('a[href^="#"]').forEach((a) => a.addEventListener('click', (ev) => { const h = a.getAttribute('href')!; if (h.length < 2) return; const t = document.querySelector(h); if (t) { ev.preventDefault(); lenis!.scrollTo(t as HTMLElement); } }));
  } catch { lenis = null; }

  /* loader → intro */
  const ld = { v: 0 }, ldN = $('#ldN');
  const loadTl = gsap.timeline();
  loadTl.to(ld, { v: 100, duration: 1.1, ease: 'power2.inOut', onUpdate: () => { ldN.textContent = String(Math.round(ld.v)).padStart(3, '0'); } })
        .to('#loader .bar i', { scaleX: 1, duration: 1.1, ease: 'power2.inOut' }, 0);
  // the intro no longer waits for WebGL: the still image stands in until the live seal is ready
  void new Promise((r) => loadTl.eventCallback('onComplete', r)).then(() => {
    const intro = gsap.timeline();
    intro.to('#loader', { yPercent: -100, duration: 0.9, ease: 'expo.inOut' })
         .set('#loader', { display: 'none' })
         .from('.h-l1 > span', { yPercent: 60, opacity: 0, duration: 1, ease: 'expo.out' }, '-=.35')
         .from('.h-l2 > span', { yPercent: 40, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.08 }, '<+.05')
         .fromTo(S, { scale: 2.4, opacity: 0, tilt: -0.6 }, { scale: 1, opacity: 1, tilt: 0, duration: 0.7, ease: 'power4.in' }, '<+.1')
         .add(() => { if (S.thud) S.thud(); }, '>-0.02')
         .fromTo('.heat', { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 1.4, ease: 'expo.out' }, '<')
         .from('.hud .hi, .beats span', { opacity: 0, x: (_i: number, el: Element) => (el.closest('.hud.r') ? 20 : -20), duration: 0.8, ease: 'power3.out', stagger: 0.06 }, '<+.1')
         .from('.h-foot .lede, .h-foot .cta-row', { opacity: 0, y: 16, duration: 0.8, ease: 'power3.out', stagger: 0.08 }, '<')
         .add(() => { if (lenis) lenis.start(); buildScroll(); });
  });

  function buildScroll(): void {
    const mm = gsap.matchMedia();

    /* tape */
    const mq = gsap.to('.mq-track', { xPercent: -50, duration: 40, ease: 'none', repeat: -1 });
    ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => { const v = Math.min(5, 1 + Math.abs(self.getVelocity()) / 700);
      gsap.to(mq, { timeScale: v * (self.direction < 0 ? -1 : 1), duration: 0.25, overwrite: true, onComplete: () => { gsap.to(mq, { timeScale: 1, duration: 1.2 }); } }); } });

    mm.add('(min-width: 960px)', () => {
      /* HERO pinned: sealed → tampered → blocked */
      const htl = gsap.timeline({ scrollTrigger: { trigger: '#hero', start: 'top top', end: '+=240%', pin: true, scrub: 0.9,
        onUpdate: (self) => { const p = self.progress; setBeat(p < 0.3 ? 0 : p < 0.66 ? 1 : 2); } } });
      htl.to('.h-prog i', { scaleX: 1, ease: 'none', duration: 3 }, 0)
         .to(S, { tilt: 0.25, spin: 0.18, duration: 0.9, ease: 'power2.inOut' }, 0)
         .to(S, { crack: 1, duration: 0.8, ease: 'power3.out' }, 0.8)
         .to('.heat', { scale: 1.35, duration: 0.8 }, 0.8)
         .to(S, { crack: 0, tilt: 0, spin: Math.PI * 2, duration: 0.9, ease: 'power3.inOut' }, 1.95)
         .to('.heat', { scale: 1, duration: 0.8 }, 2.0)
         .to({}, { duration: 0.2 });
      /* after the pin, the seal leaves */
      gsap.fromTo(S, { y: 0.03, opacity: 1 }, { y: 0.75, opacity: 0, ease: 'none', immediateRender: false,
        scrollTrigger: { trigger: '.tape', start: 'top bottom', end: 'bottom top', scrub: 0.6 } });
      gsap.fromTo('.heat', { opacity: 1 }, { opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.tape', start: 'top bottom', end: 'bottom 40%', scrub: true } });

      /* ATTACK replay */
      const tick = $('#tick'), money = { v: 0 }, fSt = $('#fAppSt'), steps = $$('.step');
      const tl = gsap.timeline({ scrollTrigger: { trigger: '.atk-pin', start: 'top top', end: '+=330%', pin: true, scrub: 0.7,
        onUpdate: (self) => { const on = self.progress > 0.3; fSt.textContent = on ? 'changed' : 'match'; fSt.style.color = on ? '#FF8E77' : ''; } } });
      tl.to('.rail i', { scaleY: 1, ease: 'none', duration: 4 }, 0)
        .to(steps[0]!, { opacity: 0, y: -30, duration: 0.3 }, 0.8).fromTo(steps[1]!, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.35 }, '>+0.05')
        .to('#diff', { opacity: 1, y: 0, duration: 0.4 }, '<')
        .to('#fApp', { backgroundColor: 'rgba(214,61,39,.12)', color: '#FFB8A8', duration: 0.2 }, '<+.2')
        .to('#fNew', { opacity: 1, duration: 0.2 }, '<+.1')
        .to(steps[1]!, { opacity: 0, y: -30, duration: 0.3 }, 1.9).fromTo(steps[2]!, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.35 }, '>+0.05')
        .to('#diff', { opacity: 0, y: 10, duration: 0.3 }, '<')
        .to('#wallet', { opacity: 1, y: 0, scale: 1, duration: 0.4 }, '<')
        .to(money, { v: 1.5e9, duration: 0.9, ease: 'power2.in', onUpdate: () => { tick.textContent = '$' + Math.round(money.v).toLocaleString('en-US'); } }, '<')
        .to(steps[2]!, { opacity: 0, y: -30, duration: 0.3 }, 3.0).fromTo(steps[3]!, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.35 }, '>+0.05')
        .to('#bOk', { opacity: 0, duration: 0.2 }, '<').to('#bBad', { opacity: 1, duration: 0.2 }, '<')
        .to('#wallet', { opacity: 0, scale: 0.96, duration: 0.25 }, '<')
        .to('#blocked', { clipPath: 'circle(150% at 70% 30%)', duration: 0.6, ease: 'power2.inOut' }, '<+.05')
        .from('#blocked > *', { y: 16, opacity: 0, stagger: 0.06, duration: 0.3 }, '>-0.25')
        .to({}, { duration: 0.4 });

      /* HOW horizontal */
      const track = $('.h-track'), dist = () => track.scrollWidth - window.innerWidth;
      const hz = gsap.to(track, { x: () => -dist(), ease: 'none',
        scrollTrigger: { trigger: '.h-pin', start: 'top top', end: () => '+=' + dist(), pin: true, scrub: 0.7, invalidateOnRefresh: true } });
      gsap.to('#term1 .ln', { opacity: 1, stagger: 0.12, ease: 'none', scrollTrigger: { trigger: '#p1', containerAnimation: hz, start: 'left 85%', end: 'center 45%', scrub: true } });
      const tlTxt = $('#tlTxt'), clock = { s: 3600 };
      const ptl = gsap.timeline({ scrollTrigger: { trigger: '#p2', containerAnimation: hz, start: 'left 70%', end: 'right 95%', scrub: true,
        onUpdate: (self) => { const p = self.progress; setWho('#wA', p > 0.1); setWho('#wB', p > 0.28); const on = p > 0.85; $('#pubLamp').classList.toggle('on', on); $('#pubVal').textContent = on ? '1' : '0'; } } });
      ptl.to('#tlRing', { strokeDashoffset: 0, ease: 'none', duration: 0.5 }, 0.3)
         .to(clock, { s: 0, ease: 'none', duration: 0.5, onUpdate: () => { const s = Math.round(clock.s); tlTxt.textContent = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; } }, 0.3)
         .to({}, { duration: 0.2 });
      gsap.from('#p3 .node, #p3 .agree, #p3 .chk', { opacity: 0, y: 14, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: '#p3', containerAnimation: hz, start: 'left 85%', end: 'left 35%', scrub: true } });
      gsap.from('.panel .idx', { xPercent: 30, ease: 'none', scrollTrigger: { trigger: '.h-pin', start: 'top top', end: () => '+=' + dist(), scrub: true } });
    });

    mm.add('(max-width: 959px)', () => {
      // phones: the seal fades out within the first 40% of a screen of scrolling, before the hero's buttons pass
      // under it, and there is no finale stamp (it landed on the plans' buttons at 375 px); see finale below
      gsap.fromTo(S, { y: S.y, opacity: 1 }, { y: S.y + 0.25, opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '#hero', start: 'top top', end: () => `+=${Math.round(innerHeight * 0.4)}`, scrub: 0.3 } });
      $$('.step').forEach((s, i) => { s.style.position = 'relative'; s.style.opacity = '1'; if (i < 3) s.style.display = 'none'; });
      $('.rail').style.display = 'none'; $('.steps').style.marginLeft = '0';
      gsap.set('#bOk', { opacity: 0 }); gsap.set('#bBad', { opacity: 1 }); gsap.set('#blocked', { clipPath: 'circle(150% at 70% 30%)' });
      finalScenes();
    });

    /* headings rise */
    $$('.sec .h2, .how-head .h2, #attack .h2').forEach((h) => gsap.from(h, { yPercent: 18, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: h, start: 'top 85%' } }));
    $$('.shead .label').forEach((l) => gsap.from(l, { opacity: 0, duration: 0.8, scrollTrigger: { trigger: l, start: 'top 88%' } }));

    /* bench */
    gsap.from('.bar .fill', { scaleY: 0, duration: 1.5, ease: 'expo.out', stagger: 0.15, scrollTrigger: { trigger: '.bars', start: 'top 75%' } });
    $$('.bar [data-count]').forEach((el, i) => { const o = { v: 0 }, end = Number(el.dataset.count);
      gsap.to(o, { v: end, duration: 1.5, ease: 'expo.out', delay: i * 0.15, scrollTrigger: { trigger: '.bars', start: 'top 75%' }, onUpdate: () => { el.textContent = String(Math.round(o.v)); } }); });

    /* proof terminal types once */
    ScrollTrigger.create({ trigger: '#shell', start: 'top 75%', once: true, onEnter: () => {
      const pre = $('#shell'); let i = 1; pre.innerHTML = shellLines[0]!;
      const step = () => { if (i >= shellLines.length) return; pre.innerHTML += '\n' + shellLines[i++]; setTimeout(step, i === 2 ? 650 : 280); };
      setTimeout(step, 400); } });

    gsap.from('.plan', { y: 24, opacity: 0, stagger: 0.1, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: '.plans', start: 'top 80%' } });

    /* FINALE: the seal drops back and stamps (wide screens only: on a phone it covered the buttons above #cta) */
    mm.add('(min-width: 960px)', () => {
    let stamped = false;
    const ft = gsap.timeline({ scrollTrigger: { trigger: '#cta', start: 'top 80%', end: 'top 10%', scrub: 0.8,
      onUpdate: (self) => { if (self.progress > 0.97 && !stamped) { stamped = true; if (S.thud) S.thud();
        gsap.fromTo('#ring', { scale: 0, opacity: 0.9 }, { scale: 90, opacity: 0, duration: 1.6, ease: 'expo.out' }); }
        if (self.progress < 0.5) stamped = false; } } });
    ft.fromTo(S, { x: 0, y: 0.9, scale: 2.2, opacity: 0, tilt: -0.8, spin: 0, crack: 0 }, { x: 0, y: 0.12, scale: 0.82, opacity: 1, tilt: 0, spin: 0, ease: 'power3.in', immediateRender: false });
    gsap.from('#cta .h2', { yPercent: 20, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: '#cta', start: 'top 40%' } });
    gsap.to(S, { opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: 'footer', start: 'top 70%', end: 'top 20%', scrub: true } });
    });

    ScrollTrigger.refresh();
  }
}
