/**
 * index.ts — nemo-ai public API.
 *
 * Full stack: text → CST tokens → ReasoningFrame → HV → classify → tool.
 *
 * GATE_HIGH = 0.55 → skip LLM
 * GATE_MED  = 0.35 → LLM assist
 * < 0.35          → full LLM
 */
export * from "./hdc";
export * from "./tokenizer";
export * from "./encoder";
export * from "./agent";
export * from "./prep";
export * from "./persist";
export * from "./session";
import { HDVEncoder } from "./encoder";
import { HDCAgent } from "./agent";
export { GATE_HIGH, GATE_MED } from "./session";
export type { GateDecision, PipelineResult, SessionResult, ToolFn, ToolMap, } from "./session";
/**
 * Run the full nemo pipeline (stateless helper — for session-based use, prefer NemoSession).
 *
 * @param text    Raw English input.
 * @param agent   Trained HDCAgent.
 * @param encoder HDVEncoder (same seed as used during training).
 */
export declare function pipeline(text: string, agent: HDCAgent, encoder: HDVEncoder): import("./session").PipelineResult;
/**
 * Run the full nemo pipeline for Arabic input (stateless helper).
 *
 * @param text    Raw Arabic input.
 * @param agent   Trained HDCAgent.
 * @param encoder HDVEncoder (same seed as used during training).
 */
export declare function pipelineAr(text: string, agent: HDCAgent, encoder: HDVEncoder): import("./session").PipelineResult;
//# sourceMappingURL=index.d.ts.map