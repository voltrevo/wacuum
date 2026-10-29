# What wacuum wants from wac

Found while building this, at wac `a473e07`. Each one has a reproduction small enough to paste.

## An operator method is not found from another file

`spec/3-expressions/22-operators.md` says `a + b` on a struct calls the left operand's `[operators.add]`
method. That works in the file declaring the struct and nowhere else:

```wac
// v.wac
import { operators } from "core";
export struct V {
  i32 x;
  V [operators.add](const this, const V rhs) { return V(this.x + rhs.x); }
}
export i32 here() { V a = V(1); return (a + a).x; }      // fine
```

```wac
// use.wac
import { operators } from "core";                         // with or without this line
import { V } from "./v.wac";
export i32 f() { V a = V(1); return (a + a).x; }         // error: V has no implementation of operators.add
```

`operatorMethodOf` in `packages/wacc/src/check.wac` looks the method up under
`c.coreMember("operators." + sym)`, which is the *using* file's spelling of the symbol. That table is filled
only while the checker processes a file that imports from core (`api.wac`, `noteCoreSym`), and the key the
method was registered under is the declaring file's. `convertsToText` solved the same problem for
`toString` by also looking under core's own name.

**What it costs here:** `U256` has named methods (`a.add(b)`), not operators.

## Not a bug: a `const` reference to a `const struct` stays `const`

This was listed here as a checker gap, and it is not one. The sentence in `spec/2-types/17-const.md` that
says no reference to a `const struct` "was ever writable — `const` or not" describes the situation; it is
not a rule that lets `const` be dropped, and `§wac-const-no-launder-t584c4n` (a const reference never
becomes a plain one) applies to every type. `return this;` from a `const this` method is accepted by the
accessor exception, `§wac-deep-const-accessor-w3kf8nq`, which makes the result const at the call site.

Written the way the language means it: `const W n = this;`, or `(const W) n` to rebind, and `const W` as
the return type. `U256` still takes a plain `this` everywhere, which is simpler and costs nothing.

## Done: `bls` and `bignum` are reachable from outside the repository

`lib.wac` exported neither, so KZG point evaluation and EIP-2537's seven precompiles could not be written.
Both are exported since wac `96f6bd34d`, and `src/precompiles/bls.wac` is built on `bls`: every point
evaluation and EIP-2537 state test passes. The one thing `bls` lacked for the EVM, the map from Fp to G1
(its SSWU and 11-isogeny), is written there.

## On the JavaScript hosts, a program is given no network, whatever it is granted

`wac run --allow-net prog.wac`, and a `wac app` built with `--allow-net`, both run the program as a spawned
child, and on the Node host (and, by the same code, Deno) a child gets only its standard streams: the
comment in `entryNode.ts`/`children.ts` says so ("What a child is granted, in this first cut: nothing but
its standard input and output"). So `sys.net().listen(...)` answers "network access not granted to this
application" even with `--allow-net`. `wac update` fails the same way under `--host nodejs`.

**What it costs here:** the node, `cmd/wacuum.wac`, needs a native host. On wasmtime (`./bootstrap.sh --host
wasmtime`) it listens and serves the Engine API as it should. A refusal that said "this host does not pass
the network to programs" rather than "not granted" would have saved the hour it took to find.

## Open: a running Keccak-256

RLPx's frame MACs are a Keccak-256 over everything sent so far, read after every frame without ending it.
wac's crypto package has exactly that shape for SHA3-256 (`Sha3_256`, for Tor) but not for Ethereum's
Keccak, whose padding byte differs. `src/p2p/keccak.wac` is a copy of the permutation until it does; asked
for on 2026-10-29.

## Open: a5a17eeba cannot emit a program that imports from the `wac` dependency

Built fresh, on either host, the compiler at `a5a17eeba` refuses any `main(Sys)` program that imports
anything from `"wac"`: "the exported function `__wacHost` is not in the module the emitter produced — a call
to __wacHostOf". The compiler from `49e5268e` builds the same file against the same packages. It holds back
the repin for `01762d3f7`, which gives the Node host a network. Reported 2026-10-29.
