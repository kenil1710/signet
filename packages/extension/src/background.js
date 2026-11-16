// Spike C service worker: keeps the latest check result per tab and shows it on the toolbar badge.
// green "OK" = every script verified; red "!" = a script differs from the sealed manifest or is unknown;
// grey "?" = nothing failed but some scripts could not be read (no-store, cross-origin): fail-open.
const BADGE = {
  ok: { text: 'OK', color: '#1a7f37' },
  tampered: { text: '!', color: '#cf222e' },
  unverified: { text: '?', color: '#6e7781' },
};
globalThis.results = {}; // tabId -> last report (read by the Spike C test runner)

let manifestPromise;
const loadManifest = () => (manifestPromise ??= fetch(chrome.runtime.getURL('signet-manifest.json')).then((r) => r.json()));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'signet-site') {
    loadManifest().then((m) => sendResponse(m.sites[msg.origin] ?? null));
    return true; // async response
  }
  if (msg?.type !== 'signet-report' || !sender.tab) return;
  const tabId = sender.tab.id;
  globalThis.results[tabId] = { ...msg.report, tabId };
  const b = BADGE[msg.report.status];
  if (!b) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  chrome.action.setBadgeText({ tabId, text: b.text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
  chrome.action.setTitle({ tabId, title: `Signet Guard: ${msg.report.status}\n` + msg.report.files.map((f) => `${f.status}  ${f.url}`).join('\n') });
});
