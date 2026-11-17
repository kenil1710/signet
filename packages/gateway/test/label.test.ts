import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLabel, decodeLabel, domainOfGatewayHost } from '@signet/extension/src/lib/label.ts';

test('a domain becomes one DNS label and back, without ambiguity', () => {
  const cases: [string, string][] = [
    ['app.example.org', 'app-example-org'], ['demo.signet.test', 'demo-signet-test'], ['my-app.io', 'my--app-io'],
    ['a-b.c-d.e', 'a--b-c--d-e'], ['xn--bcher-kva.example', 'xn----bcher--kva-example'], ['a.io', 'a-io'],
  ];
  for (const [domain, label] of cases) {
    assert.equal(encodeLabel(domain), label);
    assert.equal(decodeLabel(label), domain);
    assert.ok(!label.includes('.'));
  }
  // every pair of different domains gives different labels (dots and hyphens can't be confused)
  const all = ['a-b.c', 'a.b-c', 'a.b.c', 'a-b-c.d', 'a--b.c', 'ab.c'].map((d) => encodeLabel(d));
  assert.equal(new Set(all).size, all.length);
});

test('what is not a gateway address', () => {
  assert.equal(encodeLabel(`${'a'.repeat(40)}.${'b'.repeat(40)}.org`), null, 'longer than a DNS label');
  for (const bad of ['localhost', 'copy', 'a---b', '-a-b', 'a-b-', 'A-b', 'a_b-c', '']) assert.equal(decodeLabel(bad), null, bad);
  assert.equal(domainOfGatewayHost('app-example-org.gateway.example', 'gateway.example'), 'app.example.org');
  assert.equal(domainOfGatewayHost('app-example-org.localhost:8097', 'localhost:8097'), 'app.example.org');
  assert.equal(domainOfGatewayHost('gateway.example', 'gateway.example'), null);
  assert.equal(domainOfGatewayHost('app-example-org.evil.example', 'gateway.example'), null);
  assert.equal(domainOfGatewayHost('x.app-example-org.gateway.example', 'gateway.example'), null);
  assert.equal(domainOfGatewayHost('app-example-org.gateway.example.evil.org', 'gateway.example'), null);
});
