# nemo-ai

> Evolving semantic memory and intent router for AI agent pipelines.

[![npm](https://img.shields.io/npm/v/nemo-ai)](https://www.npmjs.com/package/nemo-ai)
[![license](https://img.shields.io/npm/l/nemo-ai)](LICENSE)
[![tests](https://img.shields.io/badge/tests-90%20passing-brightgreen)](#)

Sub-millisecond intent classification, pure TypeScript, zero dependencies, no GPU, no embedding model. Works in Node.js and the browser. Supports **English and Arabic** out of the box. Learns with every interaction.

```bash
npm install nemo-ai
```

---

## Overview

nemo sits in front of your LLM (or between agent layers) and answers one question fast:

> *"Do I know what this input means, and where should it route?"*

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
import { pipeline, HDCAgent, HDVEncoder, tokenize } from "nemo-ai";

const encoder = new HDVEncoder();   // seeded — deterministic vector space
const agent   = new HDCAgent();

// Train on a few examples
const training: Record<string, string[]> = {
  tech:    ["fix the bug", "write python code", "debug error"],
  weather: ["rain forecast", "temperature tomorrow", "storm warning"],
  food:    ["pasta recipe", "how to cook chicken", "vegan dinner ideas"],
};

for (const [field, phrases] of Object.entries(training)) {
  for (const phrase of phrases) {
    const [hv] = encoder.encode(tokenize(phrase));
    agent.observe(hv, field);
  }
}
agent.calibrate();

// Classify
const result = pipeline("fix the syntax error in my code", agent, encoder);
console.log(result.classification.field);       // "tech"
console.log(result.classification.confidence);  // 0.78
console.log(result.gate);                       // "skip_llm"
console.log(result.tool);                       // "code_assistant"
```

---

## Arabic Support

nemo ships a full Arabic tokenizer with feature parity to the English one. Both produce identical `CSTToken[]` output — the same encoder and agent work for both languages without any configuration.

```ts
import { tokenizeAr, tokenStreamAr } from "nemo-ai";

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
- **Root-based lookup** — 700+ stems → 40 semantic fields via trilateral root codes
- **Compound phrases** — 50+ bigrams (`ذكاء اصطناعي` → `tech`, `كرة قدم` → `sport`, …)
- **Morphological roles** — فاعل (agent), مفعول (patient), تفعيل (process), مفعلة (place)
- **Normalization resilience** — diacritics, ى/ي, آ/أ/إ/ا, tatweel all handled transparently

---

## Using in an Agent Pipeline

### Pre-LLM gate

```ts
import { pipeline, HDCAgent, HDVEncoder } from "nemo-ai";

async function route(
  input: string,
  agent: HDCAgent,
  encoder: HDVEncoder,
  llm: (prompt: string, opts?: { system?: string }) => Promise<string>,
) {
  const result = pipeline(input, agent, encoder);

  if (result.gate === "skip_llm") {
    return callTool(result.tool, input);          // confident — bypass LLM
  }
  if (result.gate === "llm_assist") {
    const system = `Intent: ${result.classification.field}. Tool: ${result.tool}.`;
    return llm(input, { system });                // steer LLM with context
  }
  return llm(input);                              // unknown — full LLM
}
```

### Persistent session (recommended)

`NemoSession` wraps encoder + agent + tools into one persistent unit with auto-save:

```ts
import { NemoSession } from "nemo-ai";

const session = await NemoSession.load("./memory.nemo.json", {
  tools: {
    tech:    (input) => codeAssistant(input),
    weather: (input) => weatherService(input),
  },
  autoSaveEvery: 10,   // save every 10 updates
});

const result = session.run(userInput);
await session.save();

// Teach from confirmed ground truth
await session.teach("blood pressure monitor", "health");
```

### Episodic memory retrieval

```ts
const [queryHV] = encoder.encode(tokenize("how do I fix this"));
const episodes  = agent.retrieve(queryHV, 3);

for (const ep of episodes) {
  console.log(ep.meta?.text, "→", ep.sim.toFixed(3));
}
```

### Share memory between agents

```ts
import fs from "fs";
import { HDCAgent } from "nemo-ai";

// Export
fs.writeFileSync("memory.nemo.json", JSON.stringify(agent.toJSON()));

// Import in another process / service
const agentB = HDCAgent.fromJSON(
  JSON.parse(fs.readFileSync("memory.nemo.json", "utf8"))
);
```

---

## API Reference

### `pipeline(text, agent, encoder): PipelineResult`

Full stack in one call. English only — for Arabic use `tokenizeAr` then `encoder.encode`.

| Field | Type | Description |
|---|---|---|
| `tokens` | `CSTToken[]` | CST token array |
| `frame` | `ReasoningFrame` | intent frame (is_question, has_negation, …) |
| `classification` | `ClassifyResult` | field, confidence, top3 |
| `tool` | `string` | mapped tool name |
| `gate` | `GateDecision` | `skip_llm` / `llm_assist` / `full_llm` |

### `HDCAgent`

| Method | Description |
|---|---|
| `observe(hv, field)` | Accumulate a hypervector during training |
| `calibrate()` | Compute per-field thresholds — call once after training |
| `classify(hv)` | Returns `ClassifyResult` |
| `update(hv, field, meta?)` | Conditional self-update at inference time |
| `feedback(hv, field, meta?)` | Unconditional ground-truth update |
| `step(hv, meta, groundTruth?)` | classify + update in one call |
| `retrieve(queryHV, k, field?)` | Return k nearest episodes from memory |
| `toJSON()` | Serialize full state to a plain JSON-safe object |
| `HDCAgent.fromJSON(state)` | Restore from serialized state |
| `snapshot()` | Return field counts and memory stats |

### `HDVEncoder`

| Method | Description |
|---|---|
| `encode(tokens)` | Returns `[Float32Array, dominantField \| null]` |
| `atomState()` | Export atom hypervectors as `Record<string, number[]>` |
| `loadAtomState(state)` | Restore a saved atom space |

### Tokenizers

| Export | Language | Description |
|---|---|---|
| `tokenize(text)` | English | Returns `CSTToken[]` |
| `tokenStream(text)` | English | Returns token values as a space-joined string |
| `tokenizeAr(text)` | Arabic | Returns `CSTToken[]` — same interface |
| `tokenStreamAr(text)` | Arabic | Returns token values as a space-joined string |
| `COMPOUND_FIELDS` | English | Bigram → field map (exported for extension) |
| `COMPOUND_FIELDS_AR` | Arabic | Bigram → field map (exported for extension) |

### Gate thresholds

| Gate | Confidence | Meaning |
|---|---|---|
| `skip_llm` | ≥ 0.55 | nemo is confident — skip the LLM entirely |
| `llm_assist` | 0.35 – 0.55 | Inject semantic context into the LLM prompt |
| `full_llm` | < 0.35 | Unknown input — route to the LLM without hints |

```ts
import { GATE_HIGH, GATE_MED } from "nemo-ai";
// GATE_HIGH = 0.55,  GATE_MED = 0.35
```

### Persistence helpers (`persist.ts`)

```ts
import { saveToFile, loadFromFile } from "nemo-ai";

await saveToFile("./memory.nemo.json", agent, encoder, { version: "1.3.0" });
const { agent, encoder, meta } = await loadFromFile("./memory.nemo.json");
```

State is plain JSON — drop it anywhere:

```ts
// Database column
await db.run("UPDATE sessions SET state = ?", [JSON.stringify(agent.toJSON())]);

// Redis
await redis.set(`nemo:${userId}`, JSON.stringify(agent.toJSON()));
```

---

## Token Types

nemo's CST (Conceptual Semantic Tokenizer) produces 18 token types shared by both languages:

| Type | Trigger | Example |
|---|---|---|
| `CONCEPT` | Semantic field match | `CONCEPT:tech`, `CONCEPT:health` |
| `ROLE` | Morphological pattern | `ROLE:agent`, `ROLE:patient` |
| `REL` | Preposition | `REL:in`, `REL:to`, `REL:from` |
| `NEG` | Negation word | not, لا, لم |
| `QUERY` | Question mark | ?, ؟ |
| `WHAT_Q` | What-question | what, ماذا |
| `WHO_Q` | Who-question | who, من |
| `WHERE_Q` | Where-question | where, أين |
| `WHEN_Q` | When-question | when, متى |
| `WHY_Q` | Why-question | why, لماذا |
| `HOW_Q` | How-question | how, كيف |
| `WHICH_Q` | Which-question | which, أي |
| `MODAL` | Ability/obligation | should, يمكن, يجب |
| `COND` | Condition | if, إذا |
| `CAUSE` | Causation | because, لأن |
| `FUTURE` | Future marker | will, سـ prefix |
| `PAST` | Past marker | was/were, كان |
| `LIT` | No match (fallback) | unknown terms |

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

40 shared fields across English and Arabic:

`know` · `think` · `speak` · `write` · `see` · `feel` · `create` · `destroy` · `fix` · `work` · `move` · `send` · `give` · `gather` · `hold` · `connect` · `exist` · `govern` · `fight` · `trade` · `social` · `possess` · `science` · `health` · `tech` · `art` · `sport` · `nature` · `weather` · `animal` · `plant` · `body` · `food` · `material` · `color` · `time` · `place` · `size` · `measure` · `quality`

---

## Development

```bash
git clone https://github.com/msm-core/nemo.git
cd nemo
npm install
npm test       # 90 tests
npm run build  # compiles to dist/
```

---

## License

MIT
