// After createGate: which gate was created, read from the transaction itself, then confirmed against the registry at a
// block no older than the transaction's. Found on mainnet (2026-11-24, misthos.world): the page read the binding through
// both RPCs at the lower of their two heads; the second RPC was a block behind the one that had the receipt, so it
// read the state from before createGate and showed "gate 0x000…0 created". This module never reports a zero gate.
import { decodeFunctionResult, encodeFunctionData, getAddress, parseEventLogs, zeroAddress, type Address, type Hex } from 'viem';
import { factoryAbi } from '@signet/cli/src/abi.ts';
import { registryAbi } from '@signet/extension/src/lib/abi.ts';
import { agree, either, rpc, RpcBehind } from '@signet/extension/src/lib/rpc.ts';
import type { Net } from '@signet/extension/src/lib/types.ts';

export interface Log { address: string; topics: string[]; data: string }

/// The gate named by the factory's GateCreated event in a receipt's logs (only an event the factory itself emitted,
/// for this creator), or null.
export function gateFromLogs(logs: Log[], factory: Address, creator: Address): Address | null {
  const ours = logs.filter((l) => l.address.toLowerCase() === factory.toLowerCase());
  const events = parseEventLogs({ abi: factoryAbi, eventName: 'GateCreated', logs: ours as never, strict: true });
  const e = events.find((x) => getAddress(x.args.creator) === getAddress(creator));
  return e && e.args.gate !== zeroAddress ? getAddress(e.args.gate) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// registry.bindingOf(domain)'s gate, read at a block no older than `block` (both RPCs agreeing, as everywhere else).
/// Waits while an RPC is behind; gives up after `timeoutMs` (then throws).
export async function bindingAfter(net: Net, domain: string, block: number, o: { timeoutMs?: number; intervalMs?: number } = {}): Promise<Address> {
  if (!net.registry) throw new Error('Signet is not deployed on this network');
  const call = { to: net.registry, data: encodeFunctionData({ abi: registryAbi, functionName: 'bindingOf', args: [domain] }) as Hex };
  const deadline = Date.now() + (o.timeoutMs ?? 60_000);
  for (;;) {
    try {
      let raw: string;
      if (net.rpcUrl2) raw = (await agree(net, [call], block))[0]!;
      else {
        const head = parseInt(await rpc<string>(net.rpcUrl, 'eth_blockNumber', []), 16);
        if (head < block) throw new RpcBehind(`the RPC is at block ${head}, not yet at ${block}`);
        raw = await either(net, call);
      }
      const [gate] = decodeFunctionResult({ abi: registryAbi, functionName: 'bindingOf', data: raw as Hex }) as readonly [Address, Address, string];
      return getAddress(gate);
    } catch (e) {
      if (Date.now() > deadline) throw e instanceof RpcBehind ? new Error(`${e.message} after ${Math.round((o.timeoutMs ?? 60_000) / 1000)} s`) : e;
      await sleep(o.intervalMs ?? 1500);
    }
  }
}

/// The gate a createGate receipt created, confirmed by the registry binding. Throws (with the tx) rather than
/// returning a zero or unconfirmed address.
export async function createdGate(net: Net, receipt: { blockNumber: string; logs: Log[] }, factory: Address, creator: Address, domain: string, tx: string, o?: { timeoutMs?: number; intervalMs?: number }): Promise<Address> {
  const gate = gateFromLogs(receipt.logs, factory, creator);
  if (!gate) throw new Error(`the transaction succeeded but has no GateCreated event from the factory (tx ${tx}): check it in the explorer`);
  const bound = await bindingAfter(net, domain, parseInt(receipt.blockNumber, 16), o);
  if (bound !== gate) throw new Error(`the factory created gate ${gate} but the registry binds ${domain} to ${bound === zeroAddress ? 'nothing' : bound} (tx ${tx})`);
  return gate;
}
