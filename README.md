# wacuum

An Ethereum execution client written in [wac](https://git.voltrevo.com/wac.git), the C-family language for
WebAssembly GC. It vacuums up blocks.

wac already verifies a good deal of Ethereum: its packages include a beacon light client with BLS
signatures, SSZ, RLP, Merkle-Patricia proofs, keccak256 and the ABI. What it cannot do is *execute* a
block. wacuum is the execution half: the EVM, the state it runs against, and eventually the client that
imports a chain.

## Where it is

Against execution-spec-tests v5.4.0:

| | Cancun | Prague |
| --- | --- | --- |
| state tests | 16,782 of 16,847 | 18,218 of 18,869 |
| blockchain tests, imported from block RLP | 17,619 of 17,685 | 20,207 of 20,859 |
| engine tests, through `engine_newPayload` and `engine_forkchoiceUpdated` | 17,619 of 17,685 | 20,226 of 20,878 |
| block building: each engine fixture's payloads rebuilt from the mempool, same roots | 17,619 of 17,685 | running |

Every one that fails needs BLS12-381: KZG point evaluation (0x0a) and EIP-2537's precompiles (0x0b to 0x11),
which wait on wac's `bls` package; see `docs/wac-asks.md`.

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
| blocks | **done for Cancun and Prague**. Blocks and transactions decoded from RLP with every sender recovered, headers checked against their parents (base fee, blob gas, gas limit), EIP-4788 and EIP-2935 system calls, withdrawals, EIP-7685 requests (deposits, withdrawal and consolidation requests), and every root and the bloom checked. An invalid block runs on a copy of the world and leaves no trace |
| the Engine API | **done for a single fork**. `engine_newPayloadV1`–`V4` (payload to block, the hash and versioned-hash checks, VALID / INVALID / SYNCING, the `-32602` refusals), `engine_forkchoiceUpdated` with and without payload attributes, `engine_getPayloadV3`/`V4`, and `eth_sendRawTransaction` into a mempool, over JSON-RPC and HTTP with HS256 JWT authentication, from a geth-format `genesis.json`. Not yet: following a fork that activates after genesis, and blob sidecars for `getPayload`'s blobs bundle |
| persistence, devp2p, sync | not started |

## Running it

You need the `wac` command, built from the commit `wac.lock` pins:

```bash
git clone https://git.voltrevo.com/wac.git ~/src/wac
```

```bash
cd ~/src/wac && git checkout 49e5268e362d84358c62b93932e3c20c56546e1d && ./bootstrap.sh --host nodejs
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

```bash
wac task blocktests   # every Cancun blockchain test; `sh tools/blocktests.sh Prague` for Prague
```

`dist/statetest.wasm` also runs one file at a time: `wac dist/statetest.wasm --verbose --filter <name> <file>`
prints which accounts differ from the fixture's post-state, and `--trace` prints every step.

## Running the node

```bash
wac app --allow-read --allow-net cmd/wacuum.wac -o dist/wacuum
```

```bash
./dist/wacuum --genesis genesis.json --jwt-secret jwt.hex --port 8551
```

It needs a `wac` on a native host (`./bootstrap.sh --host wasmtime` or the default v8): on the JavaScript
hosts a program is given no network, whatever it is granted. `node tools/engine-e2e.mjs FIXTURE` drives a
running node through an engine fixture over HTTP, JWT and all.

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
    src/tx/decode.wac        transactions from RLP, and their senders recovered
    src/chain/block.wac      a block: header rules, system calls, execution, every root
    src/chain/genesis.wac    a chain's first block from a geth-format genesis.json
    src/engine/engine.wac    the Engine API's methods, from JSON params to JSON results
    src/engine/rpc.wac       JSON-RPC over HTTP, and the JWT gate in front of it
    src/engine/jwt.wac       HS256 JWTs, as the Engine API authenticates them
    cmd/wacuum.wac           the node: genesis, then the Engine API on a socket
    src/crypto/              a Montgomery field, short-Weierstrass curves, bn254 and its pairing
    src/precompiles/         ecrecover, RIPEMD-160, MODEXP, BLAKE2F
    test/                    wac tests; `test*` exports returning "" for a pass
    tools/statetest.wac      the state-test runner
    tools/blocktest.wac      the blockchain-test runner, importing blocks from RLP
    tools/enginetest.wac     the engine-test runner, through the Engine API's own methods
    tools/fixture.wac        what both runners read from a fixture
    tools/                   vector generators, the fixture fetcher, the cache filler
    docs/wac-asks.md         what wacuum has found wrong with, or wants from, wac
