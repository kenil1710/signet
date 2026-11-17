// The boot page's script, served by the gateway's server on every host and path until the service worker
// controls the origin. On a project subdomain it installs the worker and reloads; from then on the worker
// answers. On the gateway's own host it is a small landing page.
import { decodeLabel, encodeLabel } from '@signet/extension/src/lib/label.ts';

const main = document.getElementById('main')!;
const label = location.hostname.split('.')[0]!;
const domain = location.hostname.includes('.') ? decodeLabel(label) : null;
const show = (title: string, text: string) => {
  main.innerHTML = '<h1></h1><p></p>';
  main.querySelector('h1')!.textContent = title;
  main.querySelector('p')!.textContent = text;
};

if (!domain) {
  main.innerHTML = '<h1>Signet gateway</h1><p>Open the verified copy of a sealed site: the files its team published on X Layer, read and checked in your browser.</p><form id="go"><input id="d" placeholder="app.example.org" autocomplete="off" autocapitalize="off" spellcheck="false" required> <button>Open</button></form><p id="e"></p>';
  document.getElementById('go')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const l = encodeLabel((document.getElementById('d') as HTMLInputElement).value.trim().toLowerCase());
    if (l) location.href = `${location.protocol}//${l}.${location.host}/`;
    else document.getElementById('e')!.textContent = 'That is not a domain name this gateway can address.';
  });
} else if (!('serviceWorker' in navigator)) {
  show(`Can't open ${domain} here`, 'This browser (or this private window) does not allow service workers, which is what reads and checks the site. Open this address in a normal browser window.');
} else {
  show(`Opening the verified copy of ${domain}`, 'Installing the checker in your browser…');
  void (async () => {
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      location.reload();
    } catch (e) {
      show(`Can't open ${domain}`, `The checker could not be installed: ${e instanceof Error ? e.message : e}. If you just did a hard reload, reload normally once more.`);
    }
  })();
}
