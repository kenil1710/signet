export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
export function view(html: string): HTMLElement {
  const main = $('#app');
  main.innerHTML = html;
  return main;
}
/// The result of the last action. Outside #app, so it survives the page re-rendering after the action.
export function toast(text: string, kind: '' | 'ok' | 'bad' = ''): void {
  const t = $('#toast');
  t.textContent = text;
  t.className = kind ? `show ${kind}` : 'show';
}

/// A button that runs an action through the wallet and reports the result in the toast.
export function action(btn: HTMLButtonElement, run: () => Promise<string>, after?: () => void): void {
  btn.onclick = async () => {
    btn.disabled = true;
    toast(`${btn.textContent?.trim()}: waiting for the wallet…`);
    try {
      toast(await run(), 'ok');
      after?.();
    } catch (e) {
      toast(`${btn.textContent?.trim()}: ${(e as Error).message.split('\n')[0]}`, 'bad');
    } finally {
      btn.disabled = false;
    }
  };
}
