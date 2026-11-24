// Guard 0.3.3: "a release can publish now" (the red page waits for it in enforce mode). Pure part: every rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPublishNow, PROPOSAL_TTL, type GateNow, type ProposalView } from '../src/lib/publishing.ts';

const g: GateNow = { currentRelease: 9n, approverSet: 1n, frozen: false, chainNow: 1_000_000 };
const p: ProposalView = { kind: 1, executed: false, cancelled: false, proposedAt: 1_000_000 - 7200, baseRelease: 9n, approverSet: 1n };
// bits a0 a1 a2 tS tL r1 r0 f e
const T00_ONE_SHORT = 0b000001001; // tier 00, approver A, short timelock over
const T00_ONE_EARLY = 0b000000001; // tier 00, approver A, timelock running
const T10_TWO_LONG = 0b000111011; // tier 10, A and B, long timelock over
const T10_TWO_SHORT = 0b000101011; // tier 10, A and B, only the short timelock over

test('tier 00 with one approval and the timelock over: can publish now', () => assert.equal(canPublishNow(p, T00_ONE_SHORT, g), true));
test('timelock still running: not now', () => assert.equal(canPublishNow(p, T00_ONE_EARLY, g), false));
test('tier 10 needs the long timelock', () => {
  assert.equal(canPublishNow(p, T10_TWO_SHORT, g), false);
  assert.equal(canPublishNow(p, T10_TWO_LONG, g), true);
});
test('frozen (gate or the frozen bit): never', () => {
  assert.equal(canPublishNow(p, T00_ONE_SHORT, { ...g, frozen: true }), false);
  assert.equal(canPublishNow(p, T00_ONE_SHORT | 0b010000000, g), false);
});
test('executed, cancelled, an admin proposal, another approver set: not a pending release', () => {
  assert.equal(canPublishNow({ ...p, executed: true }, T00_ONE_SHORT, g), false);
  assert.equal(canPublishNow({ ...p, cancelled: true }, T00_ONE_SHORT, g), false);
  assert.equal(canPublishNow({ ...p, kind: 2 }, T00_ONE_SHORT, g), false);
  assert.equal(canPublishNow({ ...p, approverSet: 0n }, T00_ONE_SHORT, g), false);
});
test('built on an older release (another one was published since): stale, not now', () => assert.equal(canPublishNow({ ...p, baseRelease: 8n }, T00_ONE_SHORT, g), false));
test('expired after 7 days', () => {
  assert.equal(canPublishNow({ ...p, proposedAt: g.chainNow - PROPOSAL_TTL }, T00_ONE_SHORT, g), true);
  assert.equal(canPublishNow({ ...p, proposedAt: g.chainNow - PROPOSAL_TTL - 1 }, T00_ONE_SHORT, g), false);
});
