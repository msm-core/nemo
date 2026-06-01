/**
 * index.ts — nemo-ai public API.
 *
 * Full stack: text → CST tokens → ReasoningFrame → HV → classify → tool.
 *
 * GATE_HIGH = 0.55 → skip LLM
 * GATE_MED  = 0.35 → LLM assist
 * < 0.35          → full LLM
 */
export * from "./hdc.js";
export * from "./tokenizer.js";
export * from "./encoder.js";
export * from "./agent.js";
export * from "./prep.js";
export * from "./persist.js";
export * from "./session.js";
import { tokenize, tokenizeAr } from "./tokenizer.js";
import { buildFrame, FIELD_TOOL } from "./prep.js";
import { GATE_HIGH, GATE_MED } from "./session.js";
// Gate constants and pipeline re-exported from session.ts
export { GATE_HIGH, GATE_MED } from "./session.js";
/**
 * Run the full nemo pipeline (stateless helper — for session-based use, prefer NemoSession).
 *
 * @param text    Raw English input.
 * @param agent   Trained HDCAgent.
 * @param encoder HDVEncoder (same seed as used during training).
 */
export function pipeline(text, agent, encoder) {
    const tokens = tokenize(text);
    const frame = buildFrame(text, tokens);
    const [hv] = encoder.encode(tokens);
    const classification = agent.classify(hv);
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
    return { text, tokens, frame, classification, tool, gate };
}
/**
 * Run the full nemo pipeline for Arabic input (stateless helper).
 *
 * @param text    Raw Arabic input.
 * @param agent   Trained HDCAgent.
 * @param encoder HDVEncoder (same seed as used during training).
 */
export function pipelineAr(text, agent, encoder) {
    const tokens = tokenizeAr(text);
    const frame = buildFrame(text, tokens);
    const [hv] = encoder.encode(tokens);
    const classification = agent.classify(hv);
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
    return { text, tokens, frame, classification, tool, gate };
}
//# sourceMappingURL=index.js.map