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
import { CSTToken } from "./tokenizer";
import { ReasoningFrame } from "./prep";
import { ClassifyResult } from "./agent";
export declare const GATE_HIGH = 0.55;
export declare const GATE_MED = 0.35;
export type GateDecision = "skip_llm" | "llm_assist" | "full_llm";
export interface PipelineResult {
    text: string;
    tokens: CSTToken[];
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
    /** Auto-save every N run() calls (0 = disabled). */
    autoSaveEvery?: number;
}
export declare class NemoSession {
    readonly agent: HDCAgent;
    readonly encoder: HDVEncoder;
    readonly tools: ToolMap;
    private _filePath?;
    private _autoEvery;
    private _runCount;
    constructor(opts: SessionOptions);
    /** Load a persisted session. Optionally attach tools (functions aren't serialised). */
    static load(filePath: string, opts?: {
        tools?: ToolMap;
        autoSaveEvery?: number;
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