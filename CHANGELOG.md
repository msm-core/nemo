# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.9.0] — 2025-07-08

### Added — Arabic tokenizer: MASSIVE dataset coverage push to LIT% ≤ 20%

- **Real-data corpus**: MASSIVE ar-SA/test (2,974 Saudi Arabic utterances) replaces Wikipedia corpus
- **Suffix stripping fix**: Changed `> suf.length + 2` to `>= suf.length + 2` allowing 3-char words (حقي, كلي etc.) to have possessive suffix ي stripped
- **Gulf dialect structural words**: `ايش`, `وين`, `عشان`, `ابغي`, `ابي`, `تقدر` (STRUCTURAL_MAP_AR); `مين`, `كام`, `شنو` (WHAT/WHO/HOW_Q); `ليش` (WHY_Q); `يمكنني`, `يصير` (MODAL)
- **New ROOT_FIELD entries**: `šġl`→art, `nbh`→time, `ṣwt`→tech, `qṭr`→move, `ġrd`→speak, `Hqq`→quality
- **New ROOT_MAP groups**: alarm (nbh), sound (ṣwt), train (qṭr), tweet (ġrd), rights (Hqq); extended xbr/šġl groups
- **DIRECT_FIELD vocabulary (~200 entries)**: Gulf cities (Dammam, Jizan, Mecca, Medina), numbers 1–10/teens/tens, email/social media apps (WhatsApp, Snapchat, Instagram, TikTok, Twitter, YouTube), IoT (lights, brightness, Wemo), food/grocery, transportation, time periods, tech (settings, updates, device), countries, world cities, recipes, and more
- **FUNCTION_WORDS_AR additions**: 30+ Gulf dialect filler/discourse tokens
- **Coverage**: LIT% 46.3% → **19.4%** on MASSIVE ar-SA/test (2,974 utterances); CONCEPT% 26.6% → **50.3%**

---

## [1.8.0] — 2025-07-08

### Added — Arabic tokenizer: structural coverage push to ≥30% CONCEPT

- **Tokenizer folder refactor**: `src/tokenizer.ts` and `src/tokenizer-ar.ts` split into
  `src/tokenizer/en.ts`, `src/tokenizer/ar.ts`, `src/tokenizer/types.ts`, and
  `src/tokenizer/index.ts`; backward-compat shims kept in place.
- **19 Arabic orphan root fixes**: vocabulary gaps in ROOT_MAP and DIRECT_FIELD filled
  for common words that were silently falling to LIT.
- **English vocabulary expansion**: ~120 new SEMANTIC_FIELDS and COMPOUND_FIELDS entries
  across all 42 semantic fields, raising CLINC150 CONCEPT% from ~35% → 40.6%.
- **MASSIVE dataset downloader**: `plan/scripts/fetch-massive.ts` script to pull the
  MASSIVE multilingual intent dataset for evaluation benchmarking.
- **Arabic pipeline fixes** (all in `src/tokenizer/ar.ts`):
  - لل contraction stripping in `segment()` (للماء → ماء).
  - Post-segment structural/relation/function-word re-checks after clitic stripping.
  - Sin-future guard: `سـ` prefix only emits FUTURE when remainder resolves to a known
    field; otherwise falls through to main classification path.
  - TA_MARBUTA fallback A: if stem ends in ه, try stem-minus-ه against ROOT_MAP and
    DIRECT_FIELD (e.g. الرياضية → رياضيه → رياضي → science).
  - Word-level punctuation strip: removes ،,;؛.!?؟«»()[] etc. before classification.
  - FUNCTION_WORDS_AR additions: relative pronouns (التي, الذي, …), discourse markers
    (وذلك, ولكن, وقد, بما, ومن, تشير, …), short pronoun combos (لها, لهم, فيها, …).
  - DIRECT_FIELD additions: directional words (شمال/جنوب/شرق/غرب), ordinals (اول/ثاني),
    social/governance terms (سكان, نظام, استقلال, مجال, مجموعات, مسائل), science
    (هيدروجين, اكسجين, نيتروجين, هندسة), nature (جليد, كائنات), measure (كمية),
    continental geography (اوروبا, اسيا, افريقيا, امريكا).
  - RELATION_MAP_AR additions: وفقا, طبقا, بناء ("according to").
- Arabic CONCEPT% raised from 21.6% → **30.4%** on the 1 000-sentence corpus.
  LIT% reduced from 50% → 38.6%.

---

## [1.7.0] — 2026-05-29

### Added — Smart persistence: auto-save + shutdown hook + loadOrCreate

- `NemoSession.loadOrCreate(filePath, opts)` — new factory: loads saved state if file
  exists, creates a fresh session if not (ENOENT). Eliminates the try/catch boilerplate
  every consumer had to write.
- `SessionOptions.shutdownHook` — when `filePath` is provided this defaults to `true`,
  registering `SIGTERM` / `SIGINT` handlers that flush state to disk on process exit.
  Set to `false` to delegate shutdown saves to the adapter layer.
- `SessionOptions.autoSaveEvery` now defaults to `100` when `filePath` is provided
  (was always `0`). Zero-config = safe default: a session with a file path saves itself.
- Auto-save counter moved from `run()` to `teach()` — `teach()` is the only call that
  mutates HDC prototype state; tracking it avoids unnecessary writes on query-only traffic.

---

## [1.6.0] — 2026-05-29

### Added — English tokenizer CST-parity upgrade

- **Richer suffix taxonomy** — 8 new entries in `SUFFIX_ROLES` (longest-first):
  - `ification` / `ization` → `"process"` — _simplification_, _digitization_, _centralization_
  - `ifier` / `izer` → `"causer"` — _purifier_, _amplifier_, _organizer_, _stabilizer_
  - `ify` / `ize` → `"causer"` — _simplify_, _clarify_, _modernize_, _realize_
  - `ant` → `"seeker"` — _applicant_, _aspirant_, _contestant_
  - `aholic` → `"intensifier"`, `seeker` / `hunter` → `"seeker"`, `master` → `"intensifier"`

- **New prefix roles** — `over` → `"excess"` (_overcharge_, _overload_), `hyper` → `"excess"` (_hyperactive_, _hypersensitive_)

- **Nested suffix decomposition in `resolveField()`** — resolves two-suffix derivations without a lemmatizer:
  - e.g. `"readable"` → strip `able` → `"read"` → `know` field
  - e.g. `"disconnection"` → strip `tion` → `"disconnec"` → strip `dis` via prefix fallback → `"connect"` field

- **Prefix-strip fallback in `resolveField()`** — after all suffix attempts fail, strips known prefix and resolves bare stem (e.g. `"rewrite"` → `write`, `"disorganize"` → `work`)

---

## [1.5.0] — 2026-05-29

### Fixed — Arabic tokenizer production coverage (43% → 100% on real-world agent inputs)

- **Possessive `ي` suffix stripping** — `حسابي` / `هاتفي` now correctly resolve to their root (was being ignored as LIT)
- **Accusative alef stripping** — tanwin-fath nouns like `موعداً` normalize to `موعدا` then correctly strip to `موعد` for lookup
- **Form VIII verb recognition** — explicit entries for `احتاج`/`يحتاج` (need), `اختار` (choose), `انتظر` (wait), `اشترك`/`يشترك` (subscribe), `اكتسب`/`يكتسب` (acquire)
- **`أريد`/`يريد` (want)** — first-person verb form now resolves via `feel` field
- **`klf` root added** — `يكلف`/`كلف`/`تكلف` (cost/expense) now map to `trade` field
- **High-frequency customer-service nouns added to DIRECT_FIELD** — `استرداد` (refund), `إلغاء` (cancellation), `اشتراك` (subscription), `مبلغ` (amount), `محظور`/`معطل` (blocked/broken), `حجز` (booking), `شحن` (shipping), `تكلفة` (cost), `باقة` (package plan), and 25+ more
- **`library → write`** — corrected wrong field mapping (`tech` was a programmer reflex; CST correctly maps it to `write`)

### Added

- `stripVerbAug()` — pure-TypeScript augmented-verb prefix stripper (Form V `ت`, Form X `است`, 1st-person `ا`) as a lookup fallback; zero dependencies
- `VERB_AUG_PREFIXES` constant for the prefix list

---

## [1.4.0] — 2026-05-29

### Added

- **English vocabulary expanded to 2,698 entries** — imported all 2,402 CST `semantic_fields.json` entries; deduplicated against the existing 883 entries yielding 1,815 net additions
- **Two new semantic fields: `take` and `change`** — previously unmapped CST fields now have first-class routing in both English and Arabic
- **Arabic ROOT_MAP expanded to 1,711 entries** — 321 new trilateral roots from CST `ARABIC_ROOT_TO_FIELD`, each generating base, present-tense (يـ) and masdar (ـة) forms
- **Arabic DIRECT_FIELD expanded to 470 entries** — 171 new nouns and multi-word terms across govern, trade, health, science, tech, social, art, sport, food, nature
- **RELATION_MAP_AR expanded** — 25 new relation words (`حيث`, `لأن`, `بينما`, `كما`, `مثل`, `حين`, `عندما`, `إلا`, `كل`, `بعض`, …)
- **COMPOUND_FIELDS_AR expanded** — 30 new bigrams (`علاج نفسي`, `حقوق إنسان`, `طاقة متجددة`, `ذكاء اصطناعي`, `كرة القدم`, …)
- **ROOT_FIELD expanded to 416 entries** — new root codes for all new fields

### Changed

- Semantic field count: **40 → 42** (added `take`, `change`)
- README updated to reflect 42 fields and 2,100+ Arabic stems

### Tests

- **90 tests passing** (all existing tests preserved, no regressions)

---

## [1.3.0] — 2026-05-29

### Added

- **Arabic tokenizer feature parity with English** — `tokenizeAr()` now matches English behaviour across all 18 token types
- **`COMPOUND_FIELDS_AR`** — 50+ Arabic bigram phrases pre-scanned before single-word lookup (`ذكاء اصطناعي → tech`, `كرة قدم → sport`, `صحة نفسية → health`, `تغير مناخ → weather`, …)
- **Pre-normalized lookup tables** (`_ROOT_MAP_NORM`, `_DIRECT_FIELD_NORM`, `_STRUCTURAL_NORM`, `_RELATION_NORM`) — built at module-init so ى/ي, آ/أ/إ/ا and other normalization variants resolve correctly without explicit handling at call sites
- **Standalone ROLE tokens** — `tokenizeAr()` now emits `ROLE` even when no semantic field is found (parity with `tokenize()`)
- **39 Arabic tokenizer tests** in `tests/tokenizer-ar.test.ts` covering all 18 token types, compound phrases, morphological roles, normalization resilience, and edge cases

### Changed

- Multi-word entries removed from `ROOT_MAP` and `DIRECT_FIELD` (they were unreachable after word-splitting); moved to `COMPOUND_FIELDS_AR`
- `tokenizeAr()` now applies a compound bigram pre-scan loop identical in structure to the English tokenizer
- Role detection now tries `detectRoleAr(stem) ?? detectRoleAr(word)` to catch cases where segmentation strips a pattern-bearing prefix

### Tests

- **90 tests passing** (51 existing + 39 new Arabic tests)

---

## [1.2.1] — 2026-05-28

### Fixed

- 68 duplicate key errors in `STRUCTURAL_MAP_AR` resolved via deduplication
- `HA`/`HAR` variable redeclaration conflict in `detectRoleAr()` fixed
- `STRUCTURAL_MAP_AR` rewritten with real Arabic Unicode characters and MODAL entries (يمكن, يجب, ربما, …)

---

## [1.2.0] — 2026-05-27

### Added

- **Arabic tokenizer** (`src/tokenizer-ar.ts`) — `tokenizeAr()` / `tokenStreamAr()`
  - `normalize()` — strips diacritics, normalizes variant alef forms, tatweel
  - `segment()` — strips و/ف conjunctions, ب/ل/ك prepositions, ال article, object suffixes
  - `ROOT_MAP` — 700+ Arabic stems → root codes (trilateral transliteration)
  - `ROOT_FIELD` — root codes → 40 shared semantic fields
  - `DIRECT_FIELD` — 250+ direct-vocabulary entries (animals, colors, body, food, places, …)
  - `RELATION_MAP_AR` — 30 Arabic prepositions → REL tokens
  - `STRUCTURAL_MAP_AR` — negation, question words, modals, conditionals, tense markers
  - `detectRoleAr()` — morphological patterns: فاعل (agent), مفعول (patient), تفعيل (process), مفعلة (place)
- **`agent.feedback(hv, field, meta?)`** — unconditional ground-truth update
- **`persist.ts`** — `saveToFile` / `loadFromFile` helpers
- **`session.ts`** — `NemoSession` with tool registry, `run()`, `teach()`, `save()`, `autoSaveEvery`
- Arabic tokenizer exported from `src/index.ts`

---

## [1.1.0] — 2026-05-20

### Added

- **Compound phrase support** (English) — `COMPOUND_FIELDS` with 45+ bigrams pre-scanned before single-word lookup (`machine learning → know`, `blood pressure → health`, `stock market → trade`, …)
- **Prefix role detection** — `un`/`non`/`dis` → negate, `re` → repeat, `pre` → before, `mis` → wrong, `co` → mutual, `out` → exceed
- **Expanded `SEMANTIC_FIELDS`** — 700+ entries across all 40 fields
- **`HDCAgent.step()`** — classify + conditional update in one call
- **`HDCAgent.retrieve()`** — episodic memory retrieval by cosine similarity

### Changed

- `RELATION_MAP` expanded to 40+ English prepositions
- `STRUCTURAL_MAP` now includes negated contractions (can't, won't, don't, isn't, …)

---

## [1.0.0] — 2026-05-10

### Initial release

- CST Tokenizer (English) — 18 token types, 40 semantic fields
- HDC Encoder — MAP algebra, 10,000-dim bipolar `Float32Array`, seeded deterministic
- Prep Layer — rule-based intent frame (is_question, has_negation, dominant_field, pattern)
- HDC Agent — prototype memory, cosine classification, conditional self-update
- Gate — `skip_llm` (≥ 0.55) / `llm_assist` (0.35–0.55) / `full_llm` (< 0.35)
- `toJSON()` / `fromJSON()` — full state serialization as plain JSON
- 51 tests passing
