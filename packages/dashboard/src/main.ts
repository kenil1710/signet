// Signet dashboard: static, hash routing (#/…), so it can be served from a container (DeWEB) as one set of files.
import './style.css';
import { home } from './pages/home.ts';
import { projectPage } from './pages/project.ts';
import { proposalPage } from './pages/proposal.ts';
import { provePage } from './pages/prove.ts';
import { badgePage } from './pages/badge.ts';

async function route(): Promise<void> {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = (path || '/').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (parts[0] === 'prove') await provePage();
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
