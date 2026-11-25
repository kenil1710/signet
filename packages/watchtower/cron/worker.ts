// The watchtower's clock: a Cloudflare Worker (free plan) whose cron trigger starts the `watchtower` GitHub workflow
// every 5 minutes with workflow_dispatch. GitHub's own `schedule` is best-effort and was hours late; dispatches start
// at once. The round itself (real browser, Telegram alerts, the `watchtower-status` branch) stays in the workflow.
// It skips a beat when a round is still queued or running, so rounds never pile up.
// Secret: GH_TOKEN, a fine-grained token for kenil1710/signet only, permission "Actions: read and write"
// (set with `npx wrangler secret put GH_TOKEN`, typed into the prompt). It can start and list workflow runs, nothing else.
interface Env { GH_TOKEN: string; REPO: string; WORKFLOW: string; REF: string }

const gh = (env: Env, path: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'signet-watchtower-cron', ...(init.headers ?? {}) },
  });

export async function tick(env: Env): Promise<string> {
  if (!env.GH_TOKEN) return 'no GH_TOKEN set: nothing dispatched';
  for (const status of ['in_progress', 'queued']) {
    const r = await gh(env, `/runs?status=${status}&per_page=1`);
    if (!r.ok) throw new Error(`listing ${status} runs: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    if (((await r.json()) as { total_count: number }).total_count > 0) return `a round is ${status}: skipped`;
  }
  const r = await gh(env, '/dispatches', { method: 'POST', body: JSON.stringify({ ref: env.REF }), headers: { 'content-type': 'application/json' } });
  if (r.status !== 204) throw new Error(`dispatch: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return 'round dispatched';
}

export default {
  async scheduled(_c: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(tick(env).then((m) => console.log(m), (e: Error) => { console.error(e.message); throw e; }));
  },
};
