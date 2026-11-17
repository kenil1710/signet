// Static checks of action.yml and the example workflow (no chain needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loadAction, ACTION_DIR } from './runner.ts';

const read = (f: string) => readFileSync(join(ACTION_DIR, f), 'utf8');

test('action.yml is a composite action whose deploy step comes last, after the step that waits for the chain', () => {
  const a = loadAction();
  assert.equal(a.runs.using, 'composite');
  const steps = a.runs.steps;
  const main = steps.findIndex((s) => s.id === 'signet');
  const deploy = steps.findIndex((s) => s.run === '${{ inputs.deploy }}');
  assert.ok(main >= 0 && deploy === steps.length - 1 && deploy > main);
  assert.equal(steps[deploy]!.if, "${{ inputs.deploy != '' }}");
  for (const s of steps) assert.ok(s.uses || s.shell === 'bash', 'every run step of a composite action needs a shell');
  for (const s of steps) assert.ok(!/always\(\)|continue-on-error/.test(JSON.stringify(s)), 'nothing may run after a failed wait');
  assert.ok(a.inputs['build-dir']!.required && a.inputs['proposer-key']!.required);
});

test('inputs reach the scripts only through env (no ${{ }} inside shell code), and the key only reaches propose, publish and upload', () => {
  const a = loadAction();
  const main = a.runs.steps.find((s) => s.id === 'signet')!;
  assert.ok(!/\$\{\{\s*inputs/.test(main.run!));
  assert.deepEqual(Object.keys(main.env!).sort(), ['INPUT_BUILD_DIR', 'INPUT_EMERGENCY', 'INPUT_POLL_INTERVAL', 'INPUT_PROJECT_DIR', 'INPUT_PROPOSER_KEY', 'INPUT_PUBLISH', 'INPUT_STRICT', 'INPUT_UPLOAD_MANIFEST', 'INPUT_WAIT_TIMEOUT']);
  const sh = read('run.sh');
  const withKey = sh.split('\n').filter((l) => l.includes('SIGNET_PROPOSER_KEY="$KEY"'));
  assert.equal(withKey.length, 3); // propose, wait --publish (the permissionless publish call), upload
  assert.ok(withKey.every((l) => /signet (upload|wait "\$BUILD" --publish|"\$\{ARGS\[@\]\}")/.test(l)));
  assert.match(sh, /ARGS=\(propose /);
  // hard rules 4 and 5: the action never approves, unfreezes or cancels. It does send `publish`, which anyone may
  // send and only the policy circuit can grant.
  const invoked = [...sh.matchAll(/(?:^|[;(]|\$\(|then|else)\s*(?:\w+="[^"]*"\s+)?signet\s+"?(\$\{ARGS|\w+)/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(invoked)].sort(), ['${ARGS', 'diff', 'seal', 'upload', 'verify', 'wait']);
  assert.match(sh, /unset SIGNET_PRIVATE_KEY SIGNET_PROPOSER_KEY/);
  assert.match(sh, /::add-mask::\$KEY/);
});

test('the example workflow: push to main, the secret as proposer key, about 5 lines for the team', () => {
  const text = read('example-workflow.yml');
  const w = parse(text) as { on: { push: { branches: string[] } }; jobs: { release: { steps: { uses?: string; with?: Record<string, string> }[] } } };
  assert.deepEqual(w.on.push.branches, ['main']);
  const step = w.jobs.release.steps.find((s) => s.uses?.includes('signet'))!;
  assert.equal(step.with!['proposer-key'], '${{ secrets.SIGNET_PROPOSER_KEY }}');
  assert.ok(step.with!['build-dir'] && step.with!.deploy);
  const a = loadAction();
  for (const k of Object.keys(step.with!)) assert.ok(k in a.inputs, k);
  const lines = text.slice(text.indexOf('- uses: kenil1710')).trim().split('\n');
  assert.equal(lines.length, 5);
});
