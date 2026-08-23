# AGENTS.md

**Read [`CLAUDE.md`](./CLAUDE.md). It is the only guidance file for this
repository, and it applies to you in full.** Commands, architecture,
invariants and conventions all live there.

This file exists because some tools look for `AGENTS.md` by name. It used to
carry its own copy of that guidance, and the copy drifted into being wrong in
exactly the places CLAUDE.md flags as dangerous — it still described the undo
image pool as keyed by `hashDataUrl` (a collision there restores the wrong
drawing; it must be `internKey`), and a menu-bar/command-bar shell that no
longer exists. A partial mirror of a document whose whole point is "these are
the traps" is worse than no mirror, so there is deliberately nothing to mirror
here any more.
