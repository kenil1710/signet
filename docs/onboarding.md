# Team onboarding: /start, the "Protect a site" wizard, the CLI package (Phase 0b, 2026-11-19)

**Deployed 2026-11-19** to Cloudflare Pages (signetguard.xyz and signet-6l4.pages.dev) and sealed as release/3 (proposal pending approvals; tier 10). All of this goes out
in release #3.

## What was built

| Piece | Where |
|---|---|
| **`/start`**: the 5 steps, every command copyable. Download URLs use the page's own origin, so they are right on signet-6l4.pages.dev now and on signetguard.xyz later | `packages/dashboard/start.html`, `src/start.ts` |
| **"Protect a site" wizard**, `app#/new`. Your wallet sends 2 transactions: `factory.commit(…)`, then, 2 blocks later, `createGate(…)`. It shows the gate address and the exact next commands. A button on the projects page opens it | `packages/dashboard/src/pages/new.ts` |
| **The CLI as one package, `signetguard`** (bin `signet`): one bundled file, no dependencies, Node ≥ 18, X Layer mainnet embedded (`SIGNET_RPC_URL` still overrides). The site serves `signetguard-0.1.0.tgz` (232 KB) until it's on npm | `packages/cli/scripts/pack.mjs` → `packages/dashboard/public/signetguard-0.1.0.tgz` |
| **`signet link <domain> <gate>`** writes `signet.config.json` after checking the registry binds the domain to that gate. **`signet domain <dir>`** writes `.well-known/signet.json`; **`signet domain --check`** checks the live file | `packages/cli/src/commands.ts` |
| The landing page's "Read the setup guide" now goes to `/start` (it said "coming soon") | `src/landing/config.ts` |
| Signet's own site serves `/.well-known/signet.json`, naming gate `0xa3d4…4503` | `packages/dashboard/public/.well-known/signet.json` |

**Step order changed from the request:** the domain proof is step 3, after the gate exists (step 2), because the
file names the gate's address.

## The stranger test (mainnet fork, made-up domain)

`node packages/dashboard/test/stranger-onboarding.ts` follows `/start` word for word, on a fresh fork of mainnet
with the real contracts, a domain `acme-swap.example` and fresh wallets. The fork charges mainnet's 0.02 gwei base
fee. **Every step passed** (`staging/.run/stranger/log.txt`):

1. `npm install -g <site>/signetguard-0.1.0.tgz` installs it; `signet --version` prints 0.1.0; `signet keygen`
   writes a git-ignored key.
2. The wizard: the wallet starts on Ethereum and "Switch to X Layer" moves it. "Reserve the domain", then
   "Create the gate" once 2 blocks have passed. The gate is created and the next commands are shown.
3. `signet link`, `signet domain public`, and `signet domain --check` against the deployed copy of the site
   (served locally in place of the domain) all pass.
4. The workflow's commands: `signet verify dist && signet seal dist && signet propose dist --reuse` give release
   #1, tier 10.
5. Approvers A and B approve in the dashboard; after 24 h `signet wait dist --publish` publishes; the badge says
   "Sealed by Signet · acme-swap.example · release #1 · observe".

**Found and fixed during the test:** the wizard drew its buttons before a chain read and attached their handlers
after it, so a quick first click was lost. The handlers are now attached immediately.

## Still broken or missing for a real stranger

| # | What | Fix |
|---|---|---|
| 1 | **The CLI isn't on npm.** `/start` installs it from the site, so it 404s until release #3 is deployed | Publish `signetguard` (name free on npm, checked 2026-11-19); then `/start` says `npm install -g signetguard` |
| 2 | **The repository is private.** Nobody can read the source, and `uses: …/packages/action` can't work. `/start`'s workflow therefore calls the CLI directly | Make the repo public (or a public mirror of `packages/action`) |
| 3 | **Guard isn't in the Chrome Web Store** ("coming soon"); users can't install it | Submit it ($5 developer fee, review takes days) |
| 4 | **The domain proof isn't enforced yet.** `signet domain --check` verifies the file, but Guard and the dashboard don't require it (`docs/domain-ownership.md`, layer 1) | Build layer 1 (≈ 1–1.5 days, no contract change) |
| 5 | **A first release takes 24 h** (tier 10), longer than a 6-hour GitHub job. `/start` says to re-run the job after 24 h | Fine, or a "propose only" job plus a separate "publish and deploy" job |
| 6 | The wizard keeps the salt in **this browser** between its two steps; another browser can't finish (the UI says so; a reservation expires after the factory's `MAX_COMMIT_AGE`) | Acceptable; an export/import of the reservation would help |
| 7 | **The dashboard calls other projects' gates**, which aren't in Signet's sealed allowlist. With Signet's own site in **enforce** mode, Guard would refuse those approvals | Before switching signetguard.xyz to enforce: let Guard accept "any factory-made gate" (checked on-chain with `registry.isGate`) as a rule, not an address list |
| 8 | **The team needs OKB** on X Layer (≈ 0.0001 for the wizard, ≈ 0.0005 for the CI key, a little per approver); there is no faucet | Say where to get OKB on `/start` |
| 9 | "**Ten minutes to set up**" (landing page): the commands take minutes; getting OKB, three approvers and a repository secret takes longer, and the first release waits 24 h | Reword (Phase 3), or time it with an outside team |

## npm (for #1)

- **Name:** `signet` (v7.2.0) and `signet-cli` are taken. **`signetguard`** and **`@signetguard/cli`** are free.
  Recommendation: the unscoped `signetguard`, with bin `signet`.
- **Needs:** an npm account with 2FA (or a granular access token for publishing), then
  `cd packages/cli && node scripts/pack.mjs && cd release/pkg && npm publish --access public`.
  Free; no OKB.
- After publishing, change `/start` step 1 and the workflow to `npm install -g signetguard@0.1.0`.

## Release #3: tier 10, not tier 00

Sealing this build against release #2: **origins unchanged, allowlist changed.** It gains SignetFactory
`0xc5e1…7986` (the wizard calls it) and Signet's site gate `0xa3d4…4503` (named in `.well-known/signet.json`). The
chain will make release #3 **tier 10: 2 approvals + 24 h**. That's correct: the site can now ask wallets to call a
contract it never called before.
