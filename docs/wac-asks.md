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

## A `const` reference to a `const struct` cannot become a plain one

`spec/2-types/17-const.md`, "A const struct": *no reference to one was ever writable — `const` or not*. The
checker accepts `return this;` from a `const this` method, but refuses the same conversion everywhere else:

```wac
export const struct W {
  u64 v;
  W a(const this) { W n = this; return n; }                // error: a const W cannot become a W
  W b(const this, const W rhs) { return rhs; }             // error: a const W cannot be returned as a W
  W c(const this) { return this.v > 0 ? this : W(0); }     // error: a const W cannot be returned as a W
}
```

**What it costs here:** `U256`'s methods take a plain `this`, and nothing in this repository writes
`const U256`. The type is immutable either way.
