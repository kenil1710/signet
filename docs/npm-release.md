# Releasing the `signetguard` npm package (checklist)

The package is built from `packages/cli` by `node packages/cli/scripts/pack.mjs` (version in `VERSION` there).
**Never publish a tarball that didn't pass every step below.** `pack.mjs` runs steps 2–4 itself and exits non-zero
if any fails.

1. Bump `VERSION` in `packages/cli/scripts/pack.mjs` (a published version can never be reused).
2. `package.json` is what npm would publish: `bin` is exactly `{"signet": "signet.mjs"}` (no `./`), `signet.mjs`
   starts with `#!/usr/bin/env node`, `npm pkg fix` changes nothing, and `npm publish --dry-run` prints no
   "cleaned" / "invalid" / "removed" warning.
3. `npm pack`: exactly 3 files: `README.md`, `package.json`, `signet.mjs`.
4. **Install test** (`packages/cli/scripts/install-test.mjs`): `npm install -g --prefix <empty temp dir> <the .tgz>`
   from an empty folder, with a bare PATH, then the installed `signet --version` (must print the version) and
   `signet --help` (must list the commands).
5. Secrets scan of `release/pkg/signet.mjs`: no proposer key, no `.env` values except the public RPC URLs and the
   domain, no local paths or emails.
6. Publish (the maintainer, with 2FA): `cd packages/cli/release/pkg && npm publish --access public`.
7. After publishing, from a clean folder: `npm view signetguard@<version> bin` shows `{ signet: 'signet.mjs' }`,
   `npm view signetguard dist-tags` has `latest: <version>`, and
   `npx -y -p signetguard@<version> signet --version` prints the version.

**Why (2026-11-19):** 0.1.0 shipped `bin: {"signet": "./signet.mjs"}`; the publish warned "bin[signet] script name
was cleaned" and `signet` was "command not found" after `npm install -g`. 0.1.1 fixed the path and added steps 2
and 4 as an automatic gate.
