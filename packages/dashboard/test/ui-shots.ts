// Screenshots of the dashboard and /prove on the staging chain, at 390 and 1280 wide, into docs/demo/ui/.
// Seals a throwaway project with two open proposals (a code-only release with one approval and its timelock
// running, and a poisoned build that adds a contract: tier 10), so the pages show real state.
//   pnpm staging:up; npx vite build (SIGNET_NETWORK=local SIGNET_RPC_URL2=…); npx vite preview --port 4300 &
//   node test/ui-shots.ts
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { net, sealDemoDapp, signet } from '@signet/extension/test/staging/harness.ts';
import { POISON } from '@signet/cli/test/fixtures.ts';

const BASE = process.argv[2] ?? 'http://localhost:4300/app.html';
const OUT = fileURLToPath(new URL('../../../docs/demo/ui/', import.meta.url));
mkdirSync(OUT, { recursive: true });
spawnSync('bash', [fileURLToPath(new URL('../../../staging/renew-operator.sh', import.meta.url))]);
const domain = `ui-${Date.now().toString(36)}.signet.test`;
const p = await sealDemoDapp(domain);
const mainOf = (dist: string) => `assets/${readdirSync(join(dist, 'assets')).find((f) => /^index-.*\.js$/.test(f))}`;
// a code-only release, approved once: its 1-hour timelock is running
const v2 = join(p.dir, 'v2');
cpSync(p.dist, v2, { recursive: true });
writeFileSync(join(v2, 'robots.txt'), 'User-agent: *\nAllow: /\n');
signet(p.dir, ['seal', v2]);
const codeOnly = signet(p.dir, ['propose', v2]).match(/Proposed release #(\d+)/)![1]!;
const cast = spawnSync('cast', ['send', '--unlocked', '--from', net.accounts!.approvers[0]!, p.gate, 'approve(uint64)', codeOnly, '--rpc-url', net.rpcUrl], { encoding: 'utf8' });
if (cast.status !== 0) throw new Error(cast.stderr);
// a poisoned build: new contract and origin, so the chain puts it in tier 10
const bad = join(p.dir, 'poisoned');
cpSync(p.dist, bad, { recursive: true });
appendFileSync(join(bad, mainOf(bad)), POISON);
signet(p.dir, ['seal', bad]);
const poisoned = signet(p.dir, ['propose', bad]).match(/Proposed release #(\d+)/)![1]!;

const browser = await chromium.launch();
async function shoot(width: number, name: string, hash: string, ready: (pg: Page) => Promise<unknown>) {
  const pg = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 } });
  await pg.goto(`${BASE}#${hash}`);
  await ready(pg);
  await pg.waitForTimeout(600);
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sw > 0) console.log(`!! ${name} @${width}: ${sw}px sideways scroll`);
  await pg.screenshot({ path: `${OUT}${name}-${width}.png`, fullPage: true });
  await pg.close();
}
for (const w of [1280, 390]) {
  await shoot(w, 'dashboard-home', '/', (pg) => pg.waitForSelector('.domains a'));
  await shoot(w, 'dashboard-project', `/p/${domain}`, (pg) => pg.waitForSelector(`tr[data-id="${codeOnly}"] .cd`));
  await shoot(w, 'dashboard-proposal-tier10', `/p/${domain}/proposal/${poisoned}`, (pg) => pg.waitForSelector('.glance'));
  await shoot(w, 'dashboard-badge', `/badge/${domain}`, (pg) => pg.waitForSelector('.badge'));
  await shoot(w, 'prove', '/prove', (pg) => pg.waitForFunction(() => /All checks passed|FAILED/.test(document.getElementById('sum')?.textContent ?? ''), null, { timeout: 300_000 }));
}
await browser.close();
console.log(`screenshots in docs/demo/ui/ (project ${domain}: proposal #${codeOnly} code-only, #${poisoned} tier 10)`);
