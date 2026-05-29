"use strict";
/**
 * session.ts — NemoSession: single entry point for production use.
 *
 * Wraps HDCAgent + HDVEncoder + tool registry + auto-persistence.
 *
 * Usage:
 *   // From saved file:
 *   const session = NemoSession.load("./memory.nemo.json", { tools })
 *   const result  = await session.run("find recipe for pasta")
 *   session.save()
 *
 *   // From scratch:
 *   const session = new NemoSession({ agent, encoder, tools, filePath: "./memory.nemo.json" })
 *   await session.run("...")
 *   // After LLM confirms field:
 *   session.teach("find recipe for pasta", "food", { llmAnswer: "..." })
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NemoSession = exports.GATE_MED = exports.GATE_HIGH = void 0;
const tokenizer_1 = require("./tokenizer");
const prep_1 = require("./prep");
const persist_1 = require("./persist");
// ── Shared types (also re-exported from index.ts) ────────────────────────────
exports.GATE_HIGH = 0.55;
exports.GATE_MED = 0.35;
// ── NemoSession ──────────────────────────────────────────────────────────────
class NemoSession {
    agent;
    encoder;
    tools;
    _filePath;
    _autoEvery;
    _runCount = 0;
    constructor(opts) {
        this.agent = opts.agent;
        this.encoder = opts.encoder;
        this.tools = opts.tools ?? {};
        this._filePath = opts.filePath;
        this._autoEvery = opts.autoSaveEvery ?? 0;
    }
    // ── Factory ────────────────────────────────────────────────────────────────
    /** Load a persisted session. Optionally attach tools (functions aren't serialised). */
    static load(filePath, opts = {}) {
        const { agent, encoder } = (0, persist_1.loadFromFile)(filePath);
        return new NemoSession({ agent, encoder, filePath, ...opts });
    }
    // ── Core ───────────────────────────────────────────────────────────────────
    /**
     * Process one user utterance through the full pipeline.
     * If gate === "skip_llm" and a matching tool is registered, calls it.
     */
    async run(text) {
        const tokens = (0, tokenizer_1.tokenize)(text);
        const frame = (0, prep_1.buildFrame)(text, tokens);
        const [hv] = this.encoder.encode(tokens);
        const classification = this.agent.classify(hv);
        const field = frame.confidencePrior >= exports.GATE_HIGH
            ? frame.dominantField
            : classification.field;
        const tool = prep_1.FIELD_TOOL[field] ??
            prep_1.FIELD_TOOL[classification.field] ??
            "general_assistant";
        const gate = classification.confidence >= exports.GATE_HIGH
            ? "skip_llm"
            : classification.confidence >= exports.GATE_MED
                ? "llm_assist"
                : "full_llm";
        const base = {
            text,
            tokens,
            frame,
            classification,
            tool,
            gate,
        };
        let response;
        if (gate === "skip_llm" && tool in this.tools) {
            response = await this.tools[tool](text, base);
        }
        if (this._autoEvery > 0) {
            this._runCount++;
            if (this._runCount % this._autoEvery === 0)
                this.save();
        }
        return { ...base, response };
    }
    /**
     * Teach the agent from a confirmed ground-truth field (e.g. after LLM answers).
     * Encodes `text` and calls agent.feedback(hv, confirmedField, meta).
     * Next time the same/similar input arrives → confidence rises → skip_llm.
     */
    teach(text, confirmedField, meta = {}) {
        const tokens = (0, tokenizer_1.tokenize)(text);
        const [hv] = this.encoder.encode(tokens);
        this.agent.feedback(hv, confirmedField, { text, ...meta });
    }
    // ── Persistence ────────────────────────────────────────────────────────────
    /** Save agent + encoder state to file. */
    save(filePath) {
        const fp = filePath ?? this._filePath;
        if (!fp)
            throw new Error("No filePath — pass one to save() or use NemoSession.load()");
        (0, persist_1.saveToFile)(fp, this.agent, this.encoder);
    }
}
exports.NemoSession = NemoSession;
//# sourceMappingURL=session.js.map