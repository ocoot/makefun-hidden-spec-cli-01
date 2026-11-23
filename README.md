# mend — one patch tool for every AI edit format

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/ocoot/makefun-hidden-spec-cli-01/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/ocoot/makefun-hidden-spec-cli-01/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

`mend` applies an edit an AI model wrote to a tree of text files. Models write edits in four formats — unified
diffs (often with wrong line numbers), SEARCH/REPLACE blocks, V4A patches, and text-editor tool calls as JSON —
and mend reads all four to one written specification (`SPEC.md`), finds the lines each edit names across three
matching tiers (exact, trailing-whitespace-insensitive, fully whitespace-trimmed), and changes every file or
none: a failed edit writes nothing, and every failure is reported.

Built by an AI agent for make.fun's [hidden-spec-cli-01-run-20261122](https://make.fun/bounty/hidden-spec-cli-01-run-20261122)
bounty, $100 in USDC. Referral: [make.fun/r/7qa4nbyr](https://make.fun/r/7qa4nbyr).

## Run it

    node main.ts [--format=NAME] [--check] [--strict] [PATCH]

Node 22, standard library only. The working directory is the root of the tree; PATCH is the patch file (or
standard input when absent or `-`). `--format` is one of `unified`, `search-replace`, `v4a`, `json`, or `auto`
(the default, detected from the patch). `--check` reports without writing; `--strict` matches lines exactly
(tier 0 only). Exit codes: 0 = applied, 1 = some edits failed (nothing written), 2 = usage / no-patch / format /
parse error.

## Files

- `main.ts` — the CLI itself. Its last lines hand a make.fun trial over to `runner.ts` when `MAKEFUN_ENV_URL`
  is set; that hand-over is the kit's, kept as it is.
- `runner.ts` — the kit's trial runner, unchanged: reads the checks from the env, runs `node main.ts` on each
  one in a fresh directory, and posts the exit code, stdout and resulting files.
- `check.ts` — the public practice set on your own machine, against the kit's `program/generator/practice.json`:

      node check.ts <path-to-practice.json>

- `SPEC.md` — the specification mend is built to; where anything here seems to differ, SPEC.md decides.
- `AMBIGUITIES.md` — the SPEC readings this implementation chose where the text admits more than one, and why.
- `LICENSE` — MIT.

## Practice result

100 of 100 public practice checks pass (practice score 1000), verified by an independent audit that also ran
26 adversarial cases of its own across all four formats — fuzzy line numbers, equidistant occurrences, moves,
CRLF round-trips, atomicity — all matching SPEC.md.
