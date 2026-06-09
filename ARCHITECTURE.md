# nemo-ai — Architecture Reference

> Internal technical reference for developers and code agents working on this codebase.
> For user-facing documentation, see [README.md](README.md).

---

## 1. System Overview

nemo is a **sub-millisecond semantic intent classifier** for AI agent pipelines. It sits between raw user input and an LLM, answering the question: _"Do I already know what this means?"_

The full pipeline is:

```
raw text (English or Arabic)
    │
    ▼  src/tokenizer.ts  (@msm-core/cst adapter)
CST Adapter  →  NemoToken[]
    │
    ▼  src/prep.ts
Prep Layer   →  ReasoningFrame  (dominant_field, is_question, has_negation, pattern)
    │
    ▼  src/encoder.ts
HDV Encoder  →  Float32Array (10,000-dim bipolar)
    │
    ▼  src/agent.ts
HDC Agent    →  ClassifyResult  (field, confidence, top3)
    │
    ▼  src/session.ts
Gate         →  "skip_llm" | "llm_assist" | "full_llm"
```

**Runtime dependency:** `@msm-core/cst` supplies all vocabulary, morphology, and tokenization logic. Nemo itself contains only the HDC algebra, encoder, agent, and routing layer.

---

## 2. Module Map

### `src/hdc.ts` — MAP HDC primitives

The mathematical foundation. No imports from other nemo modules.

| Export               | Type     | Description                                                                     |
| -------------------- | -------- | ------------------------------------------------------------------------------- |
| `DIM`                | `10_000` | Hypervector dimensionality — **never change this**, it breaks saved agent state |
| `randomHV(dim, rng)` | function | Generate a seeded bipolar `{-1, +1}` Float32Array                               |
| `makeRNG(seed)`      | function | xorshift32 PRNG — deterministic across platforms                                |
| `bind(a, b)`         | function | Elementwise multiply — self-inverse: `bind(bind(a,b),b) === a`                  |
| `bundle(vectors)`    | function | Majority vote — merges into prototype                                           |
| `similarity(a, b)`   | function | Cosine similarity ∈ [-1, 1]                                                     |
| `permute(hv, n)`     | function | Cyclic shift by n positions — encodes sequence                                  |

**Design:** `bundle` uses `Float64Array` for accumulation to avoid float32 precision drift on large corpora. Only `sign()` at the end collapses to `Float32Array`.

---

### `src/tokenizer.ts` — CST adapter (EN + AR)

Thin wrapper over `@msm-core/cst`. Maps CST's **5 output types** to nemo's **18-type vocabulary**.

**CST → NemoToken mapping:**

| CST type            | NemoToken type                                                                      | Notes                                                 |
| ------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `ROOT`              | `CONCEPT`                                                                           | carries `.field` (L1 or L2 dot-notation)              |
| `ROLE`              | `ROLE`                                                                              | carries `.role` (`agent`/`patient`/`process`/`place`) |
| `REL`               | `REL`                                                                               | prepositions, conjunctions                            |
| `STR` (negation)    | `NEG`                                                                               |                                                       |
| `STR` (modal)       | `MODAL`                                                                             |                                                       |
| `STR` (future)      | `FUTURE`                                                                            |                                                       |
| `STR` (past)        | `PAST`                                                                              |                                                       |
| `STR` (conditional) | `COND`                                                                              |                                                       |
| `STR` (cause)       | `CAUSE`                                                                             |                                                       |
| `STR` (question)    | `QUERY` / `WHAT_Q` / `WHO_Q` / `WHERE_Q` / `WHEN_Q` / `WHY_Q` / `HOW_Q` / `WHICH_Q` | resolved from surface word                            |
| `LIT`               | `LIT`                                                                               | unrecognized word fallback                            |

**Public exports:**

- `tokenize(text)` → `NemoToken[]` (English)
- `tokenizeAr(text)` → `NemoToken[]` (Arabic)
- `tokenStream(text)` → `string` (space-joined token values, English)
- `tokenStreamAr(text)` → `string` (Arabic)
- `COMPOUND_FIELDS_AR` — re-exported from CST for test compatibility
- `NemoToken` — the primary token interface
- `CSTToken` — deprecated alias for `NemoToken` (backward compat)

---

### `src/encoder.ts` — HDV Encoder

Maps `NemoToken[]` to a single `Float32Array` hypervector.

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

**Classification:** `classify(hv)` computes cosine similarity against all field prototypes, returns top-3. Confidence is `tanh(rawSim * 2.5)` to compress into (0, 1).

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
GATE_HIGH = 0.55; // skip_llm — nemo is confident
GATE_MED = 0.35; // llm_assist — inject semantic context
// < 0.35         // full_llm — unknown input
```

---

## 3. Token Type Reference

All 18 `TokenType` values, shared by English and Arabic tokenizers:

| Type                                                                      | Category      | Notes                                                             |
| ------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| `CONCEPT`                                                                 | Semantic      | Always has `.field` property                                      |
| `ROLE`                                                                    | Morphological | Always has `.role` property (`agent`/`patient`/`process`/`place`) |
| `REL`                                                                     | Relational    | Prepositions, conjunctions                                        |
| `NEG`                                                                     | Structural    | Negation                                                          |
| `QUERY`                                                                   | Structural    | `?` or `؟` punctuation                                            |
| `MODAL`                                                                   | Structural    | Ability/obligation words                                          |
| `COND`                                                                    | Structural    | Conditional words                                                 |
| `CAUSE`                                                                   | Structural    | Causation words                                                   |
| `FUTURE`                                                                  | Structural    | Future tense markers                                              |
| `PAST`                                                                    | Structural    | Past tense markers                                                |
| `WHAT_Q` / `WHO_Q` / `WHERE_Q` / `WHEN_Q` / `WHY_Q` / `HOW_Q` / `WHICH_Q` | Wh-questions  | —                                                                 |
| `LIT`                                                                     | Fallback      | Unrecognized word; always has `.surface`                          |

---

## 4. Semantic Fields

The canonical L1 field list (must match exactly across `encoder.ts` `FIELDS` and `prep.ts` `FIELD_TOOL`):

```
know    think   speak   write   see     feel
create  destroy fix     work    move    send
give    gather  hold    connect exist   take
change  govern  fight   trade   social  possess
science health  tech    art     sport   nature
weather animal  plant   body    food    material
color   time    place   size    measure quality
```

L2 sub-fields use dot notation (`parent.qualifier`) — e.g., `tech.ai`, `place.city`, `trade.currency`. They are encoded as `bind(CONCEPT:parent, QUAL:qualifier)` in the HDV encoder, giving ~50% cosine similarity to the parent while remaining distinct from siblings.

**Adding a new field:** update `encoder.ts` `FIELDS` array + `prep.ts` `FIELD_TOOL`. Vocabulary lives in `@msm-core/cst`.

---

## 5. Invariants — Do Not Break

1. **`DIM = 10_000`** — changing this invalidates all saved `.nemo.json` files.
2. **`SEED = 42`** in `encoder.ts` — changing this invalidates all saved atom states.
3. **`FIELDS` order in `encoder.ts`** — atoms are generated in declaration order. New fields must only be appended; inserting mid-array shifts the RNG sequence for all subsequent atoms.
4. **`SUB_FIELDS` order in `encoder.ts`** — same constraint as `FIELDS`. Append only.
5. **Vocabulary lives in `@msm-core/cst`.** Do not copy vocab tables into nemo source.

---

## 6. Test Coverage

```
tests/hdc.test.ts          — hdc.ts primitives (bind, bundle, similarity)
tests/tokenizer.test.ts    — English tokenizer (field assignments, suffix stripping, compounds)
tests/tokenizer-ar.test.ts — Arabic CST adapter (clitic handling, wh-word mapping, compound fields)
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
