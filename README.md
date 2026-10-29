# wacuum

An Ethereum execution client written in [wac](https://git.voltrevo.com/wac.git), the C-family language for
WebAssembly GC. It vacuums up blocks.

wac already verifies a good deal of Ethereum: its packages include a beacon light client with BLS
signatures, SSZ, RLP, Merkle-Patricia proofs, keccak256 and the ABI. What it cannot do is *execute* a
block. wacuum is the execution half: the EVM, the state it runs against, and eventually the client that
imports a chain.

## Where it is

| | state |
| --- | --- |
| `U256`, the EVM word | **done**. Every arithmetic, comparison and bit operation the EVM has, checked against BigInt over 10,350 cases |
| the interpreter, without a world | **done**. Arithmetic, KECCAK256, memory, calldata, code, control flow, PUSH/DUP/SWAP, RETURN/REVERT, with Cancun gas |
| accounts, storage, logs, calls, creation | next. A host interface, warm/cold access (EIP-2929), SSTORE's gas (EIP-2200/3529), transient storage |
| precompiles, secp256k1 `ecrecover` | not started |
| transactions, blocks, a state trie that *builds* roots | not started. wac's `mpt` only verifies |
| `ethereum/tests` and `execution-spec-tests` | not started. This is what "done" will mean for each of the above |
| the Engine API, persistence, devp2p, sync | not started |

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
wac task test
```

## Layout

    src/u256.wac          the 256-bit word, with the EVM's semantics
    src/hex.wac           0x-hex text and bytes
    src/evm/table.wac     each opcode's stack effect and static gas
    src/evm/memory.wac    memory, and what growing it costs
    src/evm/interp.wac    the interpreter loop and the opcodes
    test/                 wac tests; `test*` exports returning "" for a pass
    tools/                vector generators and the cache filler
    docs/wac-asks.md      what wacuum has found wrong with, or wants from, wac
