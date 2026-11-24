// Every outside link on the site, in one place. A value starting with "TODO" is not live yet: the page shows it as
// "coming soon" (no href, not clickable) instead of a broken link. The links are written into the HTML at build time
// (vite.config.ts, staticLinks), so readers without JavaScript and crawlers see the same thing as everyone else.
export const REPO = 'https://github.com/kenil1710/signet';

/// The links for a build. `repoPublic`: the GitHub repository is public (build with SIGNET_REPO_PUBLIC=1).
export function linksFor(repoPublic: boolean) {
  return {
    /** The public domain this site is served from (used for the canonical link). */
    domain: 'https://signetguard.xyz',
    /** The public GitHub repository. */
    github: repoPublic ? REPO : 'TODO: the repository goes public in December 2026',
    /** The project's X account. */
    x: 'TODO: https://x.com/<handle>',
    /** The team's Telegram (support / "talk to us"). */
    telegram: 'TODO: https://t.me/<group>',
    /** Signet Guard's signed pre-release zip on GitHub (load unpacked), until the store listing exists. */
    guardPrerelease: repoPublic ? `${REPO}/releases/tag/guard-v0.3.2` : 'TODO: the Guard pre-release is on GitHub once the repository is public',
    /** Signet Guard on the Chrome Web Store (not submitted yet). */
    chromeWebStore: 'TODO: Chrome Web Store listing URL',
    /** The wallet-free proof page of this same app. */
    prove: 'app#/prove',
    /** The setup guide for teams. */
    setupGuide: 'start',
    /** Threat model and claims: copies served by this site, built from the repository. */
    threatModel: 'docs/THREAT_MODEL.md',
    claims: 'docs/CLAIMS.md',
    benchmark: 'docs/benchmark.md',
  } as const;
}
export type Links = ReturnType<typeof linksFor>;
export type LinkKey = keyof Links;
export const isTodo = (v: string) => v.startsWith('TODO');

/// Rewrites every <a data-link="key"> in an HTML string: a real href, or "coming soon" (no href). Used at build time.
/// `data-soon="…"` replaces the whole label of a link that isn't live (e.g. "Add Guard to Chrome" → "Guard for Chrome:
/// coming soon"), so a button never says "install" or "free" before the store listing exists.
export function applyLinksHtml(html: string, links: Links): string {
  return html.replace(/<a\b([^>]*?)\sdata-link="(\w+)"([^>]*)>([\s\S]*?)<\/a>/g, (all, pre: string, key: string, post: string, inner: string) => {
    const v = (links as Record<string, string>)[key];
    if (v === undefined) return all;
    let attrs = `${pre} data-link="${key}"${post}`.replace(/\shref="[^"]*"/, '');
    if (isTodo(v)) {
      const soon = attrs.match(/\sdata-soon="([^"]*)"/)?.[1];
      attrs = attrs.replace(/\sclass="([^"]*)"/, ' class="$1 soon"');
      if (!/\sclass=/.test(attrs)) attrs += ' class="soon"';
      const label = soon ?? `${inner} <span class="soon-tag">coming soon</span>`;
      return `<a${attrs} aria-disabled="true" title="Coming soon" data-applied="1">${label}</a>`;
    }
    const ext = /^https?:/.test(v) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${v}"${attrs}${ext} data-applied="1">${inner}</a>`;
  });
}
