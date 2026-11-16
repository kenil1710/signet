// Placeholder demo page (Spike C test target). The real swap/stake page comes later (build plan, Dec 1).
const app = document.querySelector<HTMLDivElement>('#app');
if (app) app.textContent = `Signet demo dApp (placeholder) · network: ${__SIGNET_NETWORK__.name} · RPC: ${__SIGNET_NETWORK__.rpcUrl}`;

// A lazily loaded chunk: it never appears as a <script> element, only in resource timing.
void import('./lazy').then((m) => m.mark(app));
