// Signet dashboard: static, hash routing (#/…), so it can be served from a container (DeWEB) as one set of files.
import './style.css';
import { home } from './pages/home.ts';
import { projectPage } from './pages/project.ts';
import { proposalPage } from './pages/proposal.ts';
import { provePage } from './pages/prove.ts';
import { badgePage } from './pages/badge.ts';
import { newPage } from './pages/new.ts';
import { NET } from './chain.ts';
import { onChainChange, switchToXLayer, walletChain } from './wallet.ts';
import { action } from './ui.ts';

// "Switch to X Layer": shown under the header whenever the wallet is on another chain
// (the bar's text is not in the static HTML: a page read without a wallet, or without JS, never mentions a wallet)
const bar = document.getElementById('chainbar')!;
let barReady = false;
const refreshChain = async () => {
  const id = await walletChain();
  const wrong = id !== null && id !== NET.chainId;
  if (wrong && !barReady) {
    bar.innerHTML = `<div class="cb-in"><span>Your wallet is on <b class="cb-now"></b>. Signet's contracts are on <b>X Layer (chain ${NET.chainId})</b>.</span>
      <button id="switchchain" class="primary">Switch to X Layer</button></div>`;
    action(bar.querySelector('#switchchain') as HTMLButtonElement, switchToXLayer, () => void refreshChain());
    barReady = true;
  }
  bar.hidden = !wrong;
  if (wrong) bar.querySelector('.cb-now')!.textContent = `chain ${id}`;
};
onChainChange(() => void refreshChain());
void refreshChain();

async function route(): Promise<void> {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = (path || '/').split('/').filter(Boolean).map(decodeURIComponent);
  for (const a of document.querySelectorAll<HTMLElement>('.top nav a[data-nav]')) a.classList.toggle('on', a.dataset.nav === (parts[0] === 'prove' ? 'prove' : 'home'));
  try {
    if (parts[0] === 'prove') await provePage();
    else if (parts[0] === 'new') await newPage();
    else if (parts[0] === 'badge' && parts[1]) await badgePage(parts[1], new URLSearchParams(query).has('embed'));
    else if (parts[0] === 'p' && parts[1] && parts[2] === 'proposal' && parts[3]) await proposalPage(parts[1], Number(parts[3]));
    else if (parts[0] === 'p' && parts[1]) await projectPage(parts[1]);
    else await home();
  } catch (e) {
    document.getElementById('app')!.innerHTML = `<p class="bad">${String((e as Error).message)}</p>`;
  }
}
window.addEventListener('hashchange', () => void route());
void route();
