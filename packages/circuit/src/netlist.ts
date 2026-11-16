// TapeOut netlist builder, encoder, decoder and one-beat evaluator, following TAP-02 exactly
// (docs/tapeout-interfaces.md §2): signals 0 = const 0, 1 = const 1, 2 + i = input i, then element outputs
// in record order; NAND record = 0x00 a:u24 b:u24 (big-endian); outputs = the LAST nOut signals;
// bit i of a packed vector = bit (i mod 8) of byte floor(i / 8).
// This evaluator supports NAND and LATCH records (no REF); the policy circuit uses NAND only.

export type Netlist = { bytes: Uint8Array; nIn: number; nOut: number };

export class NetlistBuilder {
  readonly nIn: number;
  private readonly recs: number[] = [];
  private nextSignal: number;
  readonly names = new Map<number, string>();

  constructor(nIn: number) {
    if (nIn < 0 || nIn > 65_536) throw new Error('too many pins');
    this.nIn = nIn;
    this.nextSignal = 2 + nIn;
  }

  input(i: number): number {
    if (i < 0 || i >= this.nIn) throw new Error(`no input ${i}`);
    return 2 + i;
  }

  nand(a: number, b: number, name?: string): number {
    const s = this.nextSignal;
    if (a >= s || b >= s) throw new Error('NAND: future signal');
    this.recs.push(0x00, (a >> 16) & 0xff, (a >> 8) & 0xff, a & 0xff, (b >> 16) & 0xff, (b >> 8) & 0xff, b & 0xff);
    if (name) this.names.set(s, name);
    this.nextSignal++;
    return s;
  }

  not(a: number, name?: string): number {
    return this.nand(a, a, name);
  }

  get gates(): number {
    return this.nextSignal - 2 - this.nIn;
  }

  /** The last nOut signals become the outputs, in index order. */
  build(nOut: number): Netlist {
    if (nOut < 1 || nOut > 65_536) throw new Error('no outputs');
    if (2 + this.nIn + nOut > this.nextSignal) throw new Error('too few signals for outputs');
    return { bytes: Uint8Array.from(this.recs), nIn: this.nIn, nOut };
  }
}

type Rec = { op: 'NAND'; a: number; b: number } | { op: 'LATCH'; d: number };

/** Decode and check well-formedness (TAP-02 §3 conditions 1-5, 8 for NAND/LATCH netlists). */
export function decode(n: Netlist): { recs: Rec[]; nState: number; signals: number } {
  const b = n.bytes;
  const recs: Rec[] = [];
  let i = 0;
  let s = 2 + n.nIn;
  let nState = 0;
  const u24 = (o: number) => {
    if (o + 3 > b.length) throw new Error('truncated record');
    return (b[o]! << 16) | (b[o + 1]! << 8) | b[o + 2]!;
  };
  while (i < b.length) {
    const op = b[i]!;
    if (op === 0x00) {
      const a = u24(i + 1);
      const c = u24(i + 4);
      if (a >= s || c >= s) throw new Error('NAND: future signal');
      recs.push({ op: 'NAND', a, b: c });
      i += 7;
    } else if (op === 0x01) {
      recs.push({ op: 'LATCH', d: u24(i + 1) });
      nState++;
      i += 4;
    } else if (op === 0x02) {
      throw new Error('REF is not supported by this evaluator');
    } else {
      throw new Error('bad opcode');
    }
    s++;
  }
  if (n.nOut < 1) throw new Error('no outputs');
  if (n.nIn > 65_536 || n.nOut > 65_536) throw new Error('too many pins');
  if (2 + n.nIn + n.nOut > s) throw new Error('too few signals for outputs');
  for (const r of recs) if (r.op === 'LATCH' && r.d >= s) throw new Error('LATCH d out of range');
  if (s > 1 << 24) throw new Error('size overflow');
  return { recs, nState, signals: s };
}

export function pack(bits: boolean[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((v, i) => {
    if (v) out[i >> 3]! |= 1 << (i & 7);
  });
  return out;
}

export function unpack(bytes: Uint8Array, n: number): boolean[] {
  return Array.from({ length: n }, (_, i) => (i >> 3 < bytes.length ? ((bytes[i >> 3]! >> (i & 7)) & 1) === 1 : false));
}

/** One beat (TAP-02 §4). Returns packed outputs and new state. */
export function step(n: Netlist, state: Uint8Array, inputs: Uint8Array): { outputs: Uint8Array; newState: Uint8Array } {
  const { recs, nState, signals } = decode(n);
  const st = unpack(state, nState);
  const sig = new Array<boolean>(signals).fill(false);
  sig[1] = true;
  unpack(inputs, n.nIn).forEach((v, i) => (sig[2 + i] = v));
  let k = 2 + n.nIn;
  let latch = 0;
  const latchD: number[] = [];
  for (const r of recs) {
    if (r.op === 'NAND') sig[k] = !(sig[r.a]! && sig[r.b]!);
    else {
      sig[k] = st[latch++]!;
      latchD.push(r.d);
    }
    k++;
  }
  return {
    outputs: pack(sig.slice(signals - n.nOut)),
    newState: pack(latchD.map((d) => sig[d]!)),
  };
}

/** eval() semantics: combinational circuits only. */
export function evaluate(n: Netlist, inputs: Uint8Array): Uint8Array {
  if (decode(n).nState > 0) throw new Error('has latch: use step');
  return step(n, new Uint8Array(0), inputs).outputs;
}

export const toHex = (b: Uint8Array) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
