import type { GuardEvent, PageReport, SiteState } from '../lib/types.ts';

export interface TabInfo { tab: { domain: string; url: string; report: PageReport | null }; site: Omit<SiteState, 'manifests'>; light: 'green' | 'red' | 'grey'; events: GuardEvent[]; files: number; contracts?: number; decider?: { by: string; why: string | null; at: number } | null }
export const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
export const send = <T>(msg: unknown) => chrome.runtime.sendMessage(msg) as Promise<T>;

/// "Report wrong block": builds the report locally and copies it. Guard sends nothing by itself.
export async function reportWrongBlock(domain: string, note: string, into: HTMLElement): Promise<void> {
  const text = await send<string>({ type: 'wrong-block', domain, note });
  try {
    await navigator.clipboard.writeText(text);
    into.textContent = 'Report copied to the clipboard. Send it to the team that runs this site. Guard itself sends nothing.';
  } catch {
    into.textContent = 'Report saved. Copy it from here and send it to the team:';
    const pre = document.createElement('pre');
    pre.className = 'mono';
    pre.textContent = text;
    into.append(pre);
  }
}

export function headline(i: TabInfo): { title: string; text: string } {
  const s = i.site;
  if (i.light === 'green') return { title: 'Sealed', text: `Release #${s.release} · this page matches what the team sealed.` };
  if (i.light === 'red') return s.status === 'revoked'
    ? { title: 'Release revoked', text: "The team revoked this site's current release. Don't sign anything here." }
    : { title: "Doesn't match the sealed release", text: `This page is not what the team sealed as release #${s.release}. Don't sign.` };
  if (s.status === 'sealed') return { title: 'Sealed, not fully checked', text: 'Some files could not be read from the browser cache, so Guard cannot vouch for them. Signing is still checked against the sealed allowlist.' };
  if (s.status === 'unconfirmed') return { title: 'Not verified', text: "Not verified: this site hasn't confirmed this gate. Guard doesn't check, block or offer a copy here." };
  if (s.status === 'no-release') return { title: 'No sealed release yet', text: s.reason };
  return { title: 'Could not check', text: `${s.reason} Guard does not block when it cannot check.` };
}
