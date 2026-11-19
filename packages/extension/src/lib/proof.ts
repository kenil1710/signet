// The domain proof (docs/domain-ownership.md): https://<domain>/.well-known/signet.json must name the gate the
// registry binds the domain to, e.g. {"signet": 1, "chainId": 196, "gate": "0x…"}. Only someone who controls what the
// domain serves can publish it, so a gate bound to a domain by someone else (squatting) is never confirmed.
export const PROOF_PATH = '/.well-known/signet.json';

/// True only if `body` is a proof naming exactly `gate` on `chainId`. Anything else (missing, malformed, another
/// gate or chain, oversized) is false.
export function proofNames(body: string | null | undefined, gate: string, chainId: number): boolean {
  if (!body || body.length > 4096) return false;
  try {
    const j = JSON.parse(body) as { signet?: unknown; chainId?: unknown; gate?: unknown };
    return j.signet === 1 && j.chainId === chainId && typeof j.gate === 'string' && /^0x[0-9a-fA-F]{40}$/.test(j.gate) && j.gate.toLowerCase() === gate.toLowerCase();
  } catch {
    return false;
  }
}
