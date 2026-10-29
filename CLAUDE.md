# Notes for whoever works on this next

README.md says what this is and where it stands; read it first. This file is what a README does not say.

## What it is

An Ethereum execution client in wac, consuming wac strictly from outside as any project would, the way
wac-desktop does. The goal the owner chose is a *full* execution client, so the order of work is the
README's table, top to bottom, and each row is "done" when the matching `ethereum/tests` or
`execution-spec-tests` fixtures pass, not when the code looks finished.

## Working agreements

- **wac is pinned to one commit**, in `wac.lock`, and the `wac` command should be built from it. Change both
  together. Today it is `49e5268e`.
- **When wac gets in the way, write it down in `docs/wac-asks.md`** with a reproduction, and work around it
  here. Fixing the compiler is ordinary work in the wac repository, but it is a different repository with
  other people's work in it.
- **Gas figures in tests are worked out by hand** and written beside the bytecode. When a test and the
  interpreter disagree, recompute before assuming the interpreter is wrong: the first such disagreement
  was the test's (MLOAD at 33 reaches a third word).
- Comments explain *why*, in full sentences, as wac's own do.

## Finding out what is wrong

The state tests are the oracle, and they are good at it: almost every bug so far was found by one, and
named by `--verbose` (which accounts differ from the fixture's post-state) and `--trace` (every step).

    wac task statetests                                         # the totals, and every failure
    wac dist/statetest.wasm --verbose --filter 'd29-g0]' FILE    # one case, and what differs

When a fixture and this disagree about something derived (an address, a hash), check the derivation
against an independent implementation before reading bytecode: `CREATE` addresses were wrong for any
nonce whose bytes are not a palindrome, and ethers' `getCreateAddress` showed it in one line.

## Building and testing here

    wac task test        # the unit tests, in about a second
    wac task vectors     # regenerate the U256 cases (needs node)
    wac task fixtures    # execution-spec-tests v5.4.0 into fixtures/
    wac task statetests  # every Cancun state test, about a minute
    wac task blocktests  # every Cancun blockchain test, about a minute; add Prague as an argument to the scripts

- `wac update` could not reach the network in the container this was started in. `sh tools/use-local-wac.sh
  <wac clone>` fills the package cache from a clone instead.
- `wac check src` checks the sources; it also walks into the parts of wac they reach.

## Against other clients

The fixtures say whether wacuum computes what Ethereum computes; other clients say whether it talks the way
they do. `tools/rpc-e2e.mjs` drives the node with ethers, and `tools/devnet-e2e.mjs` runs it beside geth on
an Osaka devnet, each syncing the other. geth builds from source here with
`go install github.com/ethereum/go-ethereum/cmd/geth@latest` (the Go module proxy is reachable when
GitHub's release downloads are not), and so does anything else written in Go.

- geth 1.17 speaks eth/69 and later only, and takes only EIP-7594 (cell-proof) blob sidecars, even on a
  chain before Osaka; and it keeps an account's transactions in one pool, so a test's blob transactions
  come from an account of their own.
- Never `pkill -f` with a pattern that appears in the command doing the killing: it matches the shell
  running it, which is this session's. Find the PID and `kill` it.

## wac things that have bitten

- An operator method on a struct is not found from another file, so `U256` has named methods. See
  `docs/wac-asks.md`.
- `not`, `is`, `matches` and friends are keywords, so a method cannot be called `not`; it is `inverted`.
- No `string.replace`, no `string.startsWith` (use `indexOf(x) == 0`).
- `fn` is a keyword (it spells function types), so a local cannot be called `fn`.
- A method call's result is not an lvalue: `m.get(k)!.balance = v` does not parse. Bind it first.
- Only some of wac's packages are reachable from a project: `lib.wac` decides. `bls` and `bignum` are, since `96f6bd34d`.
- Concurrency is unawaited async calls: each runs to its first suspension and is then on the program's
  queue, which `await sys.drain()` runs. The node is a handful of such tasks over one engine.
- `as` is a keyword (it is the cast), so a local cannot be called `as` either.
- A `const` reference never becomes a plain one, `const struct` included: write `const W x` or `(const W) x`.
  `U256` sidesteps it by taking a plain `this` everywhere. (This was once filed as a wac bug; it is not.)
- **A diagnostic can be a cascade.** One run reported `unknown type 'bool'` for a `bool[]` that is fine, and
  it went away when the other errors in the file were fixed. Reproduce alone before believing a strange one.
- A shift amount may be any integer type, so `x << (bit % 64)` needs no cast. `i32` to `u64` has no
  single cast; go through `u32` with `as@` or through `i64`.
