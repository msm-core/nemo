# nemo-ai — Architecture Reference

> Internal technical reference for developers and code agents working on this codebase.
> For user-facing documentation, see [README.md](README.md).

---

## 1. System Overview

nemo is a **sub-millisecond semantic intent classifier** for AI agent pipelines. It sits between raw user input and an LLM, answering the question: *"Do I already know what this means?"*

The full pipeline is:

```
raw text (English or Arabic)
    │
    ▼  src/tokenizer.ts  |  src/tokenizer-ar.ts
CST Tokenizer  →  CSTToken[]
    │
    ▼  src/prep.ts
Prep Layer     →  ReasoningFrame  (dominant_field, is_question, has_negation, pattern)
    │
    ▼  src/encoder.ts
HDV Encoder    →  Float32Array (10,000-dim bipolar)
    │
    ▼  src/agent.ts
HDC Agent      →  ClassifyResult  (field, confidence, top3)
    │
    ▼  src/session.ts
Gate           →  "skip_llm" | "llm_assist" | "full_llm"
```

**Key constraint:** Zero runtime dependencies. Everything in `src/` must compile to vanilla JS with no `require()` calls to external packages.

---

## 2. Module Map

### `src/hdc.ts` — MAP HDC primitives
The mathematical foundation. No imports from other nemo modules.

| Export | Type | Description |
|---|---|---|
| `DIM` | `10_000` | Hypervector dimensionality — **never change this**, it breaks saved agent state |
| `randomHV(dim, rng)` | function | Generate a seeded bipolar `{-1, +1}` Float32Array |
| `makeRNG(seed)` | function | xorshift32 PRNG — deterministic across platforms |
| `bind(a, b)` | function | Elementwise multiply — self-inverse: `bind(bind(a,b),b) === a` |
| `bundle(vectors)` | function | Majority vote — merges into prototype |
| `similarity(a, b)` | function | Cosine similarity ∈ [-1, 1] |
| `permute(hv, n)` | function | Cyclic shift by n positions — encodes sequence |

**Design:** `bundle` uses `Float64Array` for accumulation to avoid float32 precision drift on large corpora. Only `sign()` at the end collapses to `Float32Array`.

---

### `src/tokenizer.ts` — English CST tokenizer
Converts English text into `CSTToken[]`. No ML, no external calls.

**Pipeline (4 stages):**
1. **Normalize** — lowercase, strip punctuation
2. **Structural detect** — identify NEG, QUERY, MODAL, COND, CAUSE, tense markers
3. **Compound scan** — check bigrams in `COMPOUND_FIELDS` before single words
4. **Field lookup** — `SEMANTIC_FIELDS[word]` → field; suffix stripping for morphology

**Key data structures:**
- `SEMANTIC_FIELDS: Record<string, string>` — 2,698 entries, word → semantic field name
- `COMPOUND_FIELDS: Record<string, string>` — bigrams like `"machine learning" → "tech"`
- `SUFFIX_RULES: Array<[RegExp, string]>` — ordered suffix-stripping rules (`-ing`, `-er`, `-tion`, etc.)

**Suffix stripping order matters** — rules are tried first to last; the first match wins.

---

### `src/tokenizer-ar.ts` — Arabic CST tokenizer
Same `CSTToken[]` output interface as the English tokenizer. Significantly more complex due to Arabic morphology.

**Pipeline (5 stages):**
1. **Normalize** — strip diacritics (harakat), unify alef variants (`آ/أ/إ/ا`), `ى→ي`, `ؤ→و`, remove tatweel
2. **Compound scan** — bigrams in `COMPOUND_FIELDS_AR` (pre-scan entire sentence)
3. **Structural detect** — negation, questions, modals, tense markers
4. **Clitic segment** (`segment()`) — strips prefixes (و/ف, ب/ل/ك, ال) and suffixes (هم/ها/ه/ك/نا/ي + accusative ا)
5. **Root/field lookup** — `ROOT_MAP[stem] → root_code → ROOT_FIELD[root_code] → field`
   fallback: `DIRECT_FIELD[stem] → field`
   fallback: `stripVerbAug(stem)` for augmented verb forms

**Key data structures:**
- `ROOT_MAP: Record<string, string>` — 1,711 Arabic stems → root codes (e.g., `"كتب" → "ktb"`)
- `ROOT_FIELD: Record<string, string>` — 416 root codes → semantic fields (e.g., `"ktb" → "write"`)
- `DIRECT_FIELD: Record<string, string>` — ~530 nouns/terms that don't reduce to a root (animals, colors, places, admin vocabulary, etc.)
- `COMPOUND_FIELDS_AR: Record<string, string>` — 80+ Arabic bigrams — **only multi-word entries go here; single words MUST go in DIRECT_FIELD**
- `RELATION_MAP_AR: Record<string, string>` — prepositions/conjunctions → `REL:*` tokens
- `_ROOT_MAP_NORM` / `_DIRECT_FIELD_NORM` — pre-normalized lookup tables built at module-init; all actual lookups go through these, not the raw maps

**Root code transliteration scheme (ASCII):**
```
أ→a  ب→b  ت→t  ج→j  ح→H  خ→x  د→d  ذ→D  ر→r  ز→z
س→s  ش→c  ص→S  ض→p  ط→g  ع→e  غ→G  ف→f  ق→q  ك→k
ل→l  م→m  ن→n  ه→h  و→w  ي→y
```

**`segment()` stripping order (must not be changed):**
1. Conjunctive prefix: و / ف
2. Preposition prefix: ب / ل / ك
3. Definite article: ال
4. Object/possessive suffixes: هم, هن, كم, ها, ه, ك, نا, **ي** (first-person "my")
5. tā-marbūṭah: ة → ه (for root matching)
6. Accusative alef: trailing ا when length > 3

**`stripVerbAug()` fallback order:**
1. Form X: strip است (3 chars) when remaining ≥ 3
2. Form V: strip ت (1 char) when length ≥ 5
3. 1st-person: strip ا (1 char) when remaining ≥ 3

**Critical:** The pre-normalized tables `_ROOT_MAP_NORM` and `_DIRECT_FIELD_NORM` are built **after** both `ROOT_MAP` and `DIRECT_FIELD` are fully declared. Any vocabulary added to `ROOT_MAP`/`DIRECT_FIELD` is automatically indexed. However, entries added to `COMPOUND_FIELDS_AR` are **not** indexed in `_DIRECT_FIELD_NORM` — they are only matched during the compound bigram pre-scan.

---

### `src/encoder.ts` — HDV Encoder
Maps `CSTToken[]` to a single `Float32Array` hypervector.

**Atom generation:** All atom HVs are deterministically seeded (`SEED = 42`). The same seed must be used across all sessions for prototypes to be comparable.

**Encoding logic:**
- `CONCEPT:field` → field atom HV
- `CONCEPT:field` + `ROLE:role` → `bundle([bind(field_hv, role_hv), field_hv, role_hv])`
- `NEG` / `QUERY` / `COND` → operator: `bind(result, op_hv)` (applied after content is bundled)
- `PAST` / `FUTURE` → modifier: bundled into the main vector
- `REL:*` → bundled into content
- `LIT`, wh-questions (`WHAT_Q` etc.) → **skipped** (do not contribute to HV)

**Returns:** `[Float32Array, dominantField | null]` — the dominant field is whichever CONCEPT appeared most in the token stream.

---

### `src/agent.ts` — HDCAgent
Self-evolving semantic memory using MAP algebra.

**State:**
- `_sum: Map<string, Float64Array>` — running accumulator per field (float64 for precision)
- `_proto: Map<string, Float32Array>` — `sign(_sum)` — the actual prototype used for classification
- `_theta: Map<string, number>` — per-field acceptance threshold (set by `calibrate()`)
- `_episodes: Map<string, Episode[]>` — memory episodes for retrieval

**Learning lifecycle:**
1. `observe(hv, field)` — accumulate during bulk training (pre-calibration)
2. `calibrate()` — compute thresholds: `θ = mean(sims) - 1.5 * std(sims)` per field; **call once after training**
3. `update(hv, field)` — conditional update at inference: only if `sim(hv, proto) > θ`
4. `feedback(hv, field)` — unconditional ground-truth update (bypasses threshold)

**Classification:** `classify(hv)` computes cosine similarity against all field prototypes, returns top-3. Confidence is `tanh(rawSim * 3)` to compress into (0, 1).

**Persistence:** `toJSON()` / `fromJSON()` — all internal state is plain JSON-safe (number arrays, not typed arrays).

---

### `src/prep.ts` — Preparation Layer
Rule-based intent frame extraction between tokenizer and encoder.

**`buildFrame(tokens, text): ReasoningFrame`** — returns:
```ts
{
  dominant_field: string | null,
  is_question: boolean,
  has_negation: boolean,
  tense: "past" | "future" | "present",
  pattern: string,          // e.g. "tech+fix", "health+question"
  query_type: string | null // "what" | "who" | "where" | "when" | "why" | "how"
}
```

**`FIELD_TOOL: Record<string, string>`** — maps every semantic field to a tool name string. This is the authoritative field→tool mapping. Modifying it changes routing for all pipelines.

**Resolution rules** — when two fields co-occur in one input, rules select the dominant one (e.g., `tech+fix → fix`). These are ordered; first matching rule wins.

---

### `src/persist.ts` — Persistence Helpers
Serializes/deserializes `HDCAgent` + `HDVEncoder` state to/from JSON files.

**`saveToFile(path, agent, encoder, meta?)`** — writes `{ agent: AgentState, encoder: AtomState, meta }` to a `.nemo.json` file.
**`loadFromFile(path)`** — reconstructs both objects.

The format is deliberately plain JSON (no binary) so it can be stored in databases, Redis, S3, etc.

---

### `src/session.ts` — NemoSession
High-level entry point that wires all modules together.

**`pipeline(text, agent, encoder): PipelineResult`** — full stack in one call (English only; for Arabic call `tokenizeAr` before `encoder.encode`).

**Gate thresholds** (exported as constants):
```ts
GATE_HIGH = 0.55  // skip_llm — nemo is confident
GATE_MED  = 0.35  // llm_assist — inject semantic context
// < 0.35         // full_llm — unknown input
```

---

## 3. Token Type Reference

All 18 `TokenType` values, shared by English and Arabic tokenizers:

| Type | Category | Notes |
|---|---|---|
| `CONCEPT` | Semantic | Always has `.field` property |
| `ROLE` | Morphological | Always has `.role` property (`agent`/`patient`/`process`/`place`) |
| `REL` | Relational | Prepositions, conjunctions |
| `NEG` | Structural | Negation |
| `QUERY` | Structural | `?` or `؟` punctuation |
| `MODAL` | Structural | Ability/obligation words |
| `COND` | Structural | Conditional words |
| `CAUSE` | Structural | Causation words |
| `FUTURE` | Structural | Future tense markers |
| `PAST` | Structural | Past tense markers |
| `WHAT_Q` / `WHO_Q` / `WHERE_Q` / `WHEN_Q` / `WHY_Q` / `HOW_Q` / `WHICH_Q` | Wh-questions | — |
| `LIT` | Fallback | Unrecognized word; always has `.surface` |

---

## 4. Semantic Fields (42)

The canonical field list (must match exactly across `tokenizer.ts`, `tokenizer-ar.ts`, `encoder.ts`, `prep.ts`):

```
know    think   speak   write   see     feel
create  destroy fix     work    move    send
give    gather  hold    connect exist   take
change  govern  fight   trade   social  possess
science health  tech    art     sport   nature
weather animal  plant   body    food    material
color   time    place   size    measure quality
```

**Constraint:** Adding a new field requires updating **all four** files: both tokenizers (add vocabulary), `encoder.ts` (add to `FIELDS` array), and `prep.ts` (add to `FIELD_TOOL`). Missing any one of these causes silent routing failures.

---

## 5. Invariants — Do Not Break

1. **`DIM = 10_000`** — changing this invalidates all saved `.nemo.json` files.
2. **`SEED = 42`** in `encoder.ts` — changing this invalidates all saved atom states.
3. **`ROOT_MAP` and `DIRECT_FIELD` keys** — once a key maps to a field, changing it is a breaking change for any agent trained on inputs containing that word. Add new entries; do not modify existing ones without a major version bump.
4. **`_ROOT_MAP_NORM` / `_DIRECT_FIELD_NORM`** are read-only after module init. Never assign to them directly.
5. **Multi-word strings must NOT go in `DIRECT_FIELD`** — they will be skipped by `_DIRECT_FIELD_NORM` builder (which skips keys containing spaces). Multi-word entries belong in `COMPOUND_FIELDS_AR` (Arabic) or `COMPOUND_FIELDS` (English).
6. **`segment()` side effects** — `segment()` modifies the string (stripping). Always apply `normalize()` before `segment()`. The order of stripping steps matters and must not be reordered.

---

## 6. Test Coverage

```
tests/hdc.test.ts          — hdc.ts primitives (bind, bundle, similarity)
tests/tokenizer.test.ts    — English tokenizer (field assignments, suffix stripping, compounds)
tests/tokenizer-ar.test.ts — Arabic tokenizer (root extraction, clitic stripping, compounds)
tests/agent.test.ts        — HDCAgent (observe, calibrate, classify, update, persistence)
tests/pipeline.test.ts     — Full pipeline (tokenize → encode → classify → gate)
```

Run all: `npm test`
Build: `npm run build`
The `prepublishOnly` script runs `build + test` automatically before `npm publish`.

---

## 7. Public vs Internal

This is the **internal** copy. The **public npm package** is published as `nemo-ai` at:
- npm: https://www.npmjs.com/package/nemo-ai
- GitHub: https://github.com/msm-core/nemo

Both share the same source and version. Changes here should be kept in sync with the public repo via the normal git workflow.
