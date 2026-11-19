// Runs the /check analysis on public dApp sites (read-only, one page load each). node test/check-public.ts [domains…]
import { analyze } from '../src/check/risk.ts';
const domains = process.argv.slice(2).length ? process.argv.slice(2) : ['app.uniswap.org', 'app.aave.com', 'curve.finance'];
for (const d of domains) {
  try {
    const r = await analyze(d);
    console.log(`\n== ${r.domain}  (${r.url}, HTTP ${r.status})`);
    for (const f of r.findings) console.log(`  ${f.level.padEnd(4)} ${f.area}: ${f.text}`);
    console.log(`  external origins: ${r.origins.join(', ') || 'none'}`);
  } catch (e) {
    console.log(`\n== ${d}: ${(e as Error).message}`);
  }
}
