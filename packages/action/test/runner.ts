// A small stand-in for the GitHub runner, enough to execute this composite action locally: it reads action.yml,
// fills in `${{ inputs.* }}`, `${{ github.action_path }}` and `${{ steps.<id>.outputs.* }}`, evaluates the one
// kind of `if:` the action uses, and runs each `run:` step the way GitHub does (bash -e -o pipefail, a failed
// step stops the rest). `uses:` steps (setup-node) are skipped. It is not GitHub: the real thing still needs
// one run in a real workflow.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ACTION_DIR = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
interface Step { name?: string; id?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; shell?: string }
export interface Action { inputs: Record<string, { required?: boolean; default?: string }>; outputs: Record<string, { value: string }>; runs: { using: string; steps: Step[] } }
export const loadAction = (): Action => parse(readFileSync(join(ACTION_DIR, 'action.yml'), 'utf8')) as Action;

export interface RunResult { code: number; log: string; ran: string[]; outputs: Record<string, string>; summary: string }

export async function runAction(inputs: Record<string, string>, o: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<RunResult> {
  const action = loadAction();
  const all: Record<string, string> = {};
  for (const [k, def] of Object.entries(action.inputs)) {
    if (inputs[k] === undefined && def.required) throw new Error(`input ${k} is required`);
    all[k] = inputs[k] ?? def.default ?? '';
  }
  for (const k of Object.keys(inputs)) if (!(k in action.inputs)) throw new Error(`unknown input ${k}`);
  const temp = mkdtempSync(join(tmpdir(), 'signet-runner-'));
  const summaryFile = join(temp, 'summary.md');
  writeFileSync(summaryFile, '');
  const stepOutputs: Record<string, Record<string, string>> = {};
  const expr = (s: string): string =>
    s.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, e: string) => {
      let m: RegExpMatchArray | null;
      if ((m = e.match(/^inputs\.([\w-]+)$/))) return all[m[1]!] ?? '';
      if (e === 'github.action_path') return ACTION_DIR;
      if ((m = e.match(/^steps\.([\w-]+)\.outputs\.([\w-]+)$/))) return stepOutputs[m[1]!]?.[m[2]!] ?? '';
      if ((m = e.match(/^inputs\.([\w-]+) != ''$/))) return String((all[m[1]!] ?? '') !== '');
      throw new Error(`the test runner does not understand \${{ ${e} }}`);
    });
  const result: RunResult = { code: 0, log: '', ran: [], outputs: {}, summary: '' };
  let n = 0;
  for (const step of action.runs.steps) {
    n++;
    if (step.uses) continue;
    if (step.if !== undefined && expr(step.if) !== 'true') continue;
    if (step.shell !== 'bash') throw new Error(`step ${n}: composite run steps need shell: bash`);
    const outFile = join(temp, `output-${n}`);
    writeFileSync(outFile, '');
    const script = join(temp, `step-${n}.sh`);
    writeFileSync(script, expr(step.run!));
    const env: NodeJS.ProcessEnv = { ...process.env, ...o.env, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: summaryFile, GITHUB_ACTION_PATH: ACTION_DIR, RUNNER_TEMP: temp };
    for (const [k, v] of Object.entries(step.env ?? {})) env[k] = expr(v);
    result.ran.push(step.name ?? `step ${n}`);
    const code = await new Promise<number>((res) => {
      const c = spawn('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], { cwd: o.cwd, env });
      c.stdout.on('data', (d) => (result.log += d));
      c.stderr.on('data', (d) => (result.log += d));
      c.on('close', (x) => res(x ?? -1));
    });
    if (step.id && existsSync(outFile)) {
      stepOutputs[step.id] = Object.fromEntries(readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    }
    if (code !== 0) {
      result.code = code;
      break;
    }
  }
  for (const [k, v] of Object.entries(action.outputs)) result.outputs[k] = expr(v.value);
  result.summary = readFileSync(summaryFile, 'utf8');
  return result;
}
