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

import { tokenize } from "./tokenizer";
import { HDVEncoder } from "./encoder";
import { HDCAgent, ClassifyResult } from "./agent";
import { buildFrame, FIELD_TOOL, ReasoningFrame } from "./prep";
import { GATE_HIGH, GATE_MED } from "./session";

// Gate constants and pipeline re-exported from session.ts
export { GATE_HIGH, GATE_MED } from "./session";
export type {
  GateDecision,
  PipelineResult,
  SessionResult,
  ToolFn,
  ToolMap,
} from "./session";

/**
 * Run the full nemo pipeline (stateless helper — for session-based use, prefer NemoSession).
 *
 * @param text    Raw English input.
 * @param agent   Trained HDCAgent.
 * @param encoder HDVEncoder (same seed as used during training).
 */
export function pipeline(
  text: string,
  agent: HDCAgent,
  encoder: HDVEncoder,
): import("./session").PipelineResult {
  const tokens = tokenize(text);
  const frame = buildFrame(text, tokens);
  const [hv] = encoder.encode(tokens);
  const classification = agent.classify(hv);

  const field =
    frame.confidencePrior >= GATE_HIGH
      ? frame.dominantField
      : classification.field;

  const tool =
    FIELD_TOOL[field] ??
    FIELD_TOOL[classification.field] ??
    "general_assistant";

  const gate: import("./session").GateDecision =
    classification.confidence >= GATE_HIGH
      ? "skip_llm"
      : classification.confidence >= GATE_MED
        ? "llm_assist"
        : "full_llm";

  return { text, tokens, frame, classification, tool, gate };
}
