// Placeholder (the dashboard is built later). Shows which chain this build talks to.
const net = __SIGNET_NETWORK__;
const app = document.querySelector<HTMLDivElement>('#app');
if (app) app.textContent = `Signet dashboard (placeholder) · network: ${net.name} · RPC: ${net.rpcUrl} · registry: ${net.contracts.registry ?? 'not deployed'}`;
