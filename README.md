# nemo-ai

**Evolving semantic memory and intent router for AI agent pipelines.**

Sub-millisecond intent classification, pure TypeScript, no dependencies, no GPU, no embedding model. Works in Node.js and the browser. Learns with every interaction.

```
npm install nemo-ai
```

---

## What it does

nemo sits in front of your LLM (or between agent layers) and answers one question fast:

> *"Do I know what this input means, and where should it go?"*

```
raw text
   │
   ▼
CST Tokenizer      → semantic tokens  (concept / role / negation / question type)
   │
   ▼
Prep Layer         → intent frame     (is_question, has_negation, pattern match, dominant field)
   │
   ▼
HDC Encoder        → hypervector      (10,000-dim bipolar Float32Array, MAP algebra)
   │
   ▼
HDC Agent          → classification   (nearest prototype, cosine similarity, confidence)
   │
   ▼
Gate               → skip_llm | llm_assist | full_llm
```

The agent **updates itself** every time it sees a coherent new input — no retraining needed.

---

## Install

```bash
npm install @nemo/core
```

Zero runtime dependencies. Pure `Float32Array` math — runs anywhere JavaScript runs.

---

## Quickstart

```ts
import { pipeline, HDCAgent, HDVEncoder, tokenize } from "nemo-ai";

// 1. Create encoder + agent
const encoder = new HDVEncoder();  // seeded — same seed = same vector space
const agent   = new HDCAgent();

// 2. Train on a few examples
const training: Record<string, string[]> = {
  tech:    ["fix the bug", "write python code", "debug error", "software system"],
  weather: ["rain forecast", "temperature tomorrow", "storm warning"],
  food:    ["pasta recipe", "how to cook chicken", "vegan dinner ideas"],
};

for (const [field, phrases] of Object.entries(training)) {
  for (const text of phrases) {
    const [hv] = encoder.encode(tokenize(text));
    agent.observe(hv, field);
  }
}

agent.calibrate();  // set per-field thresholds

// 3. Run inference
const result = pipeline("fix the syntax error in my code", agent, encoder);

console.log(result.classification.field);       // "tech"
console.log(result.classification.confidence);  // 0.78
console.log(result.gate);                       // "skip_llm"
console.log(result.tool);                       // "code_assistant"
```

---

## Using inside an agent

### As a pre-LLM gate

```ts
import { pipeline, GATE_HIGH, GATE_MED, HDCAgent, HDVEncoder } from "nemo-ai";

async function route(
  userInput: string,
  agent: HDCAgent,
  encoder: HDVEncoder,
  llm: (prompt: string, opts?: { system?: string }) => Promise<string>,
): Promise<string> {
  const result = pipeline(userInput, agent, encoder);

  if (result.gate === "skip_llm") {
    // High confidence — no LLM needed
    return callTool(result.tool, userInput);
  }

  if (result.gate === "llm_assist") {
    // Inject semantic context to steer LLM
    const system = `Intent: ${result.classification.field}. Tool: ${result.tool}.`;
    return llm(userInput, { system });
  }

  // Low confidence — full LLM, no hint
  return llm(userInput);
}
```

### As an agent memory layer

```ts
import { pipeline, tokenize, HDCAgent, HDVEncoder } from "nemo-ai";

// Store interaction as episode
const result = pipeline(userInput, agent, encoder);
const [hv]   = encoder.encode(result.tokens);
agent.update(hv, result.classification.field, { text: userInput });

// Later: retrieve semantically similar past inputs
const [queryHV] = encoder.encode(tokenize("how do I fix this"));
const past = agent.retrieve(queryHV, 3);
for (const ep of past) {
  console.log(ep.meta.text, "→ sim:", ep.sim.toFixed(3));
}
```

### Between agent layers (persist + share)

```ts
import fs from "fs";
import { HDCAgent } from "nemo-ai";

// Agent A: save memory
const state = agent.toJSON();
fs.writeFileSync("memory.nemo.json", JSON.stringify(state));

// Agent B: restore and continue
const loaded = HDCAgent.fromJSON(
  JSON.parse(fs.readFileSync("memory.nemo.json", "utf8"))
);
const result = pipeline(newInput, loaded, encoder);
```

---

## Core API

### `pipeline(text, agent, encoder): PipelineResult`

Full stack in one call.

| Field | Type | Description |
|---|---|---|
| `result.tokens` | `CSTToken[]` | CST token list |
| `result.frame` | `ReasoningFrame` | intent frame from prep layer |
| `result.classification` | `ClassifyResult` | field, confidence, top3 |
| `result.tool` | `string` | mapped tool name |
| `result.gate` | `GateDecision` | `skip_llm` / `llm_assist` / `full_llm` |

### `HDCAgent`

| Method | Description |
|---|---|
| `observe(hv, field)` | Accumulate HV during training |
| `calibrate()` | Compute per-field thresholds (call once after training) |
| `classify(hv)` | Returns `ClassifyResult` |
| `update(hv, field, meta)` | Conditional self-update at inference time |
| `step(hv, meta, groundTruth?)` | classify + update in one call |
| `retrieve(queryHV, k, field?)` | Episodic memory retrieval |
| `toJSON()` | Export full state as plain JSON-serialisable object |
| `HDCAgent.fromJSON(state)` | Restore from exported state |
| `snapshot()` | Stats object |

### `HDVEncoder`

| Method | Description |
|---|---|
| `encode(tokens)` | Returns `[Float32Array, string \| null]` |
| `atomState()` | Export atom HVs as `Record<string, number[]>` |
| `loadAtomState(state)` | Restore atom space |

### Gate thresholds

| Gate | Confidence | Meaning |
|---|---|---|
| `skip_llm` | ≥ 0.55 | nemo is confident — skip LLM entirely |
| `llm_assist` | 0.35–0.55 | Inject nemo context into LLM prompt |
| `full_llm` | < 0.35 | Unknown input — let LLM handle it fully |

---

## Persistence format

State is plain JSON — serialise however you like:

```ts
// JSON file
fs.writeFileSync("memory.json", JSON.stringify(agent.toJSON()));
const agent2 = HDCAgent.fromJSON(JSON.parse(fs.readFileSync("memory.json", "utf8")));

// Database column
await db.run("UPDATE sessions SET memory = ? WHERE id = ?", [
  JSON.stringify(agent.toJSON()), sessionId
]);

// Redis
await redis.set(`agent:${id}`, JSON.stringify(agent.toJSON()));
```

---

## How it learns

nemo uses **MAP (Multiply-Add-Permute) Hyperdimensional Computing**:

- Every semantic concept maps to a random 10,000-dim bipolar `{-1, +1}` `Float32Array`
- **`bind(a, b)`** — elementwise multiply — encodes relationships, self-inverse
- **`bundle(a, b, c)`** — majority vote — encodes category prototypes
- **`similarity(a, b)`** — cosine similarity — measures meaning distance

The agent keeps one **running sum** per semantic field. Every accepted input shifts the prototype slightly — continual learning with no gradient descent, no model weights.

---

## Build from source

```bash
npm install nemo-ai
```
