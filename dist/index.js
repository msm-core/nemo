"use strict";
/**
 * index.ts — nemo-ai public API.
 *
 * Full stack: text → CST tokens → ReasoningFrame → HV → classify → tool.
 *
 * GATE_HIGH = 0.55 → skip LLM
 * GATE_MED  = 0.35 → LLM assist
 * < 0.35          → full LLM
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GATE_MED = exports.GATE_HIGH = void 0;
exports.pipeline = pipeline;
__exportStar(require("./hdc"), exports);
__exportStar(require("./tokenizer"), exports);
__exportStar(require("./tokenizer-ar"), exports);
__exportStar(require("./encoder"), exports);
__exportStar(require("./agent"), exports);
__exportStar(require("./prep"), exports);
__exportStar(require("./persist"), exports);
__exportStar(require("./session"), exports);
const tokenizer_1 = require("./tokenizer");
const prep_1 = require("./prep");
// Gate constants and pipeline re-exported from session.ts
var session_1 = require("./session");
Object.defineProperty(exports, "GATE_HIGH", { enumerable: true, get: function () { return session_1.GATE_HIGH; } });
Object.defineProperty(exports, "GATE_MED", { enumerable: true, get: function () { return session_1.GATE_MED; } });
/**
 * Run the full nemo pipeline (stateless helper — for session-based use, prefer NemoSession).
 *
 * @param text    Raw English input.
 * @param agent   Trained HDCAgent.
 * @param encoder HDVEncoder (same seed as used during training).
 */
function pipeline(text, agent, encoder) {
    const { GATE_HIGH, GATE_MED } = require("./session");
    const tokens = (0, tokenizer_1.tokenize)(text);
    const frame = (0, prep_1.buildFrame)(text, tokens);
    const [hv] = encoder.encode(tokens);
    const classification = agent.classify(hv);
    const field = frame.confidencePrior >= GATE_HIGH
        ? frame.dominantField
        : classification.field;
    const tool = prep_1.FIELD_TOOL[field] ??
        prep_1.FIELD_TOOL[classification.field] ??
        "general_assistant";
    const gate = classification.confidence >= GATE_HIGH
        ? "skip_llm"
        : classification.confidence >= GATE_MED
            ? "llm_assist"
            : "full_llm";
    return { text, tokens, frame, classification, tool, gate };
}
//# sourceMappingURL=index.js.map