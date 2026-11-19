// `signet init` (interactive setup): everything a team needs in its repository, with no transaction sent.
//   1. the CI proposer key (.signet/proposer.key, git-ignored; only its address is printed)
//   2. the gate: created in the dashboard (it needs the proposer address); `signet link` checks the registry binds it
//   3. the domain proof (public/.well-known/signet.json) and the header your host needs so the dashboard can read it
//   4. .github/workflows/signet.yml for your host: build, seal, propose, wait for approvals, publish, then deploy
// Every answer can be given as a flag (CI, tests); a missing one is asked for on a terminal, else it's an error.
import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeCtx, SignetError, statePath, newKeyFile, addressOfKeyFile, showPath, CONFIG_NAME } from './chain.ts';

type Log = (line?: string) => void;
import * as cmd from './commands.ts';

export const HOSTS = ['cloudflare', 'netlify', 'vercel', 'github-pages', 'other'] as const;
export type Host = (typeof HOSTS)[number];
export interface SetupOptions { domain?: string; gate?: string; host?: string; build?: string; out?: string; public?: string; deploy?: string; project?: string; yes?: boolean }

const DASHBOARD = 'https://signetguard.xyz/app#/new';
const CLI_VERSION = typeof __SIGNET_CLI_VERSION__ !== 'undefined' ? __SIGNET_CLI_VERSION__ : '';
declare const __SIGNET_CLI_VERSION__: string;

/// The deploy step for a host: it must upload the exact sealed folder (no build or rewrite on the host's side).
export function deployStep(host: Host, out: string, o: { project?: string; deploy?: string }): { run: string; env: Record<string, string>; secrets: string[]; extra?: string } {
  if (o.deploy) return { run: o.deploy, env: {}, secrets: [] };
  switch (host) {
    case 'cloudflare':
      return { run: `npx -y wrangler@4 pages deploy ${out} --project-name ${o.project ?? 'YOUR_PAGES_PROJECT'} --branch main`, env: { CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}', CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}' }, secrets: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] };
    case 'netlify':
      return { run: `npx -y netlify-cli@17 deploy --dir=${out} --prod --no-build`, env: { NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}', NETLIFY_SITE_ID: '${{ secrets.NETLIFY_SITE_ID }}' }, secrets: ['NETLIFY_AUTH_TOKEN', 'NETLIFY_SITE_ID'] };
    case 'vercel':
      return { run: `npx -y vercel@39 deploy ${out} --prod --yes --token "$VERCEL_TOKEN"`, env: { VERCEL_TOKEN: '${{ secrets.VERCEL_TOKEN }}', VERCEL_ORG_ID: '${{ secrets.VERCEL_ORG_ID }}', VERCEL_PROJECT_ID: '${{ secrets.VERCEL_PROJECT_ID }}' }, secrets: ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'] };
    case 'github-pages':
      return { run: '', env: {}, secrets: [], extra: `      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: ${out}\n      - uses: actions/deploy-pages@v4` };
    default:
      return { run: 'echo "your deploy command here: upload the sealed folder as it is"', env: {}, secrets: [] };
  }
}

export function workflow(host: Host, o: { build: string; out: string; project?: string; deploy?: string }): string {
  const d = deployStep(host, o.out, o);
  const env = Object.entries(d.env).map(([k, v]) => `          ${k}: ${v}`).join('\n');
  const pages = host === 'github-pages';
  const deploy = d.extra ?? `      - name: Deploy the sealed folder, exactly as sealed (only reached after the release is published)\n        run: ${d.run}${env ? `\n        env:\n${env}` : ''}`;
  return `name: Signet release
on:
  push:
    branches: [main]
${pages ? 'permissions:\n  contents: read\n  pages: write\n  id-token: write\n' : ''}jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 360
${pages ? '    environment:\n      name: github-pages\n' : ''}    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: ${o.build}                          # your build; output in ${o.out}/
      - run: npm install -g signetguard${CLI_VERSION ? `@${CLI_VERSION}` : ''}
      - name: Seal and propose (the CI key can only propose)
        run: signet verify ${o.out} && signet seal ${o.out} && signet propose ${o.out} --reuse
        env:
          SIGNET_PROPOSER_KEY: \${{ secrets.SIGNET_PROPOSER_KEY }}
      - name: Wait for approvals and the timelock, publish (the circuit decides), store the manifest Guard reads
        run: signet wait ${o.out} --publish --timeout 19800
        env:
          SIGNET_PROPOSER_KEY: \${{ secrets.SIGNET_PROPOSER_KEY }}
${deploy}
`;
}

/// The header so the dashboard and badge can read the proof cross-origin, in the host's own format.
export function proofHeaders(host: Host, publicDir: string, log: Log): void {
  const rule = '/.well-known/signet.json\n  Access-Control-Allow-Origin: *\n';
  if (host === 'cloudflare' || host === 'netlify') {
    const f = join(publicDir, '_headers');
    const cur = existsSync(f) ? readFileSync(f, 'utf8') : '';
    if (cur.includes('/.well-known/signet.json')) return log(`  ${showPath(f)} already has a rule for the proof`);
    writeFileSync(f, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${cur ? '\n' : ''}${rule}`);
    log(`  wrote the CORS header for the proof into ${showPath(f)}`);
  } else if (host === 'vercel') {
    // deployed as a static folder, so vercel.json must be inside it: put it in the public folder
    const f = join(publicDir, 'vercel.json');
    const cur = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
    const headers = (cur.headers ?? []) as { source: string }[];
    if (!headers.some((h) => h.source === '/.well-known/signet.json')) headers.push({ source: '/.well-known/signet.json', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] } as never);
    writeFileSync(f, JSON.stringify({ ...cur, headers }, null, 2) + '\n');
    log(`  wrote the CORS header for the proof into ${showPath(f)}`);
  } else if (host === 'github-pages') {
    // GitHub Pages already sends Access-Control-Allow-Origin: *; Jekyll would drop a folder starting with "."
    writeFileSync(join(publicDir, '.nojekyll'), '');
    log(`  wrote ${showPath(join(publicDir, '.nojekyll'))} (so GitHub Pages serves .well-known/); Pages already allows cross-origin reads`);
  } else {
    log('  Serve /.well-known/signet.json with the header "Access-Control-Allow-Origin: *" (your host\'s header settings).');
  }
}

export async function setup(dir: string, o: SetupOptions, log: Log): Promise<void> {
  const tty = !!process.stdin.isTTY && !o.yes;
  const rl = tty ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q: string, have: string | undefined, def?: string, check?: (v: string) => string | null): Promise<string> => {
    let v = have ?? (rl ? (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim() || def : def);
    for (;;) {
      if (!v) throw new SignetError('setup', `${q}: missing (pass it as a flag, see signet init --help)`);
      const bad = check?.(v);
      if (!bad) return v;
      if (!rl) throw new SignetError('setup', `${q}: ${bad}`);
      log(`  ${bad}`);
      v = (await rl.question(`${q}: `)).trim();
    }
  };
  try {
    log('Signet setup: nothing is sent on-chain by this command.\n');
    // 1. the CI proposer key
    const keyFile = statePath(dir, 'proposer.key');
    const proposer = existsSync(keyFile) ? addressOfKeyFile(keyFile) : newKeyFile(keyFile);
    log(`1. CI proposer: ${proposer}  (key in ${showPath(keyFile)}, git-ignored, never printed)`);
    // 2. domain and gate
    const domain = (await ask('2. Your domain (e.g. app.example.org)', o.domain, undefined, (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : 'a domain like app.example.org'))).toLowerCase();
    if (!existsSync(join(dir, CONFIG_NAME))) {
      if (!o.gate) log(`   Create your gate: open ${DASHBOARD}, enter ${domain}, your 3 approvers, this CI proposer (${proposer}) and a recovery address. Two transactions from your wallet (≈ 0.000013 OKB).`);
      const gate = await ask('   The gate address the dashboard showed', o.gate, undefined, (v) => (/^0x[0-9a-fA-F]{40}$/.test(v) ? null : 'a 0x… address'));
      await cmd.link(makeCtx(dir), domain, gate as `0x${string}`, (l = '') => { if (!/^Next: /.test(l)) log(`   ${l}`); });
    } else log(`   ${CONFIG_NAME} already exists: kept`);
    // 3. host, folders, domain proof
    const host = (await ask(`3. Where is the site hosted (${HOSTS.join(', ')})`, o.host, 'cloudflare', (v) => ((HOSTS as readonly string[]).includes(v) ? null : `one of: ${HOSTS.join(', ')}`))) as Host;
    const pub = await ask('   The folder your build copies to the site root', o.public, 'public');
    const out = await ask('   The build output folder', o.out, 'dist');
    const build = await ask('   The build command', o.build, 'npm ci && npm run build');
    mkdirSync(pub, { recursive: true });
    await cmd.domainProof(makeCtx(dir), join(dir, pub), {}, (l = '') => log(`   ${l}`));
    proofHeaders(host, join(dir, pub), log);
    // 4. the workflow
    const wf = join(dir, '.github/workflows/signet.yml');
    if (existsSync(wf)) log(`4. ${showPath(wf)} already exists: kept`);
    else {
      mkdirSync(dirname(wf), { recursive: true });
      writeFileSync(wf, workflow(host, { build, out, deploy: o.deploy }));
      log(`4. Wrote ${showPath(wf)}`);
    }
    const d = deployStep(host, out, { deploy: o.deploy });
    log(`
Next:
  a. GitHub → Settings → Secrets and variables → Actions: add SIGNET_PROPOSER_KEY = the content of ${showPath(keyFile)}${d.secrets.length ? `, and ${d.secrets.join(', ')}` : ''}. Then delete the key file.
  b. Send ${proposer} ≈ 0.0005 OKB on X Layer for gas.
  c. Deploy your site once so https://${domain}/.well-known/signet.json is live, then: signet domain --check
  d. Push to main: the workflow proposes your first release (tier 10: 2 approvals + 24 h). Approve it in the dashboard.${host === 'cloudflare' ? '\n  Cloudflare: turn off Email Obfuscation and Rocket Loader for this site; they rewrite pages after you seal them.' : ''}${host === 'github-pages' ? '\n  GitHub Pages: Settings → Pages → Source: GitHub Actions.' : ''}`);
  } finally {
    rl?.close();
  }
}
