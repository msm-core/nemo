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
import { HDCAgent } from "./agent";
import { HDVEncoder } from "./encoder";
import { tokenize } from "./tokenizer";
import { buildFrame, FIELD_TOOL } from "./prep";
import { saveToFile, loadFromFile } from "./persist";
// ── Shared types (also re-exported from index.ts) ────────────────────────────
export const GATE_HIGH = 0.55;
export const GATE_MED = 0.35;
// ── NemoSession ──────────────────────────────────────────────────────────────
export class NemoSession {
    agent;
    encoder;
    tools;
    _filePath;
    _autoEvery;
    _teachCount = 0;
    constructor(opts) {
        this.agent = opts.agent;
        this.encoder = opts.encoder;
        this.tools = opts.tools ?? {};
        this._filePath = opts.filePath;
        // Default: auto-save every 100 teach() calls when a filePath is configured
        this._autoEvery = opts.autoSaveEvery ?? (opts.filePath ? 100 : 0);
        // Shutdown hook: flush to disk on SIGTERM / SIGINT (Node.js only)
        const enableHook = opts.shutdownHook ?? !!opts.filePath;
        if (enableHook &&
            typeof process !== "undefined" &&
            typeof process.once === "function") {
            const onExit = () => {
                try {
                    this.save();
                }
                catch {
                    /* best effort — never throw on exit */
                }
            };
            process.once("SIGTERM", onExit);
            process.once("SIGINT", onExit);
        }
    }
    // ── Factories ──────────────────────────────────────────────────────────────
    /** Load a persisted session. Optionally attach tools (functions aren't serialised). */
    static load(filePath, opts = {}) {
        const { agent, encoder } = loadFromFile(filePath);
        return new NemoSession({ agent, encoder, filePath, ...opts });
    }
    /**
     * Load a persisted session if the file exists, otherwise start fresh.
     * The simplest way to initialise nemo — works on first run and every restart.
     *
     * @example
     *   const session = NemoSession.loadOrCreate("./.nemo.json");
     *   // auto-saves every 100 teach() calls and on SIGTERM — zero config needed
     */
    static loadOrCreate(filePath, opts = {}) {
        try {
            return NemoSession.load(filePath, opts);
        }
        catch (e) {
            if (e.code === "ENOENT") {
                const agent = new HDCAgent();
                const encoder = new HDVEncoder();
                return new NemoSession({ agent, encoder, filePath, ...opts });
            }
            throw e;
        }
    }
    // ── Core ───────────────────────────────────────────────────────────────────
    /**
     * Process one user utterance through the full pipeline.
     * If gate === "skip_llm" and a matching tool is registered, calls it.
     */
    async run(text) {
        const tokens = tokenize(text);
        const frame = buildFrame(text, tokens);
        const [hv] = this.encoder.encode(tokens);
        const classification = this.agent.classify(hv);
        const field = frame.confidencePrior >= GATE_HIGH
            ? frame.dominantField
            : classification.field;
        const tool = FIELD_TOOL[field] ??
            FIELD_TOOL[classification.field] ??
            "general_assistant";
        const gate = classification.confidence >= GATE_HIGH
            ? "skip_llm"
            : classification.confidence >= GATE_MED
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
        return { ...base, response };
    }
    /**
     * Teach the agent from a confirmed ground-truth field (e.g. after LLM answers).
     * Encodes `text` and calls agent.feedback(hv, confirmedField, meta).
     * Next time the same/similar input arrives → confidence rises → skip_llm.
     */
    teach(text, confirmedField, meta = {}) {
        const tokens = tokenize(text);
        const [hv] = this.encoder.encode(tokens);
        this.agent.feedback(hv, confirmedField, { text, ...meta });
        // Auto-save after N teach() calls (state changes only happen here, not in run())
        if (this._autoEvery > 0) {
            this._teachCount++;
            if (this._teachCount % this._autoEvery === 0) {
                try {
                    this.save();
                }
                catch {
                    /* non-fatal */
                }
            }
        }
    }
    // ── Persistence ────────────────────────────────────────────────────────────
    /** Save agent + encoder state to file. */
    save(filePath) {
        const fp = filePath ?? this._filePath;
        if (!fp)
            throw new Error("No filePath — pass one to save() or use NemoSession.load()");
        saveToFile(fp, this.agent, this.encoder);
    }
}
