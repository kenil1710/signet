#!/usr/bin/env python3
# Re-checks every file in docs/verify/ against X Layer mainnet (read-only, no wallet): each standard-JSON input is
# compiled with plain solc 0.8.24 and must give the on-chain runtime code exactly (immutables masked); each
# constructor-args file must be exactly what follows the creation code in the deploy transaction.
#   python3 docs/verify/check.py        (needs foundry's solc 0.8.24, cast)
import json, subprocess, glob, os
HERE = os.path.dirname(os.path.abspath(__file__))
RPC = 'https://xlayerrpc.okx.com'
SOLC = next(iter(glob.glob(os.path.expanduser('~/Library/Application Support/svm/0.8.24/solc-0.8.24')) + glob.glob(os.path.expanduser('~/.svm/0.8.24/solc-0.8.24'))), 'solc')
C = {'SignetRegistry': ('0x98dB5B6B1545D0fb374da40a02045B93398E0589', '0x2cda992a97393d2d222f51918df0d9395433b4a78f975cd3a77cc77af17aec7c'),
     'SignetFactory': ('0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986', '0x92616ab4773a6bdc368420496b724a1d9efcb927b5ee6b0425b7e08dfaedc817'),
     'ReleaseGate': ('0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D', None)}
cast = lambda *a: subprocess.check_output(['cast', *a, '--rpc-url', RPC]).decode().strip()
ok = True
for n, (addr, tx) in C.items():
    inp = json.load(open(f'{HERE}/{n}.standard-input.json'))
    inp['settings']['outputSelection'] = {'*': {'*': ['evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences']}}
    out = json.loads(subprocess.run([SOLC, '--standard-json'], input=json.dumps(inp), capture_output=True, text=True).stdout)
    e = out['contracts'][f'src/{n}.sol'][n]['evm']
    local, chain = bytearray.fromhex(e['deployedBytecode']['object']), bytearray.fromhex(cast('code', addr)[2:])
    for refs in (e['deployedBytecode'].get('immutableReferences') or {}).values():
        for r in refs: chain[r['start']:r['start'] + r['length']] = local[r['start']:r['start'] + r['length']]
    good = local == chain
    if tx:
        data = cast('tx', tx, 'input')[2:]
        good &= data.startswith(e['bytecode']['object']) and data[len(e['bytecode']['object']):] == open(f'{HERE}/{n}.constructor-args.txt').read().strip()
    print(f"{n:15} {addr}  {'OK: exact match' if good else 'MISMATCH'}")
    ok &= good
gate = cast('code', '0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503')
want = '0x363d3d373d3d3d363d73' + C['ReleaseGate'][0][2:].lower() + '5af43d82803e903d91602b57fd5bf3'
print(f"{'site gate':15} 0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503  {'OK: EIP-1167 clone of the implementation' if gate == want else 'MISMATCH'}")
raise SystemExit(0 if ok and gate == want else 1)
