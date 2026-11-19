// Every outside link on the landing page, in one place. A value starting with "TODO" is not live yet: the page
// shows it as "coming soon" (no href, not clickable) instead of a broken link. Replace the TODOs when they exist.
export const SITE = {
  /** The public domain this site will be served from (used for the canonical link). */
  domain: 'https://signetguard.xyz',
  /** The public GitHub repository. */
  github: 'TODO: https://github.com/<org>/signet',
  /** The project's X account. */
  x: 'TODO: https://x.com/<handle>',
  /** The team's Telegram (support / "talk to us"). */
  telegram: 'TODO: https://t.me/<group>',
  /** Signet Guard on the Chrome Web Store (not submitted yet). */
  chromeWebStore: 'TODO: Chrome Web Store listing URL',
  /** The wallet-free proof page of this same app. */
  prove: 'app.html#/prove',
  /** The setup guide for teams. Until the repo is public, it points at the doc inside it. */
  setupGuide: 'start',
  /** Threat model and claims, until the repo is public. */
  threatModel: 'TODO: <github>/blob/main/THREAT_MODEL.md',
  claims: 'TODO: <github>/blob/main/CLAIMS.md',
} as const;

export type LinkKey = keyof typeof SITE;
export const isTodo = (v: string) => v.startsWith('TODO');

/// Points every [data-link] element at its configured URL. A link that isn't ready (TODO) is shown as "coming soon":
/// it has no href, can't be clicked or focused, and says so. "Add Guard to Chrome" reads "Coming soon" until the
/// Chrome Web Store listing exists.
export function applyLinks(root: ParentNode = document): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-link]')) {
    const key = a.dataset.link as LinkKey;
    const v = SITE[key];
    if (v === undefined) continue;
    if (isTodo(v)) {
      a.removeAttribute('href');
      a.classList.add('soon');
      a.setAttribute('aria-disabled', 'true');
      a.dataset.todo = v;
      if (key === 'chromeWebStore') {
        a.textContent = 'Coming soon';
        a.title = 'Guard for Chrome: the Chrome Web Store listing is coming soon';
      } else {
        const tag = document.createElement('span');
        tag.className = 'soon-tag';
        tag.textContent = 'coming soon';
        a.append(' ', tag);
        a.title = 'Coming soon';
      }
    } else {
      a.setAttribute('href', v);
      if (/^https?:/.test(v)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
    }
  }
  if (!isTodo(SITE.domain)) {
    const l = document.createElement('link');
    l.rel = 'canonical';
    l.href = SITE.domain;
    document.head.append(l);
  }
}
