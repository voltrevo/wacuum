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

## `bls` and `bignum` are not reachable from outside the repository

A project depending on wac gets `lib.wac`, and `lib.wac` exports neither `packages/bls` nor
`packages/bignum`; neither has a `wac.json5` of its own, so no `subdir` mapping reaches them either.

**What it costs here:** KZG point evaluation (precompile 0x0a, EIP-4844) needs BLS12-381 pairings, which
`bls` has, so it is not implemented: 65 of the Cancun state tests. Prague's seven BLS12-381 precompiles
(EIP-2537) will want the same package, with G1 and G2 addition and multi-scalar multiplication besides.
MODEXP went without `bignum` because `src/limbs.wac` already had the division it needed.

The fix is two lines in `lib.wac`, `export * as bls from …` and `export * as bignum from …`, if their
public names are what they should be for a consumer.
