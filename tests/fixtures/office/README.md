# Office 97–2003 test files

Used by `tests/files.legacy.test.ts` only (not packaged).

| Files | Source | License |
|---|---|---|
| `test01.doc`, `test02.doc` | [morungos/node-word-extractor](https://github.com/morungos/node-word-extractor) `__tests__/data` | MIT |
| `chinese-provinces.xls`, `BOOK_in_capitals.xls`, `incorrect_slide_order.ppt`, `clusterfuzz-testcase-*` | [Apache POI](https://github.com/apache/poi) `test-data/spreadsheet`, `test-data/slideshow` | Apache-2.0 |

The `clusterfuzz-testcase-*` files are deliberately broken inputs from fuzzing: the readers must fail cleanly on them.
