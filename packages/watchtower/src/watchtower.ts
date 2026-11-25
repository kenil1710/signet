// One round of the watchtower ("tick"), and the loop that runs it every minute.
//   1. Domains added to the registry's list are posted.
//   2. For every bound domain: pending tier-10 / tier-11 proposals are posted once.
//   3. The live site is loaded in headless Chromium and compared with the sealed release. A mismatch is loaded
//      a second time; only if the second load is wrong too is the team alerted (once per distinct mismatch).
// State (what was already posted, the last verified manifests) is kept in a JSON file so a restart doesn't repeat.
import { proofNames } from '@signet/extension/src/lib/proof.ts';
import { renewIfDue, type RenewConfig } from './renew.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { gateView, isValidManifest, newDomains, openProposals, sealedLists, type Net, type Sealed } from './chain.ts';
import { checkSite, type SiteCheck } from './check.ts';
import type { Alerter } from './alerts.ts';

/// True only if the site's own /.well-known/signet.json names `gate`. Loaded with the same browser as the site's
/// pages (so it sees the same host the users do; no CORS involved).
export async function domainConfirms(browser: Browser, siteUrl: string, gate: string, chainId: number): Promise<boolean> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const r = await page.goto(new URL('.well-known/signet.json', siteUrl).href, { timeout: 15000 });
    return !!r && r.ok() && proofNames((await r.text()).slice(0, 4096), gate, chainId);
  } catch {
    return false;
  } finally {
    await ctx.close();
  }
}

export interface Config {
  net: Net;
  alert: Alerter;
  statePath: string;
  urlFor: (domain: string) => string;
  only?: string[]; // watch only these domains (default: every bound domain)
  fromIndex?: number; // first run only: skip the registry's first N domains (default 0: watch them all)
  confirmDelayMs?: number; // pause before the confirming load (default 5 s)
  log?: (line: string) => void;
  renew?: RenewConfig; // keep the shared container's operator grant alive (src/renew.ts)
  statusPath?: string; // write a public status file after each round (for /prove and the dashboard)
  proveUrl?: string; // also run this /prove page in the browser after each round and publish its rows in the status
}

interface DomainState {
  gate: string;
  lastProposal: number; // proposals up to this id were looked at
  confirmedGate?: string; // the gate this domain confirmed in /.well-known/signet.json (pinned)
  alerted: string | null; // the mismatch the team was last told about
  note: string; // the last reason the site could not be checked (posted once)
  manifests: Record<string, Sealed>; // verified manifests by hash: the current one and the previous one
  status: 'new' | 'ok' | 'mismatch' | 'unreachable' | 'unchecked';
  checkedAt: number;
  release?: number;
}
export interface State { nextIndex: number; domains: Record<string, DomainState>; renew?: { error: string; low: boolean } }

/// The public status file: what the watchtower saw last, per domain (no secrets, no alert texts).
export interface Status {
  updatedAt: string;
  network: string;
  domains: { domain: string; status: DomainState['status']; checkedAt: string | null; release: number | null }[];
  operator: { until: string; daysLeft: number; renewedThisRound: boolean } | null;
  prove?: ProveRun; // the last finished run of /prove (kept from earlier rounds until a newer one finishes)
}
export interface ProveRun { checkedAt: string; block: string | null; summary: string; rows: { claim: string; status: string; detail: string }[] } // nextIndex: how far into the registry's domain list we have read

export function loadState(path: string, fromIndex: number): State {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as State) : { nextIndex: fromIndex, domains: {} };
}
function saveState(path: string, s: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s));
}

const TIER = ['00', '01', '10', '11'];
const when = (t: number) => new Date(t * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const fingerprint = (r: SiteCheck) => `${r.status}|${r.findings.map((f) => `${f.kind}:${f.url}`).sort().join('|')}`;

export interface TickResult { domains: number; checked: number; alerts: number; posts: number }

export async function tick(c: Config, browser: Browser): Promise<TickResult> {
  const log = c.log ?? console.log;
  const state = loadState(c.statePath, c.fromIndex ?? 0);
  const out: TickResult = { domains: 0, checked: 0, alerts: 0, posts: 0 };
  const watched = (d: string) => !c.only || c.only.includes(d);
  const post = async (audience: 'private' | 'public', title: string, lines: string[]) => {
    await c.alert.send({ audience, title, lines });
    if (audience === 'private') out.alerts++;
    else out.posts++;
  };

  // 0. the shared container's operator grant: renew it when fewer than 7 days are left
  let operator: Status['operator'] = null;
  if (c.renew) {
    const rs = (state.renew ??= { error: '', low: false });
    try {
      const r = await renewIfDue(c.renew);
      operator = { until: new Date(r.until * 1000).toISOString(), daysLeft: Math.round(r.daysLeft * 10) / 10, renewedThisRound: r.renewed };
      if (r.renewed) await post('private', 'Renewed the file store operator grant', [`SignetRegistry can write release manifests until ${when(r.until)}.`, `Tx ${r.tx}, sent by the renewer ${r.renewer} (balance ${r.balance} OKB).`]);
      if (rs.error) await post('private', 'Operator renewal works again', [`Grant valid until ${when(r.until)}.`]);
      rs.error = '';
      if (r.low && !rs.low) await post('private', 'The renewer wallet is low on OKB', [`${r.renewer} holds ${r.balance} OKB. Each renewal costs ≈ 0.0000025 OKB; please top it up.`]);
      rs.low = r.low;
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0]!;
      if (rs.error !== msg) await post('private', 'Operator renewal FAILED', [msg, 'Until it is renewed, new releases\' manifests may not be stored (Guard would show "could not check"). Anyone can call siteGate.renewOperator(processor, 5).']);
      rs.error = msg;
    }
  }

  // 1. domains added to the registry's list since the last round
  const { domains, next } = await newDomains(c.net, state.nextIndex);
  for (const domain of domains) {
    if (!watched(domain) || state.domains[domain]) continue;
    const g = await gateView(c.net, domain);
    if (!g) continue; // claimed and unbound again before we looked
    state.domains[domain] = { gate: g.gate, lastProposal: 0, alerted: null, note: '', manifests: {}, status: 'new', checkedAt: 0 };
    await post('public', `New sealed domain: ${domain}`, [`Gate ${g.gate}.`, 'Signet now watches this site. It starts in observe mode.']);
  }
  state.nextIndex = next;

  for (const [domain, ds] of Object.entries(state.domains)) {
    if (!watched(domain)) continue;
    out.domains++;
    try {
      const g = await gateView(c.net, domain);
      if (!g) {
        if (ds.note !== 'unbound') await post('public', `No longer sealed: ${domain}`, ['The registry no longer binds this domain to a gate. Guard shows it as not protected.']);
        ds.note = 'unbound';
        continue;
      }
      if (g.gate.toLowerCase() !== ds.gate.toLowerCase()) {
        // a domain that was transferred, or unbound and claimed by another gate: its history starts over
        await post('public', `Domain moved to another gate: ${domain}`, [`Gate ${g.gate}. It was bound to ${ds.gate} before.`]);
        Object.assign(ds, { gate: g.gate, lastProposal: 0, alerted: null, manifests: {}, confirmedGate: undefined });
      }
      if (ds.note === 'unbound') ds.note = '';

      // the domain must confirm its gate (/.well-known/signet.json, docs/domain-ownership.md): a gate bound by
      // someone who doesn't control the domain (squatting) is ignored, with no checks and no alerts
      // Pinned, as in Guard: once the domain has confirmed this gate it stays watched, so a site that goes down or a
      // hijack that removes the file is still checked and alerted. A new gate needs a new confirmation.
      const pinned = !!ds.confirmedGate && ds.confirmedGate.toLowerCase() === g.gate.toLowerCase();
      if (!pinned) {
        if (!(await domainConfirms(browser, c.urlFor(domain), g.gate, c.net.chainId))) {
          if (ds.note !== 'unconfirmed') log(`${domain}: not verified (its /.well-known/signet.json doesn't name gate ${g.gate}): ignored`);
          ds.note = 'unconfirmed';
          continue;
        }
        ds.confirmedGate = g.gate;
      }
      if (ds.note === 'unconfirmed') ds.note = '';

      // 2. pending tier-10 / tier-11 proposals: posted once each, so nobody has to watch the chain to see them
      for (const p of await openProposals(c.net, g, ds.lastProposal)) {
        if (p.tier < 2) continue;
        const what = p.tier === 3 ? 'An admin change (approvers, domain binding, timelocks or circuit)' : 'A release that changes the allowlist of contracts and spenders';
        await post('public', `Pending tier-${TIER[p.tier]} change on ${domain}: proposal #${p.id}`, [
          `${what} was proposed at ${when(p.proposedAt)}.`,
          `${p.approvals} of 3 approvals so far. It needs ${p.tier === 3 ? '3 of 3' : '2 of 3'} and a ${Math.round(g.longDelay / 3600)} h timelock${p.tier === 2 && p.emergency ? ', or 3 of 3 at once (emergency fast lane requested)' : ''}.`,
          p.earliest ? `Earliest publish: ${when(p.earliest)}.` : 'The timelock has not started yet.',
          `Expires ${when(p.expiresAt)}. Gate ${g.gate}.`,
          'If you are on this team and did not expect this: signet cancel ' + p.id + ' or signet freeze.',
        ]);
      }
      ds.lastProposal = g.proposalCount;

      // 3. the live site against the sealed release
      const skip = async (note: string, title: string, lines: string[]) => {
        if (ds.note !== note) await post('private', title, lines);
        ds.note = note;
        ds.status = 'unchecked';
      };
      if (g.release === 0) {
        ds.status = 'unchecked'; // nothing published yet: nothing to compare with
        continue;
      }
      if (g.revoked) {
        await skip(`revoked:${g.current}`, `Release revoked: ${domain}`, [`Release #${g.release} was revoked by an approver. Guard refuses signatures on this site until a new release is published.`, `Gate ${g.gate}.`]);
        continue;
      }
      if (!ds.manifests[g.current!]) {
        const { sealed, why } = await sealedLists(c.net, domain, g);
        if (!sealed) {
          await skip(`manifest:${g.current}:${why}`, `Can't check ${domain}: ${why}`, [`Release #${g.release} is published, but ${why}. Run: signet upload <buildDir>.`, 'Until then Guard shows this site as "could not check" and the watchtower can\'t compare it.']);
          continue;
        }
        ds.manifests[g.current!] = sealed;
      }
      for (const h of Object.keys(ds.manifests)) {
        if (h !== g.current && !(await isValidManifest(c.net, g.gate, h as `0x${string}`))) delete ds.manifests[h]; // its grace window is over
      }
      ds.note = '';
      const valid = Object.values(ds.manifests);
      const url = c.urlFor(domain);
      let r = await checkSite(browser, url, valid);
      out.checked++;
      if (r.status !== 'ok') {
        // confirm before alerting: one bad load can be a deploy in progress or a network blip
        await new Promise((res) => setTimeout(res, c.confirmDelayMs ?? 5000));
        const second = await checkSite(browser, url, valid);
        if (second.status === 'ok') {
          log(`[${new Date().toISOString()}] ${domain}: ${r.status} on one load, clean on the next. Not confirmed, no alert.`);
          r = second;
        } else r = second;
      }
      ds.status = r.status;
      ds.checkedAt = Date.now();
      ds.release = g.release;
      if (r.status === 'ok') {
        if (ds.alerted) await post('private', `Recovered: ${domain} matches its sealed release again`, [`Release #${g.release}. ${r.checked} files compared.`]);
        ds.alerted = null;
      } else if (ds.alerted !== fingerprint(r)) {
        ds.alerted = fingerprint(r);
        if (r.status === 'mismatch') {
          await post('private', `ALERT: ${domain} does not match its sealed release`, [
            `The live site served code that differs from release #${g.release}, on two loads in a row.`,
            ...r.findings.slice(0, 12).map((f) => `- ${f.kind}: ${f.url} (${f.note})`),
            ...(r.findings.length > 12 ? [`- and ${r.findings.length - 12} more`] : []),
            'If you did not deploy this: freeze the gate (signet freeze), lock the registrar account, check DNS and the CDN.',
            `If you did deploy it: it was not published on-chain first. Manifest ${g.current}, gate ${g.gate}${g.enforced ? '' : ' (observe mode: Guard is not blocking users)'}.`,
          ]);
        } else {
          await post('private', `ALERT: ${domain} can't be loaded`, [`${url} failed on two loads in a row: ${r.error ?? 'no response'}.`, 'A site that stops answering can be a DNS or hosting problem, or the first step of a hijack.']);
        }
      }
    } catch (e) {
      // could not read the chain for this domain: say so on the console, never guess
      log(`[${new Date().toISOString()}] ${domain}: not checked this round (${(e as Error).message.split('\n')[0]})`);
    }
  }
  saveState(c.statePath, state);
  if (c.statusPath) {
    const status: Status = {
      updatedAt: new Date().toISOString(),
      network: c.net.name,
      domains: Object.entries(state.domains).filter(([d]) => watched(d)).map(([domain, d]) => ({ domain, status: d.status, checkedAt: d.checkedAt ? new Date(d.checkedAt).toISOString() : null, release: d.release ?? null })),
      operator,
    };
    const before = existsSync(c.statusPath) ? (JSON.parse(readFileSync(c.statusPath, 'utf8')) as Partial<Status>) : {};
    if (before.prove) status.prove = before.prove;
    mkdirSync(dirname(c.statusPath), { recursive: true });
    writeFileSync(c.statusPath, JSON.stringify(status, null, 2) + '\n');
  }
  return out;
}

export async function run(c: Config, o: { intervalSec: number; once?: boolean; chromiumArgs?: string[] }): Promise<void> {
  const log = c.log ?? console.log;
  const browser = await chromium.launch({ headless: true, args: o.chromiumArgs ?? [] });
  log(`watchtower on ${c.net.name} (chain ${c.net.chainId}), registry ${c.net.registry}, every ${o.intervalSec}s${c.net.rpcUrl2 ? ', 2 RPCs must agree' : ', ONE RPC only (set SIGNET_RPC_URL2)'}`);
  try {
    for (;;) {
      const started = Date.now();
      try {
        const r = await tick(c, browser);
        log(`[${new Date().toISOString()}] round done: ${r.domains} domain(s), ${r.checked} site(s) loaded, ${r.alerts} alert(s), ${r.posts} post(s)`);
        if (c.proveUrl && c.statusPath && existsSync(c.statusPath)) {
          const pr = await proveRun(browser, c.proveUrl);
          if ('error' in pr) log(`[${new Date().toISOString()}] /prove not recorded: ${pr.error}`);
          else {
            const st = JSON.parse(readFileSync(c.statusPath, 'utf8')) as Status;
            writeFileSync(c.statusPath, JSON.stringify({ ...st, prove: pr }, null, 2) + '\n');
            log(`[${new Date().toISOString()}] /prove at block ${pr.block}: ${pr.summary}`);
            // the rows that didn't pass, in the run's log too (status.json keeps only the latest round)
            for (const row of pr.rows.filter((x) => x.status !== 'PASS' && x.status !== 'PENDING')) log(`  ${row.status}: ${row.claim}: ${row.detail}`);
          }
        }
      } catch (e) {
        log(`[${new Date().toISOString()}] round failed: ${(e as Error).message.split('\n')[0]}`);
      }
      if (o.once) return;
      await new Promise((res) => setTimeout(res, Math.max(1000, o.intervalSec * 1000 - (Date.now() - started))));
    }
  } finally {
    await browser.close();
  }
}

/// Run the public /prove page in the watchtower's browser (the same code every visitor runs, reading the chain itself)
/// and keep its rows, so /prove can show the last result at once, dated, while a visitor's own check runs. Only a run
/// that finished within the time limit is kept; one that didn't is not recorded (the previous one stays, with its date).
export async function proveRun(browser: Browser, url: string, timeoutMs = 90_000): Promise<ProveRun | { error: string }> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => !!(document.querySelector('#app') as HTMLElement | null)?.dataset.proveDone, null, { timeout: timeoutMs });
    return await page.evaluate(() => {
      const t = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const rows = [...document.querySelectorAll('#rows .claim')].map((li) => ({
        claim: t(li.querySelector('.what')), detail: t(li.querySelector('.detail')),
        status: [...(li.querySelector('.st')?.classList ?? [])].find((c) => c !== 'st') ?? 'unknown',
      }));
      return { checkedAt: new Date().toISOString(), block: (document.querySelector('#app') as HTMLElement).dataset.proveDone ?? null, summary: t(document.querySelector('#sum')), rows };
    });
  } catch (e) {
    return { error: (e as Error).message.split('\n')[0]! };
  } finally {
    await ctx.close();
  }
}
