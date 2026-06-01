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
import { NemoToken } from "./tokenizer";
import { ReasoningFrame } from "./prep";
import { ClassifyResult } from "./agent";
export declare const GATE_HIGH = 0.55;
export declare const GATE_MED = 0.35;
export type GateDecision = "skip_llm" | "llm_assist" | "full_llm";
export interface PipelineResult {
    text: string;
    tokens: NemoToken[];
    frame: ReasoningFrame;
    classification: ClassifyResult;
    tool: string;
    gate: GateDecision;
}
/** A tool function receives the raw text and full pipeline result. */
export type ToolFn = (input: string, result: PipelineResult) => Promise<string> | string;
export type ToolMap = Record<string, ToolFn>;
export interface SessionResult extends PipelineResult {
    /** Present only when gate === "skip_llm" and a matching tool was registered. */
    response?: string;
}
export interface SessionOptions {
    agent: HDCAgent;
    encoder: HDVEncoder;
    tools?: ToolMap;
    /** Path to persist state. Required for save() / auto-save. */
    filePath?: string;
    /**
     * Auto-save every N teach() calls — teach() is when HDC state actually changes.
     * Defaults to 100 when filePath is provided, 0 (disabled) otherwise.
     * Set to 0 to disable and manage saves manually.
     */
    autoSaveEvery?: number;
    /**
     * Register SIGTERM / SIGINT handlers to flush state to disk on process exit.
     * Node.js only — silently ignored in browser environments.
     * Defaults to true when filePath is provided.
     * Set to false when the adapter layer manages shutdown saves instead.
     */
    shutdownHook?: boolean;
}
export declare class NemoSession {
    readonly agent: HDCAgent;
    readonly encoder: HDVEncoder;
    readonly tools: ToolMap;
    private _filePath?;
    private _autoEvery;
    private _teachCount;
    constructor(opts: SessionOptions);
    /** Load a persisted session. Optionally attach tools (functions aren't serialised). */
    static load(filePath: string, opts?: {
        tools?: ToolMap;
        autoSaveEvery?: number;
        shutdownHook?: boolean;
    }): NemoSession;
    /**
     * Load a persisted session if the file exists, otherwise start fresh.
     * The simplest way to initialise nemo — works on first run and every restart.
     *
     * @example
     *   const session = NemoSession.loadOrCreate("./.nemo.json");
     *   // auto-saves every 100 teach() calls and on SIGTERM — zero config needed
     */
    static loadOrCreate(filePath: string, opts?: {
        tools?: ToolMap;
        autoSaveEvery?: number;
        shutdownHook?: boolean;
    }): NemoSession;
    /**
     * Process one user utterance through the full pipeline.
     * If gate === "skip_llm" and a matching tool is registered, calls it.
     */
    run(text: string): Promise<SessionResult>;
    /**
     * Teach the agent from a confirmed ground-truth field (e.g. after LLM answers).
     * Encodes `text` and calls agent.feedback(hv, confirmedField, meta).
     * Next time the same/similar input arrives → confidence rises → skip_llm.
     */
    teach(text: string, confirmedField: string, meta?: Record<string, unknown>): void;
    /** Save agent + encoder state to file. */
    save(filePath?: string): void;
}
//# sourceMappingURL=session.d.ts.map