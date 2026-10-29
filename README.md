# wacuum

An Ethereum execution client written in [wac](https://git.voltrevo.com/wac.git), the C-family language for
WebAssembly GC. It vacuums up blocks.

wac already verifies a good deal of Ethereum: its packages include a beacon light client with BLS
signatures, SSZ, RLP, Merkle-Patricia proofs, keccak256 and the ABI. What it cannot do is *execute* a
block. wacuum is the execution half: the EVM, the state it runs against, and eventually the client that
imports a chain.

## Where it is

Of execution-spec-tests' state tests (v5.4.0), **16,782 of 16,847 pass for Cancun and 18,218 of 18,869 for
Prague**. Every one that fails needs BLS12-381: KZG point evaluation (0x0a) and EIP-2537's precompiles
(0x0b to 0x11), which wait on wac's `bls` package; see `docs/wac-asks.md`.

| | state |
| --- | --- |
| `U256`, the EVM word | **done**. Every arithmetic, comparison and bit operation the EVM has, checked against BigInt over every pair of nine edge values and 192 random cases |
| the interpreter | **done for Cancun**. Every opcode, with EIP-2929 access costs, EIP-2200/3529 SSTORE metering and refunds, EIP-1153 transient storage, EIP-6780 SELFDESTRUCT |
| calls and creation | **done**. The CALL family with EIP-150's 63/64 and the stipend, CREATE and CREATE2 with collision, EIP-3860 and EIP-170 limits |
| world state | **done**. One journal undoes everything a failed frame did; EIP-161 sweeps touched empty accounts |
| transactions | **done for types 0 to 3**. Validity, intrinsic gas, EIP-1559 fees, EIP-4844 blob fees, refunds, the coinbase's share |
| state root, logs hash | **done**. A Merkle-Patricia trie built from scratch, checked against `trieanyorder.json` |
| precompiles | **all but one**. ecrecover (secp256k1), SHA-256, RIPEMD-160, identity, MODEXP, bn254 add, mul and pairing, BLAKE2F. KZG point evaluation waits on BLS12-381; see `docs/wac-asks.md` |
| Prague | **done but for BLS12-381**. EIP-7702 delegation (authorities recovered, not taken from the fixture), EIP-7623's calldata floor, EIP-7691's blob schedule. EIP-2935 and the requests of EIP-7685 belong to blocks, below |
| blocks, the Engine API, persistence, devp2p, sync | not started |

## Running it

You need the `wac` command, built from the commit `wac.lock` pins:

```bash
git clone https://git.voltrevo.com/wac.git ~/src/wac
```

```bash
cd ~/src/wac && git checkout a473e07b04b84e63cd4918e57cc866ec553d0247 && ./bootstrap.sh --host nodejs
```

Then, in this repository:

```bash
wac update            # or, without network access: sh tools/use-local-wac.sh ~/src/wac
```

```bash
wac task test         # the unit tests, in about a second
```

```bash
wac task fixtures     # execution-spec-tests v5.4.0 into fixtures/, once: 250 MB to fetch
```

```bash
wac task statetests   # every Cancun state test, in about a minute; `sh tools/statetests.sh Prague` for Prague
```

`dist/statetest.wasm` also runs one file at a time: `wac dist/statetest.wasm --verbose --filter <name> <file>`
prints which accounts differ from the fixture's post-state, and `--trace` prints every step.

## Layout

    src/u256.wac             the 256-bit word, with the EVM's semantics
    src/limbs.wac            integers of any length, for U256's wide operations and MODEXP
    src/hex.wac              0x-hex text and bytes
    src/evm/table.wac        each opcode's stack effect and static gas
    src/evm/memory.wac       memory, and what growing it costs
    src/evm/interp.wac       the interpreter loop and the opcodes
    src/evm/evm.wac          messages: calls, creation, addresses
    src/evm/precompiles.wac  the precompile dispatcher and its prices
    src/evm/spec.wac         what differs between forks, as data
    src/state/world.wac      accounts, storage and the journal that undoes them
    src/state/root.wac       the state root and the logs hash
    src/trie/trie.wac        a Merkle-Patricia root from a set of pairs
    src/tx/process.wac       a transaction, from validity to the coinbase's fee
    src/crypto/              a Montgomery field, short-Weierstrass curves, bn254 and its pairing
    src/precompiles/         ecrecover, RIPEMD-160, MODEXP, BLAKE2F
    test/                    wac tests; `test*` exports returning "" for a pass
    tools/statetest.wac      the state-test runner
    tools/                   vector generators, the fixture fetcher, the cache filler
    docs/wac-asks.md         what wacuum has found wrong with, or wants from, wac
