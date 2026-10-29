# Notes for whoever works on this next

README.md says what this is and where it stands; read it first. This file is what a README does not say.

## What it is

An Ethereum execution client in wac, consuming wac strictly from outside as any project would, the way
wac-desktop does. The goal the owner chose is a *full* execution client, so the order of work is the
README's table, top to bottom, and each row is "done" when the matching `ethereum/tests` or
`execution-spec-tests` fixtures pass, not when the code looks finished.

## Working agreements

- **wac is pinned to one commit**, in `wac.lock`, and the `wac` command should be built from it. Change both
  together. Today it is `a473e07`, the head of `git.voltrevo.com/wac.git` when this started.
- **When wac gets in the way, write it down in `docs/wac-asks.md`** with a reproduction, and work around it
  here. Fixing the compiler is ordinary work in the wac repository, but it is a different repository with
  other people's work in it.
- **Gas figures in tests are worked out by hand** and written beside the bytecode. When a test and the
  interpreter disagree, recompute before assuming the interpreter is wrong: the first such disagreement
  was the test's (MLOAD at 33 reaches a third word).
- Comments explain *why*, in full sentences, as wac's own do.

## Building and testing here

    wac task test        # everything, in about a second
    wac task vectors     # regenerate the U256 cases (needs node)

- `wac update` could not reach the network in the container this was started in. `sh tools/use-local-wac.sh
  <wac clone>` fills the package cache from a clone instead.
- `wac check src` checks the sources; it also walks into the parts of wac they reach.

## wac things that have bitten

- An operator method on a struct is not found from another file, so `U256` has named methods. See
  `docs/wac-asks.md`.
- `not`, `is`, `matches` and friends are keywords, so a method cannot be called `not`; it is `inverted`.
- No `string.replace`, no `string.startsWith` (use `indexOf(x) == 0`).
- `const` is enforced even on a `const struct`, where the spec says it means nothing; `U256` avoids `const`
  entirely. See `docs/wac-asks.md`.
- **A diagnostic can be a cascade.** One run reported `unknown type 'bool'` for a `bool[]` that is fine, and
  it went away when the other errors in the file were fixed. Reproduce alone before believing a strange one.
- A shift amount may be any integer type, so `x << (bit % 64)` needs no cast. `i32` to `u64` has no
  single cast; go through `u32` with `as@` or through `i64`.
