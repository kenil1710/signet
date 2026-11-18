# Landing page: build report (updated 2026-11-18)

Built from `docs/design/landing-v2.html` into `packages/dashboard` (`index.html` + `src/landing/`). The dashboard and
`/prove` are on `app.html` (same hash routes); old `index.html#/…` links redirect there.

## Checks

- `pnpm --filter @signet/dashboard test`: the simulator equals circuit #6's truth table and the reference rule on
  all 512 rows; all 384 states the controls can reach map to the right row, and the sentence agrees with PUBLISH.
- `pnpm --filter @signet/dashboard site:check` (on a `vite preview` of the build): no page errors, no request to any
  other host (no CDN), no sideways scroll, no text cut off at 390 / 768 / 1280 / 1440 and with reduced motion; old
  dashboard links redirect. Screenshots are in this folder (desktop: one per pinned scene; phone, tablet and
  reduced motion: full page).
- Dashboard staging suite against `app.html`, with the slimmed wallet code: 6/6 (approve, publish, freeze,
  unfreeze, revoke, a contract refusal decoded as `AlreadyApproved`, /prove).

## Seal loading

- A still image of the seal (`src/landing/seal-still.webp`, 640×640, 23.5 KB) shows at once. It is rendered from
  the real 3D scene by `test/render-still.ts` (the live seal at rest, captured on a transparent background) and
  drawn exactly where the 3D seal will be.
- The WebGL seal then fades in over 0.8 s. On desktop it loads when the browser is idle after load
  (`requestIdleCallback`). On touch devices (`pointer: coarse`) it loads on the first touch, pointer press, key or
  scroll. With reduced motion, WebGL never loads and the page shows only the still image.

## Lighthouse 12.2.1 (local `vite preview`, headless Chromium)

| | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| Desktop | 86 | 95 (100 with reduced motion) | 100 | 100 | 0.5 s | 0.6 s | 290 ms | 0.077 |
| Mobile | **95–96** (two runs) | 100 | 100 | 100 | 1.8 s | 1.9 s | 0–10 ms | 0.097 |

Earlier: mobile 72 with WebGL on idle (TBT 1,180 ms), and 70 / 93 / 100 / 100 before the still image and contrast work; desktop 86 / 93 / 100 / 100.

- **Accessibility:** small text uses `--dim` `#8B807A` (was `#6E6560` at 3.4:1; now 4.98:1 on panels, 5.18:1 on the
  page). The hero beat labels moved from `#5C5450` to `--dim`. The tape tags use `#E04A33` (4.9:1). The footer
  headings are h3. The decorative "SIGNET" word is drawn by CSS. The remaining desktop items are motion states,
  not resting colours: the design shows the `signet seal dist` lines at 10% opacity until you scroll to them, and
  Lighthouse catches the hero labels mid fade-in. With reduced motion (everything at rest) desktop scores 100.
- **Mobile performance:** on touch devices the WebGL seal (and its ~1.2 s shader compile on Lighthouse's
  software GPU) waits for the first touch or scroll, so it is outside the load. Mobile went 72 → 95–96 and TBT
  1,180 ms → 0–10 ms. Lighthouse never touches the page, so its mobile run measures the page with the still
  image only. Desktop keeps the idle start.

## DeWEB size and cost (nothing uploaded)

Cost = KB × 241,000 gas × gas price. Gas price read on 2026-11-18: 0.020 gwei (xlayerrpc.okx.com), 0.021 gwei
(xlayer.drpc.org).

| File | Bytes | Before |
|---|---:|---:|
| assets/seal3d-*.js (three.js + the seal, loaded on idle) | 502,903 | 502,910 |
| assets/index-*.js (landing: gsap, ScrollTrigger, lenis, simulator) | 143,423 | 141,045 |
| assets/app-*.js (dashboard + /prove) | 114,873 | 377,161 |
| assets/archivo-subset-*.woff2 (weight and width axes kept) | 44,112 | 90,104 |
| index.html | 26,389 | 26,258 |
| assets/index-*.css | 25,641 | 25,579 |
| assets/seal-still-*.webp | 23,554 | — |
| assets/ibm-plex-mono-latin-500-normal-*.woff2 | 14,888 | 14,888 |
| assets/ibm-plex-mono-latin-400-normal-*.woff2 | 14,708 | 14,708 |
| assets/policy-*.js (circuit #6 table, shared) | 2,478 | — |
| assets/app-*.css | 2,291 | 2,291 |
| app.html | 536 | 544 |
| robots.txt | 23 | 23 |
| assets/ccip-*.js, assets/preload-helper-*.js | — | 8,429 |
| **Total** | **915,819 (894.4 KB)** | 1,203,940 (1,175.7 KB) |

| Upload | KB | OKB at 0.020–0.021 gwei |
|---|---:|---|
| **Whole site** (landing + dashboard + /prove) | **894.4** | **0.0043 – 0.0045** (was 0.0057 – 0.0060) |
| Landing page only | 779.4 | 0.0038 – 0.0039 |
| Dashboard + /prove only | 114.9 | 0.00055 – 0.00058 |

The site is now under 0.005 OKB. Three files are over 48 KB and need the chunked upload (`writeChunk`, 24 KB
pieces): the three .js bundles.

How the size came down:
- `src/wallet.ts` talks plain JSON-RPC (`eth_call`, `eth_estimateGas`, `eth_sendTransaction`, receipt polling)
  instead of building viem clients. viem is now used only to encode calls and decode reverts: −262 KB.
- Archivo is subset to the characters the page uses (`test/subset-font.sh`): −46 KB.

To regenerate: `bash test/subset-font.sh` after copy changes; `node test/render-still.ts` after changing the seal.

## After the UI restyle (dashboard, /prove, Guard)

The dashboard now shares the landing page's fonts (the same files, no second copy). Its CSS grew from 2.3 KB to
10.7 KB, its JS from 114.9 KB to 118.8 KB, and `app.html` from 0.5 KB to 1.7 KB. **New total: 929,517 bytes
(907.7 KB), ≈ 0.0044 – 0.0046 OKB** at 0.020–0.021 gwei. Still under 0.005 OKB; nothing uploaded.
