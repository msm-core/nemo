# @msm-core/nemo

> **N**eural **E**volving **M**emory **O**bject — but also the fish 🐟

> Evolving semantic memory and intent router for AI agent pipelines.

[![npm](https://img.shields.io/npm/v/@msm-core/nemo)](https://www.npmjs.com/package/@msm-core/nemo)
[![license](https://img.shields.io/npm/l/@msm-core/nemo)](LICENSE)
[![tests](https://img.shields.io/badge/tests-93%20passing-brightgreen)](#)

Sub-millisecond intent classification using **Hyperdimensional Computing (MAP-HDC)** — pure TypeScript, one runtime dependency (`@msm-core/cst`), no GPU, no embedding model. Works in Node.js and the browser. Supports **English and Arabic** out of the box. Learns with every interaction.

```bash
npm install @msm-core/nemo
```

---

## Overview

nemo sits in front of your LLM (or between agent layers) and answers one question fast:

> _"Do I know what this input means, and where should it route?"_

```
raw text  (English or Arabic)
    │
    ▼
CST Tokenizer   →  semantic tokens   (CONCEPT · ROLE · NEG · QUERY · MODAL · REL · …)
    │
    ▼
Prep Layer      →  intent frame      (is_question · has_negation · dominant_field · pattern)
    │
    ▼
HDC Encoder     →  hypervector       (10,000-dim bipolar Float32Array, MAP algebra)
    │
    ▼
HDC Agent       →  classification    (nearest prototype · cosine similarity · confidence)
    │
    ▼
Gate            →  skip_llm  |  llm_assist  |  full_llm
```

The agent **updates itself** with every accepted input — no retraining, no model weights, no GPU.

---

## Quickstart

```ts
import { pipeline, HDCAgent, HDVEncoder, tokenize } from "@msm-core/nemo";

const encoder = new HDVEncoder(); // seeded — deterministic vector space
const agent = new HDCAgent();

// Train on a few examples
const training: Record<string, string[]> = {
  tech: ["fix the bug", "write python code", "debug error"],
  weather: ["rain forecast", "temperature tomorrow", "storm warning"],
  food: ["pasta recipe", "how to cook chicken", "vegan dinner ideas"],
};

const examples: Array<{ hv: Float32Array; field: string }> = [];
for (const [field, phrases] of Object.entries(training)) {
  for (const phrase of phrases) {
    const [hv] = encoder.encode(tokenize(phrase));
    agent.observe(hv, field);
    examples.push({ hv, field });
  }
}
// Discriminative retraining — builds inter-class margin a plain centroid lacks.
// Strongly recommended: lifts macro-F1 substantially vs observe()-only.
agent.fit(examples, { epochs: 30 });
agent.calibrate();

// Classify
const result = pipeline("fix the syntax error in my code", agent, encoder);
console.log(result.classification.field); // "tech"
console.log(result.classification.confidence); // 0.78
console.log(result.gate); // "skip_llm"
console.log(result.tool); // "code_assistant"
```

---

## Arabic Support

nemo ships a full Arabic tokenizer with feature parity to the English one. Both produce identical `NemoToken[]` output — the same encoder and agent work for both languages without any configuration.

```ts
import { tokenizeAr, tokenStreamAr, pipelineAr } from "@msm-core/nemo";

// All 18 token types work in Arabic
tokenStreamAr("يمكن أن أساعدك في البرمجة");
// → "MODAL CONCEPT:speak REL:in CONCEPT:tech"

tokenStreamAr("ذكاء اصطناعي يغيّر العالم");
// → "CONCEPT:tech CONCEPT:work"

tokenStreamAr("لماذا فشل النظام؟");
// → "WHY_Q CONCEPT:tech QUERY"
```

The Arabic tokenizer includes:

- **Clitic segmentation** — strips و/ف conjunctions, ب/ل/ك prepositions, ال article, object suffixes
- **Root-based lookup** — 2,100+ stems → 42 semantic fields via trilateral root codes
- **Compound phrases** — 50+ bigrams (`ذكاء اصطناعي` → `tech`, `كرة قدم` → `sport`, …)
- **Morphological roles** — فاعل (agent), مفعول (patient), تفعيل (process), مفعلة (place)
- **Normalization resilience** — diacritics, ى/ي, آ/أ/إ/ا, tatweel all handled transparently

---

## Using in an Agent Pipeline

### Pre-LLM gate

```ts
import { pipeline, pipelineAr, HDCAgent, HDVEncoder } from "@msm-core/nemo";

async function route(
  input: string,
  agent: HDCAgent,
  encoder: HDVEncoder,
  llm: (prompt: string, opts?: { system?: string }) => Promise<string>,
) {
  const result = pipeline(input, agent, encoder);

  if (result.gate === "skip_llm") {
    return callTool(result.tool, input); // confident — bypass LLM
  }
  if (result.gate === "llm_assist") {
    const system = `Intent: ${result.classification.field}. Tool: ${result.tool}.`;
    return llm(input, { system }); // steer LLM with context
  }
  return llm(input); // unknown — full LLM
}
```

### Persistent session (recommended)

`NemoSession` wraps encoder + agent + tools into one persistent unit with built-in auto-save:

```ts
import { NemoSession } from "@msm-core/nemo";

// Recommended: loads saved state if file exists, starts fresh if not.
// Auto-saves every 100 teach() calls and flushes on SIGTERM — zero config needed.
const session = NemoSession.loadOrCreate("./memory.nemo.json", {
  tools: {
    tech: (input) => codeAssistant(input),
    weather: (input) => weatherService(input),
  },
});

const result = await session.run(userInput);

// Teach from confirmed ground truth — triggers auto-save counter
session.teach("blood pressure monitor", "health");

// Manual flush at any time (e.g. before a planned restart)
session.save();
```

### Episodic memory retrieval

For Arabic, use `pipelineAr(text, agent, encoder)` which calls `tokenizeAr` internally.

```ts
const [queryHV] = encoder.encode(tokenize("how do I fix this"));
const episodes = agent.retrieve(queryHV, 3);

for (const ep of episodes) {
  console.log(ep.meta?.text, "→", ep.sim.toFixed(3));
}
```

### Share memory between agents

```ts
import fs from "fs";
import { HDCAgent } from "@msm-core/nemo";

// Export
fs.writeFileSync("memory.nemo.json", JSON.stringify(agent.toJSON()));

// Import in another process / service
const agentB = HDCAgent.fromJSON(
  JSON.parse(fs.readFileSync("memory.nemo.json", "utf8")),
);
```

---

## API Reference

### `pipeline(text, agent, encoder): PipelineResult`

Full stack in one call. For Arabic, use `pipelineAr(text, agent, encoder)` — same signature.

| Field            | Type             | Description                                 |
| ---------------- | ---------------- | ------------------------------------------- |
| `tokens`         | `NemoToken[]`    | Token array                                 |
| `frame`          | `ReasoningFrame` | intent frame (is_question, has_negation, …) |
| `classification` | `ClassifyResult` | field, confidence, top3                     |
| `tool`           | `string`         | mapped tool name                            |
| `gate`           | `GateDecision`   | `skip_llm` / `llm_assist` / `full_llm`      |

### `HDCAgent`

| Method                         | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| `observe(hv, field)`           | Accumulate a hypervector into a field centroid          |
| `fit(examples, opts?)`         | Discriminative retraining — iterative margin-building pass after `observe()` (recommended; big macro-F1 gain) |
| `calibrate()`                  | Compute per-field thresholds — call once after training |
| `classify(hv)`                 | Returns `ClassifyResult`                                |
| `update(hv, field, meta?)`     | Conditional self-update at inference time               |
| `feedback(hv, field, meta?)`   | Unconditional ground-truth update                       |
| `step(hv, meta, groundTruth?)` | classify + update in one call                           |
| `retrieve(queryHV, k, field?)` | Return k nearest episodes from memory                   |
| `toJSON()`                     | Serialize full state to a plain JSON-safe object        |
| `HDCAgent.fromJSON(state)`     | Restore from serialized state                           |
| `snapshot()`                   | Return field counts and memory stats                    |

### `HDVEncoder`

| Method                 | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `encode(tokens)`       | Returns `[Float32Array, dominantField \| null]`        |
| `atomState()`          | Export atom hypervectors as `Record<string, number[]>` |
| `loadAtomState(state)` | Restore a saved atom space                             |

### Tokenizers

| Export                | Language | Description                                   |
| --------------------- | -------- | --------------------------------------------- |
| `tokenize(text)`      | English  | Returns `NemoToken[]`                         |
| `tokenStream(text)`   | English  | Returns token values as a space-joined string |
| `tokenizeAr(text)`    | Arabic   | Returns `NemoToken[]` — same interface        |
| `tokenStreamAr(text)` | Arabic   | Returns token values as a space-joined string |
| `COMPOUND_FIELDS_AR`  | Arabic   | Bigram → field map (exported for extension)   |

### Gate thresholds

| Gate         | Confidence  | Meaning                                        |
| ------------ | ----------- | ---------------------------------------------- |
| `skip_llm`   | ≥ 0.55      | nemo is confident — skip the LLM entirely      |
| `llm_assist` | 0.35 – 0.55 | Inject semantic context into the LLM prompt    |
| `full_llm`   | < 0.35      | Unknown input — route to the LLM without hints |

```ts
import { GATE_HIGH, GATE_MED } from "@msm-core/nemo";
// GATE_HIGH = 0.55,  GATE_MED = 0.35
```

### `NemoSession` factories

| Factory                                              | When to use                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `NemoSession.loadOrCreate(path, opts?)`              | **Recommended.** Restores saved state if the file exists; starts fresh if not (ENOENT). |
| `NemoSession.load(path, opts?)`                      | File **must** exist — throws if missing. Use when a missing file is a deployment error. |
| `new NemoSession({ agent, encoder, filePath, ... })` | Manual construction from pre-built instances.                                           |

### `NemoSession` persistence options

```ts
NemoSession.loadOrCreate("./.nemo.json", {
  autoSaveEvery: 100,   // save every N teach() calls (default 100 when filePath given, 0 otherwise)
  shutdownHook: true,   // flush on SIGTERM/SIGINT — default true when filePath given
  tools: { ... },       // tool functions (not serialised, reattach after load)
});
```

| Option          | Default  | Description                                                                        |
| --------------- | -------- | ---------------------------------------------------------------------------------- |
| `autoSaveEvery` | `100` ¹  | Save every N `teach()` calls. `teach()` is the only call that mutates HDC state.   |
| `shutdownHook`  | `true` ¹ | Register `SIGTERM`/`SIGINT` handlers to flush state on process exit. Node.js only. |

¹ When `filePath` is provided. Without a path both default to `0`/`false` — suitable for browser environments.

### Manual save / custom strategies

```ts
// Explicit save at any point
session.save();

// Save to a different path (e.g. snapshot before upgrade)
session.save("./memory.nemo.backup.json");

// High-traffic: disable built-in auto-save, use your own interval
const session = NemoSession.loadOrCreate("./.nemo.json", {
  autoSaveEvery: 0,
  shutdownHook: false,
});
setInterval(() => session.save(), 5 * 60_000); // every 5 min
process.once("SIGTERM", () => session.save());
```

### Low-level persistence helpers

```ts
import { saveToFile, loadFromFile } from "@msm-core/nemo";

// Save agent + encoder directly
saveToFile("./memory.nemo.json", agent, encoder, { myMeta: "v2" });
const { agent, encoder, meta } = loadFromFile("./memory.nemo.json");
```

State is a plain JSON file — portable to any store:

```ts
// Database column
await db.run("UPDATE sessions SET state = ?", [JSON.stringify(agent.toJSON())]);

// Redis
await redis.set(`nemo:${userId}`, JSON.stringify(agent.toJSON()));
```

### What is inside `.nemo.json`

| Key            | Contents                                                      | Notes                                                    |
| -------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| `agent`        | Per-field prototype hypervectors + thresholds + episode store | Grows with `teach()` calls                               |
| `encoderAtoms` | Random atom space (seeded at `SEED=42`)                       | Deterministic — could be skipped, saved for fast startup |
| `version`      | Integer schema version                                        | Currently `1`                                            |
| `savedAt`      | ISO timestamp                                                 | Informational only                                       |

The built-in vocabulary (from `@msm-core/cst`) is **not** in the file — it is compiled into the package. Only the learned improvements from `teach()` are persisted. Losing the file means starting fresh with the built-in vocabulary, not losing the model.

---

## Token Types

nemo's CST (Conceptual Semantic Tokenizer) produces 18 token types shared by both languages:

| Type      | Trigger               | Example                          |
| --------- | --------------------- | -------------------------------- |
| `CONCEPT` | Semantic field match  | `CONCEPT:tech`, `CONCEPT:health` |
| `ROLE`    | Morphological pattern | `ROLE:agent`, `ROLE:patient`     |
| `REL`     | Preposition           | `REL:in`, `REL:to`, `REL:from`   |
| `NEG`     | Negation word         | not, لا, لم                      |
| `QUERY`   | Question mark         | ?, ؟                             |
| `WHAT_Q`  | What-question         | what, ماذا                       |
| `WHO_Q`   | Who-question          | who, من                          |
| `WHERE_Q` | Where-question        | where, أين                       |
| `WHEN_Q`  | When-question         | when, متى                        |
| `WHY_Q`   | Why-question          | why, لماذا                       |
| `HOW_Q`   | How-question          | how, كيف                         |
| `WHICH_Q` | Which-question        | which, أي                        |
| `MODAL`   | Ability/obligation    | should, يمكن, يجب                |
| `COND`    | Condition             | if, إذا                          |
| `CAUSE`   | Causation             | because, لأن                     |
| `FUTURE`  | Future marker         | will, سـ prefix                  |
| `PAST`    | Past marker           | was/were, كان                    |
| `LIT`     | No match (fallback)   | unknown terms                    |

---

## How it learns

nemo uses **MAP Hyperdimensional Computing** (Multiply-Add-Permute algebra):

- Every token maps to a seeded random **10,000-dim bipolar `{-1, +1}` `Float32Array`**
- `bind(a, b)` — elementwise multiply — encodes associations, self-inverse
- `bundle([a, b, c])` — majority vote — merges into a category prototype
- `similarity(a, b)` — cosine similarity — measures semantic distance

The agent keeps one **running sum** per semantic field. Each accepted input shifts the prototype slightly toward the new example — continual learning with no gradient descent, no stored weights, no retraining cycle.

---

## Semantic Fields

42 shared fields across English and Arabic:

`know` · `think` · `speak` · `write` · `see` · `feel` · `create` · `destroy` · `fix` · `work` · `move` · `send` · `give` · `gather` · `hold` · `connect` · `exist` · `govern` · `fight` · `trade` · `social` · `possess` · `science` · `health` · `tech` · `art` · `sport` · `nature` · `weather` · `animal` · `plant` · `body` · `food` · `material` · `color` · `time` · `place` · `size` · `measure` · `quality`

---

## Development

```bash
git clone https://github.com/msm-core/nemo.git
cd nemo
npm install
npm test       # 118 tests
npm run build  # compiles to dist/
```

---

## Based on CST

nemo's tokenizer is built on the linguistic principles of **Contextual Semantic Tokenization (CST)** — a linguistically-grounded alternative to subword segmentation, originally developed for language model training.

> CST encodes semantic field and morphological role directly into every token. Arabic morphology defines the algebraic foundation: root × pattern = concept. The root ك-ت-ب (k-t-b, write) + pattern فَاعِل (agent) = كاتب (writer). CST generalises this algebra across languages.

**Research project:** [github.com/emadjumaah/cst](https://github.com/emadjumaah/cst)

### What nemo uses from CST

| CST concept                                    | nemo implementation                               |
| ---------------------------------------------- | ------------------------------------------------- |
| Semantic fields (~45 universal)                | 42 shared fields, same names                      |
| Morphological role detection                   | `ROLE:agent` / `patient` / `process` / `place`    |
| Triconsonantal root algebra                    | Root-based Arabic stem lookup via `@msm-core/cst` |
| Structural markers (negation, tense, modality) | `NEG`, `MODAL`, `PAST`, `FUTURE`, `COND`, `CAUSE` |
| Cross-lingual field parity                     | Same 42 fields for English and Arabic             |

### What is different

The full CST research tokenizer runs a 7-stage pipeline (including named-entity detection) and produces `CMP:write:agent` / `ROOT:move` / `STR:negation` tokens — designed for language model training benchmarks (35–46% BPC reduction over SentencePiece BPE).

nemo implements a **runtime-optimized subset** of those principles: a 4-stage pipeline (normalize → structural detect → clitic segment → root/field lookup), with a flattened token format (`CONCEPT:write` + `ROLE:agent`) that maps efficiently into HDC hypervectors. The goal is sub-millisecond classification in agent pipelines, not LM training.

If you need the full research tokenizer for training or evaluation, see the [CST repository](https://github.com/emadjumaah/cst).

---

## License

MIT
