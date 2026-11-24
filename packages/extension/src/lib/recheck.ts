// Guard 0.3.2: what a cached copy that doesn't match the seal means (content.ts, recheck). Pure, so every case is tested.
// 2026-11-24: a real Chrome kept release #7's HTML in its HTTP cache while the site served #8; Guard said "differs".
//   - The network copy matches and the cached copy is older than this page load: the cache was stale. OK.
//   - The cached copy is from this page load and differs: this page ran other bytes than the site serves now (e.g. a
//     hijack served once). Mismatch: what this page ran is what matters.
//   - The page was loaded before the current release was published: "loaded before release #N, reload".
// Each comparison uses one clock only: the cached and fresh Date headers are the server's; the page's load time and
// the release's publish time are this computer's (Guard converts the on-chain publish time with the release's age,
// read on-chain). So no offset between clocks can turn a mismatch into a pass.

export type Recheck = { status: 'ok' | 'stale-release' | 'mismatch'; sha256: string; note?: string };
export const SLACK_MS = 2000; // the Date header has one-second resolution

export function decideRecheck(o: {
  cachedHash: string;
  cachedDate: number; // ms, the cached copy's Date header (NaN = none)
  fresh: { hash: string; date: number } | null; // the copy the site serves now (date: its Date header, NaN = none)
  sinceLoad: number; // ms since this page started (performance.now())
  valid: string[];
  release: number;
  loadedLocal: number; // ms, this computer's clock: when this page started (performance.timeOrigin)
  publishedLocal: number; // ms, this computer's clock: when the current release was published; 0 = unknown
}): Recheck {
  const { cachedHash, cachedDate, fresh, sinceLoad, valid, release, loadedLocal, publishedLocal } = o;
  const loadedAt = fresh && Number.isFinite(fresh.date) ? fresh.date - sinceLoad : NaN;
  if (fresh && valid.includes(fresh.hash) && Number.isFinite(cachedDate) && Number.isFinite(loadedAt) && cachedDate < loadedAt - SLACK_MS) {
    return { status: 'ok', sha256: fresh.hash, note: `the browser cache held an older copy (${new Date(cachedDate).toISOString()}); the copy the site serves now matches the seal` };
  }
  if (publishedLocal > 0 && loadedLocal < publishedLocal - SLACK_MS) {
    return { status: 'stale-release', sha256: cachedHash, note: `this page was loaded before release #${release} was published: reload it to check it` };
  }
  return { status: 'mismatch', sha256: cachedHash, note: fresh && valid.includes(fresh.hash) ? 'this page was served other bytes than the site serves now' : undefined };
}
