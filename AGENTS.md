# AGENTS.md — Code Agent Instructions for nemo-ai

This file is the first thing a code agent should read. It provides the operational context needed to work on this codebase without breaking anything.

---

## Identity

**Package:** `nemo-ai`
**Version:** See `package.json` → `version`
**Language:** TypeScript 5, Node.js 18+
**Runtime dependencies:** `@msm-core/cst` (the CST tokenizer — vocab + pipeline; ~160 kB packed)
**Repository:** https://github.com/msm-core/nemo

---

## Essential Commands

```bash
npm test          # Run all 118 tests (jest with --experimental-vm-modules)
npm run build     # Compile TypeScript → dist/
npm run clean     # Remove dist/
```

**Never run `npm publish` unless the user explicitly asks for it.**
The `prepublishOnly` script runs `build + test` automatically, so tests must pass before publish.

---

## Project Structure

```
src/
  hdc.ts          — MAP HDC math primitives (no imports from nemo)
  tokenizer.ts    — CST adapter (EN+AR): @msm-core/cst → NemoToken[]
  encoder.ts      — NemoToken[] → Float32Array (hypervector)
  prep.ts         — NemoToken[] → ReasoningFrame + FIELD_TOOL map
  agent.ts        — HDCAgent: classify, observe, calibrate, update, feedback
  persist.ts      — Save/load agent+encoder state to .nemo.json
  session.ts      — NemoSession: full pipeline entry point
  index.ts        — Public API re-exports (this is the package entry point)

tests/
  hdc.test.ts
  tokenizer.test.ts
  tokenizer-ar.test.ts
  agent.test.ts
  pipeline.test.ts

ARCHITECTURE.md — Deep technical reference (read this next)
CHANGELOG.md    — Version history
README.md       — User-facing documentation
```

---

## Hard Rules

1. **The only runtime dependency is `@msm-core/cst`.** Do not add others. All vocabulary, morphology, and tokenization logic lives in CST — fix it there, not here.
2. **Do not change `DIM = 10_000` in `src/hdc.ts`.** This invalidates all persisted `.nemo.json` files.
3. **Do not change `SEED = 42` in `src/encoder.ts`.** This invalidates atom spaces across restarts.
4. **`NemoToken` (in `src/tokenizer.ts`) is nemo's internal token type.** It is distinct from CST's `CSTToken`. Do not conflate them. The adapter in `tokenizer.ts` converts CST's 5 types → nemo's 18 types.
5. **All semantic field names must be consistent** across `encoder.ts` (`FIELDS` array) and `prep.ts` (`FIELD_TOOL` map). When CST adds a new L1 field, add it to both.
6. **L2 sub-fields (dot notation: `tech.ai`) must have entries in both `encoder.ts` `SUB_FIELDS` and `prep.ts` `FIELD_TOOL`.** Missing either causes silent routing failures.

---

## Token Types

There are 18 `TokenType` values. Every token is one of:

```
CONCEPT  ROLE  REL  LIT
NEG  QUERY  MODAL  COND  CAUSE  FUTURE  PAST
WHAT_Q  WHO_Q  WHERE_Q  WHEN_Q  WHY_Q  HOW_Q  WHICH_Q
```

`LIT` is the catch-all for unrecognized words. It is normal for LIT to appear; it does not cause errors. Only `CONCEPT` tokens carry a `.field` property. Only `ROLE` tokens carry a `.role` property.

---

## How to Add Vocabulary

**All vocabulary lives in `@msm-core/cst`, not in nemo.** Edit `vocab/concepts.json` in the CST package, run `npm run vocab && npm run build`, then update `@msm-core/cst` version in nemo's `package.json`.

See `@msm-core/cst` AGENTS.md for full vocabulary editing instructions (English stems, Arabic roots, function words, etc.).

---

## How to Add a New Semantic Field

1. Add the field in `@msm-core/cst` (vocab + encoder FIELDS array)
2. `src/encoder.ts` — add the field name to the `FIELDS` array
3. `src/prep.ts` — add `newField: "tool_name"` to `FIELD_TOOL`
4. For L2 sub-fields: add `["parent", "qualifier"]` to `SUB_FIELDS` in `encoder.ts` AND add `"parent.qualifier": "tool"` to `FIELD_TOOL` in `prep.ts`
5. Add test cases in the relevant test files
6. Bump the minor version in `package.json` and add a `CHANGELOG.md` entry

---

## Testing Conventions

- Tests use **Jest** with `ts-jest` transformer
- Node flag `--experimental-vm-modules` is required (already in `package.json` scripts)
- Test files are in `tests/*.test.ts`
- When adding vocabulary, add at minimum one positive test (`expect(field).toBe("fieldname")`) and one boundary test (e.g., the word with a common prefix/suffix)
- The test command is simply `npm test` — do not use `jest` directly, the `--experimental-vm-modules` flag is needed

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **Patch** (`1.5.x`) — bug fixes, vocabulary additions
- **Minor** (`1.x.0`) — new fields, new language support, new pipeline stages
- **Major** (`x.0.0`) — changes to `DIM`, `SEED`, token type set, or binary format

When bumping the version: update `package.json` → `version` and add an entry at the top of `CHANGELOG.md`.

---

## Known Limitations

1. **`session.ts` `pipeline()` is English-only.** For Arabic, call `tokenizeAr(text)` then `encoder.encode(tokens)` directly.
2. **`HDCAgent.calibrate()`** must be called after bulk `observe()` calls and before inference. Calling `classify()` before `calibrate()` returns `field = "unknown"`.
3. **Persistence is JSON, not binary.** For very large prototype stores (thousands of fields), consider chunked serialization.
4. **L2 field routing requires both `encoder.ts` `SUB_FIELDS` and `prep.ts` `FIELD_TOOL` entries.** If a sub-field token is produced by CST but not registered in `SUB_FIELDS`, the encoder skips it silently.
