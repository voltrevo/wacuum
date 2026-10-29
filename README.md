# wacuum

An Ethereum execution client written in [wac](https://git.voltrevo.com/wac.git), the C-family language for
WebAssembly GC. It vacuums up blocks.

wac already verifies a good deal of Ethereum: its packages include a beacon light client with BLS
signatures, SSZ, RLP, Merkle-Patricia proofs, keccak256 and the ABI. What it cannot do is *execute* a
block. wacuum is the execution half: the EVM, the state it runs against, and eventually the client that
imports a chain.

## Where it is

Against execution-spec-tests v5.4.0 (the `fixtures_develop` release, which has Osaka and the BPO forks),
every fixture of every suite passes:

| | Cancun | Prague | Osaka |
| --- | --- | --- | --- |
| state tests | 16,847 | 18,869 | 19,517 |
| blockchain tests, imported from block RLP | 17,685 | 20,859 | 21,558 |
| engine tests, through `engine_newPayload` and `engine_forkchoiceUpdated` | 17,685 | 20,878 | 21,577 |
| block building: each engine fixture's payloads rebuilt from the mempool, same roots | 17,685 | 20,878 | 21,577 |

And so does every transition network the fixtures have — Cancun to Prague, Prague to Osaka, and Osaka
through BPO1 to BPO4 — in block import and through the Engine API. `sh tools/all-fixtures.sh` runs it all
in about an hour and a half.

| | state |
| --- | --- |
| `U256`, the EVM word | **done**. Every arithmetic, comparison and bit operation the EVM has, checked against BigInt over every pair of nine edge values and 192 random cases |
| the interpreter | **done through Osaka**. Every opcode, with EIP-2929 access costs, EIP-2200/3529 SSTORE metering and refunds, EIP-1153 transient storage, EIP-6780 SELFDESTRUCT, EIP-7939 CLZ |
| calls and creation | **done**. The CALL family with EIP-150's 63/64 and the stipend, CREATE and CREATE2 with collision, EIP-3860 and EIP-170 limits, EIP-7702 delegation |
| world state | **done**. One journal undoes everything a failed frame did; EIP-161 sweeps touched empty accounts. Each block's changes are kept as a change set, so one world serves every block the engine knows |
| transactions | **done for types 0 to 4**. Validity, intrinsic gas, EIP-1559 fees, EIP-4844 blob fees, EIP-7623's calldata floor, EIP-7825's gas cap, refunds, the coinbase's share |
| state root, logs hash | **done**. A Merkle-Patricia trie built from scratch, checked against `trieanyorder.json`, with each account's storage root cached until its storage changes |
| precompiles | **all of them**. ecrecover, SHA-256, RIPEMD-160, identity, MODEXP (with EIP-7883's prices), bn254 add, mul and pairing, BLAKE2F, KZG point evaluation, EIP-2537's seven BLS12-381 operations, and EIP-7951's P256VERIFY |
| forks | **Cancun, Prague, Osaka and the BPO forks**, scheduled by timestamp from a genesis's `config` and `blobSchedule` |
| blocks | **done**. Blocks and transactions decoded from RLP with every sender recovered, headers checked against their parents (base fee, blob gas with EIP-7918's floor, gas limit), EIP-4788 and EIP-2935 system calls, withdrawals, EIP-7685 requests, EIP-7934's size limit, and every root and the bloom checked. An invalid block is undone and leaves no trace |
| the Engine API | **done**. `engine_newPayloadV1`–`V4`, `engine_forkchoiceUpdatedV1`–`V3` with and without payload attributes, `engine_getPayloadV3`–`V5` with blobs bundles, `engine_getBlobsV1`/`V2`, `eth_sendRawTransaction` into a mempool (blob transactions in their network form, blob proofs verified), over JSON-RPC and HTTP with HS256 JWT authentication, from a geth-format `genesis.json`. Forks are followed and finality prunes them. Not yet: verifying Osaka's cell proofs |
| persistence | **done, simply**. With `--datadir`, every imported block and fork choice is appended to a log before it is acknowledged, and the log is replayed on start. Not yet: a state snapshot, so a long chain restarts slowly |
| the user's JSON-RPC | **done for what wallets and libraries use**. Blocks, transactions and receipts (`eth_getBlockByNumber`/`ByHash`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockReceipts`), `eth_getLogs`, state reads at any unfinalized block, `eth_call`, `eth_estimateGas`, fees (`eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_blobBaseFee`), and the `net_` and `web3_` basics. With `--public-rpc` they are answered without a token; ethers drives them all in `tools/rpc-e2e.mjs`. Not yet: subscriptions and traces |
| devp2p | **talks to geth**. RLPx (EIP-8's handshake, checked against its vectors; AES-CTR frames with keccak MACs), snappy, the base protocol and eth/69 with EIP-2124 fork ids. The node dials `--peer`s and accepts others on `--p2p-port`, serves headers, bodies and receipts, and swaps transactions. Blob transactions travel in their network form. Not yet: discovery (discv4/v5) and serving snap |
| sync | **full sync from peers**. When the consensus client names a block this has not got, headers are fetched back to one it has, then bodies forward, each executed. `tools/devnet-e2e.mjs` runs geth and wacuum side by side: each syncs the other's blocks, transactions cross both ways, and both end on the same state root. Not yet: snap sync, so joining a large chain means executing all of it |

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
wac app --allow-read --allow-write --allow-net cmd/wacuum.wac -o dist/wacuum
```

```bash
./dist/wacuum --genesis genesis.json --jwt-secret jwt.hex --datadir data --public-rpc --port 8551 \
  --p2p-port 30303 --peer enode://…
```

It needs a `wac` on a native host (`./bootstrap.sh --host wasmtime` or the default v8): on the JavaScript
hosts a program is given no network, whatever it is granted. `node tools/engine-e2e.mjs FIXTURE` drives a
running node through an engine fixture over HTTP, JWT and all, then restarts it on its data directory and
checks the replayed state; `node tools/rpc-e2e.mjs` makes blocks as a consensus client would and uses
ethers as a wallet against them; `node tools/devnet-e2e.mjs` (with `GETH` set) puts wacuum and geth on one
devnet and checks that they sync from each other.

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
    src/engine/engine.wac    the Engine API's methods, the blocks it knows, and the log it keeps
    src/engine/blobs.wac     blob sidecars: the network form of a blob transaction, and what is checked
    src/engine/eth.wac       blocks, transactions, receipts and logs as the eth_ methods spell them
    src/engine/rpc.wac       JSON-RPC over HTTP, and the JWT gate in front of it
    src/engine/jwt.wac       HS256 JWTs, as the Engine API authenticates them
    src/p2p/                 devp2p: secp256k1 keys, RLPx, snappy, the wire messages, peers, sync
    cmd/wacuum.wac           the node: genesis, the Engine API, its peers
    src/crypto/              a Montgomery field, short-Weierstrass curves, bn254 and its pairing, KZG blob proofs
    src/precompiles/         ecrecover, RIPEMD-160, MODEXP, BLAKE2F, and BLS12-381 on wac's `bls`
    test/                    wac tests; `test*` exports returning "" for a pass
    tools/statetest.wac      the state-test runner
    tools/blocktest.wac      the blockchain-test runner, importing blocks from RLP
    tools/enginetest.wac     the engine-test runner, through the Engine API's own methods
    tools/buildtest.wac      the block-building runner: each payload rebuilt from the mempool
    tools/dial.wac           dial a devp2p node and fetch its chain, saying what happens
    tools/fixture.wac        what both runners read from a fixture
    tools/                   vector generators, the fixture fetcher, the cache filler
    docs/wac-asks.md         what wacuum has found wrong with, or wants from, wac
