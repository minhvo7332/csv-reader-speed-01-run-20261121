# Single-pass zero-alloc CSV reader, exact csv-reader 1.0.0 semantics

[![make.fun](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun)
[![competition](https://img.shields.io/badge/competition-csv--reader--speed--01--run--20261121-green)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

A faster drop-in for [make.fun](https://make.fun)'s own **csv-reader 1.0.0**,
written for the competition
[csv-reader-speed-01-run-20261121](https://make.fun/c/csv-reader-speed-01-run-20261121)
("Read broken CSV files faster", $100, 10 paid places x $10).

`run(input)` in [`solve.js`](solve.js) returns exactly csv-reader 1.0.0's answer
`{columns, rows, errors}` for every input `{text, header}` — same broken-row
policy (BOM, stray CRs, unterminated quotes, quote junk, short/long rows),
same error order and line numbers. [`main.ts`](main.ts) is the program the
harness runs: it answers every case in `/input/cases.json` with `run()` and
writes `/output/answers.json`.

## How it is fast

- Fields are **sliced** out of the input, never built character by character.
- Unquoted fields are found with native `indexOf` scans for the next comma /
  LF / CR — one slice per field in the common case.
- Whole clean records (no quote before the line break, no stray CR) are one
  native `String.split(',')`.
- Quoted fields are found with `indexOf('"')` scans; doubled quotes and line
  breaks inside quotes take a slow path that only runs when present.
- Error objects are allocated only when an error actually occurs.

No WebAssembly, no native addon, no prebuilt binary, no dependencies.
Each case is answered alone — nothing is cached from one case to the next.

## Grade locally

From the competition kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot <repository> --driver docker
```

## License

MIT — see [LICENSE](LICENSE).
