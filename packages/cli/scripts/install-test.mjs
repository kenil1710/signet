// Release gate for the npm package: install the built .tgz globally into a CLEAN temp prefix (no repo, no PATH
// leftovers) and run the installed `signet` binary. Fails if npm wants to fix package.json, if the bin link is
// missing, or if `signet --version` / `signet --help` don't work. Run by scripts/pack.mjs after every build.
//   node scripts/install-test.mjs [path/to/signetguard-<version>.tgz]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = join(HERE, 'release/pkg');
const { version, bin } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const tgz = process.argv[2] ?? join(HERE, `release/signetguard-${version}.tgz`);
const fail = (m) => { console.error(`install test FAILED: ${m}`); process.exit(1); };
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...o });

// 1. package.json is already what npm would publish (nothing for `npm pkg fix` to change)
if (!bin || bin.signet !== 'signet.mjs') fail(`bin must be {"signet":"signet.mjs"}, got ${JSON.stringify(bin)}`);
if (!readFileSync(join(pkgDir, 'signet.mjs'), 'utf8').startsWith('#!/usr/bin/env node\n')) fail('signet.mjs must start with #!/usr/bin/env node');
const scratch = mkdtempSync(join(tmpdir(), 'sg-fix-'));
cpSync(join(pkgDir, 'package.json'), join(scratch, 'package.json'));
const fix = run('npm', ['pkg', 'fix'], { cwd: scratch });
if (fix.status !== 0) fail(`npm pkg fix: ${fix.stderr}`);
if (readFileSync(join(scratch, 'package.json'), 'utf8') !== readFileSync(join(pkgDir, 'package.json'), 'utf8')) fail('npm pkg fix changed package.json');
const dry = run('npm', ['publish', '--dry-run', '--access', 'public'], { cwd: pkgDir });
if (/clean|invalid|removed/i.test(dry.stderr)) fail(`npm publish --dry-run warns:\n${dry.stderr}`);
rmSync(scratch, { recursive: true, force: true });

// 2. a clean global install from the tarball, then the installed binary
const prefix = mkdtempSync(join(tmpdir(), 'sg-prefix-'));
const home = mkdtempSync(join(tmpdir(), 'sg-home-'));
try {
  const inst = run('npm', ['install', '-g', '--prefix', prefix, tgz], { cwd: home });
  if (inst.status !== 0) fail(`npm install -g: ${inst.stderr}`);
  const exe = join(prefix, 'bin', 'signet');
  if (!existsSync(exe)) fail(`no "signet" in ${join(prefix, 'bin')} after npm install -g`);
  const env = { HOME: home, PATH: `${join(prefix, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin` };
  const v = run('signet', ['--version'], { cwd: home, env });
  if (v.status !== 0 || v.stdout.trim() !== version) fail(`signet --version: exit ${v.status}, "${v.stdout.trim()}" ${v.stderr}`);
  const h = run('signet', ['--help'], { cwd: home, env });
  if (h.status !== 0 || !/Usage: signet/.test(h.stdout) || !/\bseal\b/.test(h.stdout)) fail(`signet --help: exit ${h.status} ${h.stderr}`);
  console.log(`install test passed: npm install -g ${tgz.split('/').pop()} -> signet --version = ${version}, signet --help OK`);
} finally {
  rmSync(prefix, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
