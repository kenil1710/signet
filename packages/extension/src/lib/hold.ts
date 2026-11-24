// Guard 0.3.3 (enforce mode): how long a page that doesn't match waits for a release that can be published now
// before Guard shows the red page, and how often it re-reads the chain meanwhile. Build-time overridable for the
// staging tests (__HOLD_MS__), never shorter than one poll.
declare const __HOLD_MS__: number | undefined;
export const HOLD_MS = typeof __HOLD_MS__ === 'number' && __HOLD_MS__ > 0 ? __HOLD_MS__ : 60_000;
export const POLL_MS = Math.min(5_000, HOLD_MS);
