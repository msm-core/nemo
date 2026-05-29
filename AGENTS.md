# AGENTS.md — Code Agent Instructions for nemo-ai

This file is the first thing a code agent should read. It provides the operational context needed to work on this codebase without breaking anything.

---

## Identity

**Package:** `nemo-ai`
**Version:** See `package.json` → `version`
**Language:** TypeScript 5, Node.js 18+
**Runtime dependencies:** **none** (zero external packages at runtime)
**Repository:** https://github.com/msm-core/nemo

---

## Essential Commands

```bash
npm test          # Run all 90 tests (jest with --experimental-vm-modules)
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
  tokenizer.ts    — English CST tokenizer → CSTToken[]
  tokenizer-ar.ts — Arabic CST tokenizer  → CSTToken[]
  encoder.ts      — CSTToken[] → Float32Array (hypervector)
  prep.ts         — CSTToken[] → ReasoningFrame + FIELD_TOOL map
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

1. **Do not add runtime dependencies.** Zero deps is a core design constraint. If a task seems to require an external library, implement it in pure TypeScript instead.
2. **Do not change `DIM = 10_000` in `src/hdc.ts`.** This invalidates all persisted `.nemo.json` files.
3. **Do not change `SEED = 42` in `src/encoder.ts`.** This invalidates atom spaces across restarts.
4. **Single-word entries go in `DIRECT_FIELD` or `SEMANTIC_FIELDS`; multi-word entries go in `COMPOUND_FIELDS_AR` / `COMPOUND_FIELDS`.** Putting a bigram (phrase with a space) in `DIRECT_FIELD` will silently never match because `_DIRECT_FIELD_NORM` skips keys containing spaces.
5. **Both tokenizers share the same `CSTToken` interface** (imported from `tokenizer.ts`). The Arabic tokenizer does NOT redefine it.
6. **All 42 semantic field names must be consistent** across `tokenizer.ts`, `tokenizer-ar.ts`, `encoder.ts`, and `prep.ts`. If you add a field, update all four files.
7. **Do not reorder steps inside `segment()` in `tokenizer-ar.ts`.** The clitic-stripping pipeline has a strict order: conjunction → preposition → definite article → object suffixes → tā-marbūṭah → accusative alef. Reordering causes false strips.

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

## How to Add English Vocabulary

Edit `src/tokenizer.ts`:
- Add single words to `SEMANTIC_FIELDS: Record<string, string>` (word → field name, lowercase)
- Add bigrams to `COMPOUND_FIELDS: Record<string, string>` (phrase → field name, lowercase)
- Valid field names: see the 42-field list in `ARCHITECTURE.md`

---

## How to Add Arabic Vocabulary

Edit `src/tokenizer-ar.ts`:

**Option A — has a known trilateral root:**
1. Add to `ROOT_MAP` (normalized Arabic stem → root code in ASCII transliteration)
2. If the root code is new, add to `ROOT_FIELD` (root code → field name)
3. The normalized lookup tables are rebuilt automatically at module init

**Option B — doesn't reduce to a root (proper nouns, loanwords, complex derivations):**
1. Add to `DIRECT_FIELD` (Arabic word → field name, single words only, no spaces)

**Option C — multi-word phrase (bigram):**
1. Add to `COMPOUND_FIELDS_AR` (Arabic phrase with space → field name)
2. These are matched as pre-scanned bigrams before tokenization

**Important:** Always add the base form. The `segment()` pipeline will strip clitics from user input before lookup, so entries should be the unadorned stem (no ال, no وـ, no ـه etc.).

---

## How to Add a New Semantic Field

1. `src/tokenizer.ts` — add vocabulary entries with the new field name
2. `src/tokenizer-ar.ts` — add Arabic vocabulary entries with the new field name
3. `src/encoder.ts` — add the field name to the `FIELDS` array
4. `src/prep.ts` — add `newField: "tool_name"` to `FIELD_TOOL`
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

1. **Arabic root extraction is rule-based, not morphological analysis.** Edge cases exist for Form VII (`انـ`) and Form IX (`افـ`). When a word fails to classify, check whether it needs a `DIRECT_FIELD` entry.
2. **English compound phrases** are scanned left-to-right as bigrams only (no trigram support).
3. **Arabic compound scan** covers the full sentence but only at the bigram level.
4. **`HDCAgent.calibrate()`** must be called after bulk `observe()` calls and before inference. Calling `classify()` before `calibrate()` returns `field = "unknown"`.
5. **Persistence is JSON, not binary.** For very large prototype stores (thousands of fields), consider chunked serialization.
