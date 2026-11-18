# Landing page: build report (2026-11-18)

Built from `docs/design/landing-v2.html` into `packages/dashboard` (`index.html` + `src/landing/`). The dashboard and
`/prove` moved to `app.html` (same hash routes); old `index.html#/…` links redirect there.

## Checks

- `pnpm --filter @signet/dashboard test`: the simulator equals circuit #6's truth table and the reference rule on
  all 512 rows; all 384 states the controls can reach map to the right row, and the sentence agrees with PUBLISH.
- `pnpm --filter @signet/dashboard site:check` (on a `vite preview` of the build): no page errors, no request to any
  other host (no CDN), no sideways scroll, no text cut off at 390 / 768 / 1280 / 1440 and with reduced motion; old
  dashboard links redirect. Screenshots are in this folder (desktop: one per pinned scene; phone, tablet and
  reduced motion: full page).
- Dashboard staging suite against `app.html`: 6/6.

## Lighthouse 12.2.1 (local `vite preview`, headless Chromium)

| | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| Desktop | 86 | 93 | 100 | 100 | 0.5 s | 0.6 s | 310 ms | 0.077 |
| Mobile | 70 | 93 | 100 | 100 | 2.1 s | 2.1 s | 1,240 ms | 0.097 |

An earlier desktop run gave 94; the score moves by a few points between runs. On mobile the blocking time is one
~1 s task without a script attached: the WebGL seal's first draw (shader compile). Lighthouse runs it on a software
GPU with a 4× CPU slowdown. The setup is already split into short steps and the shaders compile with
`compileAsync`. Accessibility loses points on the design's dim text colour (#6e6560 on #0B0A09, 3.47:1) and one
heading level in the footer. Both are design choices and were left as designed. Full reports:
`lighthouse-desktop.html`, `lighthouse-mobile.html`.

## DeWEB size and cost (nothing uploaded)

Cost = KB × 241,000 gas × gas price. Gas price read on 2026-11-18: 0.020 gwei (xlayerrpc.okx.com), 0.021 gwei
(xlayer.drpc.org).

| File | Bytes |
|---|---:|
| assets/seal3d-*.js (three.js + the seal, loaded after first paint) | 502,910 |
| assets/app-*.js (dashboard + /prove, viem) | 377,161 |
| assets/index-*.js (landing: gsap, ScrollTrigger, lenis, simulator) | 141,045 |
| assets/archivo-latin-wdth-normal-*.woff2 | 90,104 |
| index.html | 26,258 |
| assets/index-*.css | 25,579 |
| assets/ibm-plex-mono-latin-500-normal-*.woff2 | 14,888 |
| assets/ibm-plex-mono-latin-400-normal-*.woff2 | 14,708 |
| assets/ccip-*.js (viem, dashboard only) | 4,329 |
| assets/preload-helper-*.js | 4,100 |
| assets/app-*.css | 2,291 |
| app.html | 544 |
| robots.txt | 23 |
| **Total** | **1,203,940 (1,175.7 KB)** |

| Upload | KB | OKB at 0.020–0.021 gwei |
|---|---:|---|
| Whole site (landing + dashboard + /prove) | 1,175.7 | 0.0057 – 0.0060 |
| Landing page only | 800.3 | 0.0039 – 0.0041 |
| Dashboard + /prove only | 375.3 | 0.0018 – 0.0019 |
| three.js chunk alone | 491.1 | 0.0024 – 0.0025 |

The whole site is over 0.005 OKB (the break-even at 0.021 gwei is 988 KB). Three files exceed 48 KB and need the
chunked upload (`writeChunk`, 24 KB pieces).

Ways to get under 0.005 OKB, largest first (savings are estimates, not measured):
1. **Replace the WebGL seal with pre-rendered frames** (a short WebP sprite or a few stills for sealed / cracked /
   stamped): about −400 KB. This changes how the motion is produced, so it needs your approval.
2. **Slim the dashboard's viem use** (import only `createPublicClient`, `http` and the actions it needs; drop the
   ENS/CCIP paths), or publish `/prove` as its own small page: an estimated −100 to −200 KB.
3. **Subset Archivo** to the characters the page uses, keeping the weight and width axes: about −50 KB.
4. Drop `RoomEnvironment` + PMREM for a small baked environment texture: a few KB of code, plus faster mobile start.
5. Minify `index.html` (the inline SVGs and whitespace): about −5 KB.

Doing 2 + 3 alone would bring the whole site to roughly 0.0045–0.005 OKB. Doing 1 brings it to about 0.004 OKB.
