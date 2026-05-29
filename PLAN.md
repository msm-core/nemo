# nemo — Development Plan

Evolving semantic memory and intent router.
Published: `npm install nemo-ai`

---

## Current State (v1.2.1)

- CST tokenizer: ~500 English words → 40 semantic fields
- HDC encoder: MAP algebra, Float32Array, 10,000-dim, seeded deterministic
- Prep layer: rule-based intent frame (patterns, negation, field resolution)
- HDC Agent: prototype memory, cosine classify, conditional self-update, episodic retrieval
- Persistence: `toJSON()` / `fromJSON()` — full state as plain JSON
- Gate: `skip_llm` / `llm_assist` / `full_llm`
- Tests: 51 passing

---

## Phase 1 — Persistence + Session (next)

Goal: make nemo deployable in a real agent without manual wiring.

### 1.1 File helpers

```ts
agent.saveToFile("./memory.nemo.json");
const agent = await NemoAgent.loadFromFile("./memory.nemo.json");
agent.autosave("./memory.nemo.json", { every: 10 }); // save every N updates
```

### 1.2 NemoSession — single entry point

Wraps encoder + agent + tools as one persistent unit.

```ts
const session = await NemoSession.load("./memory.nemo.json");
const result = session.run(userText);
await session.save();
```

### 1.3 Checkpoint vs full save

- `checkpoint` — prototypes only (~40 vectors, ~3MB) — fast, for inference
- `full` — prototypes + all episodes — for transfer, backup

---

## Phase 2 — Feedback Loop

Goal: agent actually evolves from LLM answers, not just from training.

### 2.1 agent.feedback()

Called after LLM responds, teaches the agent what the input meant.

```ts
const result = session.run(userText);
// LLM answers...
agent.feedback(hv, confirmedField, { text: userText, response: llmAnswer });
// Next time same input → skip_llm
```

### 2.2 Confidence decay

Old episodes fade if contradicted. Prevents prototype drift from bad feedback.

---

## Phase 3 — Tool Registry

Goal: routing actually calls something, not just returns a string.

```ts
const session = new NemoSession({
  agent,
  encoder,
  tools: {
    code_assistant: async (input) => callCodeTool(input),
    weather_service: async (input) => fetchWeather(input),
    recipe_advisor: async (input) => searchRecipes(input),
  },
});

const result = await session.run("fix the syntax error");
// result.response — actual tool output, no LLM needed
```

---

## Phase 4 — English Tokenizer Improvements

Goal: better coverage without adding complexity.

- Compound words: "machine learning", "bug fix", "code review" → single concept
- Unknown word fallback: morphological guess before LIT (stem stripping)
- Frequency-weighted field resolution: when word maps to 2 fields, pick more common
- Negation scope: track which concept the NEG applies to (not just presence)
- Context window: 2-gram lookups ("stock market" → trade, not separate tokens)

---

## Phase 5 — Multilingual Architecture

See section below for full design.

---

## Phase 6 — Performance

Only needed if Phase 1–4 prove it's a bottleneck.

- WASM bundle for encode/classify hot path
- Lazy-load vocabulary (stream SEMANTIC_FIELDS, don't parse full dict on startup)
- Worker thread for agent updates (non-blocking)

---

---

# Language Question: How Far Can the CST Tokenizer Go?

## English — now

The tokenizer is a **vocabulary lookup + morphology rules** approach:

```
word → SEMANTIC_FIELDS[word] → field
word → suffix/prefix rules   → role
word → STRUCTURAL_MAP        → NEG / QUERY / COND / ...
```

**What it covers well:**

- Core vocabulary: ~500 words across 40 fields
- Morphology: -ing, -er, -tion, -ness, un-, re-, dis- etc.
- Structural: negation (including contractions), all question types, tense, modality

**What it misses:**

- Slang, new words, proper nouns → fall through to LIT → LLM handles
- Compound phrases ("machine learning" → two separate tokens)
- Context disambiguation ("bank" = finance or place? — picks whichever comes first in SEMANTIC_FIELDS)
- Idiomatic expressions ("kick the bucket" → meaningless tokens)

**The key insight:** misses are not failures. LIT tokens fall through to `full_llm`. The agent learns from that LLM answer via feedback. Next time the same phrase appears → it's known. The vocabulary grows organically through usage.

---

## Arabic — later

Arabic is structurally different. The tokenizer architecture stays the same — only the front-end changes.

### The fundamental difference: roots

English is surface-based. Arabic is **root-based** (trilateral roots):

| Root          | Derivatives                                                                  |
| ------------- | ---------------------------------------------------------------------------- |
| ك-ت-ب (k-t-b) | كَتَبَ write, كِتَاب book, كَاتِب writer, مَكْتَبَة library, مَكْتُوب letter |
| ع-ل-م (ʿ-l-m) | عَلِمَ know, عِلْم knowledge, عَالِم scholar, مَعْلُومَة information         |
| ر-و-ح (r-w-ḥ) | رَاحَ go, رُوح spirit, رِيح wind, مَرَاح departure                           |

One root → dozens of surface forms. A word-lookup like English SEMANTIC_FIELDS would need thousands of entries. Arabic needs a **root extractor first**.

### Arabic tokenizer design

```
Arabic text
    │
    ▼
Normalizer          → remove diacritics, normalize hamza/alef variants
    │
    ▼
Segmenter           → split clitics: و+كتب+ها → [و] [كتب] [ها]
    │
    ▼
Root Extractor      → كتب → k-t-b
    │
    ▼
SEMANTIC_FIELDS_AR  → { "ktb": "write", "ʿlm": "know", ... }  ← same structure
    │
    ▼
CSTToken[]          → same interface as English
    │
    ▼
HDC Encoder         → identical, language-agnostic
```

Arabic structural words map directly:

```ts
// STRUCTURAL_MAP_AR
"لا": "NEG", "لم": "NEG", "ما": "NEG",
"أين": "WHERE_Q", "متى": "WHEN_Q", "من": "WHO_Q",
"لماذا": "WHY_Q", "كيف": "HOW_Q", "هل": "QUERY",
"إذا": "COND", "لأن": "CAUSE", "سوف": "FUTURE", "كان": "PAST"
```

### What this means architecturally

The `CSTToken` interface is the **language boundary**. Everything below it (encoder, agent, gate, persistence) is 100% language-agnostic.

```
English tokenizer ─┐
                   ├─→ CSTToken[] ─→ HDC Encoder ─→ HDC Agent (same)
Arabic tokenizer  ─┘
```

You could run one agent that handles both languages in the same vector space — English "write" and Arabic كتب (k-t-b) would be bound to the same `CONCEPT:write` atom HV.

### Root extractor options (when ready)

| Option                       | Complexity               | Quality               |
| ---------------------------- | ------------------------ | --------------------- |
| Rule-based pattern stripping | Low — build it ourselves | Good for common roots |
| Farasa (Arabic NLP library)  | Medium — JS port or WASM | Production quality    |
| CAMEL Tools                  | High — Python only       | Best — skip for TS    |

**Recommendation:** start with a rule-based Arabic root extractor (300–400 common roots cover ~80% of everyday text) and expand from there. Same approach as English — misses fall to LIT → LLM → feedback.

---

## Other languages — later still

| Language                   | Approach                                                     |
| -------------------------- | ------------------------------------------------------------ |
| French / Spanish / Italian | Similar to English — vocabulary lookup + suffix rules        |
| German                     | Compound splitting needed ("Schreibtisch" = Schreib + Tisch) |
| Chinese / Japanese         | No spaces — character n-gram segmentation first              |
| Hebrew                     | Root-based like Arabic — same design applies                 |

The tokenizer is the only part that changes per language. The rest of nemo is universal.
