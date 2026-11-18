// Every outside link on the landing page, in one place. A value starting with "TODO" is not live yet: the page
// renders it as a disabled link (href="#", data-todo) instead of a broken one. Replace the TODOs when they exist.
export const SITE = {
  /** The public domain this site will be served from (used for the canonical link). */
  domain: 'TODO: the site domain, e.g. https://signet.example',
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
  setupGuide: 'TODO: <github>/blob/main/packages/cli/README.md',
  /** Threat model and claims, until the repo is public. */
  threatModel: 'TODO: <github>/blob/main/THREAT_MODEL.md',
  claims: 'TODO: <github>/blob/main/CLAIMS.md',
} as const;

export type LinkKey = keyof typeof SITE;
export const isTodo = (v: string) => v.startsWith('TODO');

/// Points every [data-link] element at its configured URL.
export function applyLinks(root: ParentNode = document): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-link]')) {
    const v = SITE[a.dataset.link as LinkKey];
    if (v === undefined) continue;
    if (isTodo(v)) {
      a.setAttribute('href', '#');
      a.dataset.todo = v;
      a.title = v;
      a.setAttribute('aria-disabled', 'true');
      a.addEventListener('click', (e) => e.preventDefault());
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
