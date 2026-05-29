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
import { CSTToken } from "./tokenizer";
import { ReasoningFrame } from "./prep";
import { ClassifyResult } from "./agent";

// ── Shared types (also re-exported from index.ts) ────────────────────────────

export const GATE_HIGH = 0.55;
export const GATE_MED = 0.35;

export type GateDecision = "skip_llm" | "llm_assist" | "full_llm";

export interface PipelineResult {
  text: string;
  tokens: CSTToken[];
  frame: ReasoningFrame;
  classification: ClassifyResult;
  tool: string;
  gate: GateDecision;
}

// ── Session types ────────────────────────────────────────────────────────────

/** A tool function receives the raw text and full pipeline result. */
export type ToolFn = (
  input: string,
  result: PipelineResult,
) => Promise<string> | string;
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

// ── NemoSession ──────────────────────────────────────────────────────────────

export class NemoSession {
  readonly agent: HDCAgent;
  readonly encoder: HDVEncoder;
  readonly tools: ToolMap;

  private _filePath?: string;
  private _autoEvery: number;
  private _runCount = 0;

  constructor(opts: SessionOptions) {
    this.agent = opts.agent;
    this.encoder = opts.encoder;
    this.tools = opts.tools ?? {};
    this._filePath = opts.filePath;
    this._autoEvery = opts.autoSaveEvery ?? 0;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  /** Load a persisted session. Optionally attach tools (functions aren't serialised). */
  static load(
    filePath: string,
    opts: { tools?: ToolMap; autoSaveEvery?: number } = {},
  ): NemoSession {
    const { agent, encoder } = loadFromFile(filePath);
    return new NemoSession({ agent, encoder, filePath, ...opts });
  }

  // ── Core ───────────────────────────────────────────────────────────────────

  /**
   * Process one user utterance through the full pipeline.
   * If gate === "skip_llm" and a matching tool is registered, calls it.
   */
  async run(text: string): Promise<SessionResult> {
    const tokens = tokenize(text);
    const frame = buildFrame(text, tokens);
    const [hv] = this.encoder.encode(tokens);
    const classification = this.agent.classify(hv);

    const field =
      frame.confidencePrior >= GATE_HIGH
        ? frame.dominantField
        : classification.field;

    const tool: string =
      FIELD_TOOL[field] ??
      FIELD_TOOL[classification.field] ??
      "general_assistant";

    const gate: GateDecision =
      classification.confidence >= GATE_HIGH
        ? "skip_llm"
        : classification.confidence >= GATE_MED
          ? "llm_assist"
          : "full_llm";

    const base: PipelineResult = {
      text,
      tokens,
      frame,
      classification,
      tool,
      gate,
    };

    let response: string | undefined;
    if (gate === "skip_llm" && tool in this.tools) {
      response = await this.tools[tool](text, base);
    }

    if (this._autoEvery > 0) {
      this._runCount++;
      if (this._runCount % this._autoEvery === 0) this.save();
    }

    return { ...base, response };
  }

  /**
   * Teach the agent from a confirmed ground-truth field (e.g. after LLM answers).
   * Encodes `text` and calls agent.feedback(hv, confirmedField, meta).
   * Next time the same/similar input arrives → confidence rises → skip_llm.
   */
  teach(
    text: string,
    confirmedField: string,
    meta: Record<string, unknown> = {},
  ): void {
    const tokens = tokenize(text);
    const [hv] = this.encoder.encode(tokens);
    this.agent.feedback(hv, confirmedField, { text, ...meta });
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /** Save agent + encoder state to file. */
  save(filePath?: string): void {
    const fp = filePath ?? this._filePath;
    if (!fp)
      throw new Error(
        "No filePath — pass one to save() or use NemoSession.load()",
      );
    saveToFile(fp, this.agent, this.encoder);
  }
}
