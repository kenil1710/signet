# Releasing the `signetguard` npm package (checklist)

The package is built from `packages/cli` by `node packages/cli/scripts/pack.mjs` (version in `VERSION` there).
**Never publish a tarball that didn't pass every step below.** `pack.mjs` runs steps 2–4 itself and exits non-zero
if any fails.

1. Bump `VERSION` in `packages/cli/scripts/pack.mjs` (a published version can never be reused).
2. `package.json` is what npm would publish: `bin` is exactly `{"signet": "signet.mjs"}` (no `./`), `signet.mjs`
   starts with `#!/usr/bin/env node`, `npm pkg fix` changes nothing, and `npm publish --dry-run` prints no
   "cleaned" / "invalid" / "removed" warning.
3. `npm pack`: exactly 4 files: `LICENSE`, `README.md`, `package.json`, `signet.mjs`; `package.json` has `repository`, `homepage` and `bugs`.
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

## Published versions

| Version | Published | npm `dist.shasum` (SHA-1) | Tarball SHA-256 | Checked after publishing |
|---|---|---|---|---|
| 0.2.0 (Signet v2: page mode `ssr`, `seal --crawl` / `--crawl-browser`, factory rule, chunked `files.json`) | 2026-11-23, `latest` | `c50c2e36ad26e28d677276eeefd461b7a77d68f2` | `c9a75897dcc603d5f962ae7063c7c5c164bb9956c16cb7a613a60767d5e1d528` | see below |

**0.2.0 after publishing (2026-11-23):**

- The registry tarball (`registry.npmjs.org/signetguard/-/signetguard-0.2.0.tgz`) is **byte-identical** to
  `packages/cli/release/signetguard-0.2.0.tgz` and to the site copy `packages/dashboard/public/signetguard-0.2.0.tgz`:
  same SHA-256 and SHA-1, and its SHA-512 equals npm's `integrity`
  (`sha512-TaFos71l2HrD77q8qlBDictb6wC7KGwGMDOFU1Y86WqgVTLROr4LJXo6cK54GfFtn+loOGtUrOCzRiwv4L8x9Q==`). 4 files,
  unpacked 1,072,535 bytes.
- **Stranger install test** (step 7, against the live registry): `env -i` with an empty `HOME`, an empty npm cache
  and user config, and PATH = only the new prefix, node and `/usr/bin:/bin`, from an empty folder.
  `npm view signetguard@0.2.0 bin` = `{ signet: 'signet.mjs' }`, `dist-tags` = `{ latest: '0.2.0' }`;
  `npm install -g --prefix <empty> signetguard@0.2.0` installed `signet` (the installed `signet.mjs` has the same
  SHA-256 as `release/pkg/signet.mjs`); `signet --version` = `0.2.0`; `signet --help` lists every command;
  `signet seal --help` shows `--crawl` and `--crawl-browser`; `signet verify https://signetguard.xyz` ran (ready to
  seal); `npx -y -p signetguard@0.2.0 signet --version` with an emptied cache = `0.2.0`. No transaction was sent.
