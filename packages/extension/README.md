# @signet/extension

Guard Chrome MV3 extension: hashes the loaded page against the sealed manifest, enforces the allowlist at signing, blocks tampered pages and opens the verified DeWEB copy. Observe mode and fail-open by default.

Status: **Spike C only** (cache-read hash check + badge). See `docs/decisions.md` (Spike C) and `docs/signet-spec.md`.

```bash
pnpm spike:c        # build demo-dapp, generate signet-manifest.json, run 5 scenarios in headless Chromium
node spike-c/server.mjs   # serve the test origins by hand, then load this folder as an unpacked extension
pnpm spike:b:read   # read the Spike B file back through TapeKit's kernel
```
