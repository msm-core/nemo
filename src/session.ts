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
import { tokenize, NemoToken } from "./tokenizer";
import { buildFrame, FIELD_TOOL } from "./prep";
import { saveToFile, loadFromFile } from "./persist";
import { ReasoningFrame } from "./prep";
import { ClassifyResult } from "./agent";

// ── Shared types (also re-exported from index.ts) ────────────────────────────

export const GATE_HIGH = 0.55;
export const GATE_MED = 0.35;

export type GateDecision = "skip_llm" | "llm_assist" | "full_llm";

export interface PipelineResult {
  text: string;
  tokens: NemoToken[];
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

// ── NemoSession ──────────────────────────────────────────────────────────────

export class NemoSession {
  readonly agent: HDCAgent;
  readonly encoder: HDVEncoder;
  readonly tools: ToolMap;

  private _filePath?: string;
  private _autoEvery: number;
  private _teachCount = 0;

  constructor(opts: SessionOptions) {
    this.agent = opts.agent;
    this.encoder = opts.encoder;
    this.tools = opts.tools ?? {};
    this._filePath = opts.filePath;
    // Default: auto-save every 100 teach() calls when a filePath is configured
    this._autoEvery = opts.autoSaveEvery ?? (opts.filePath ? 100 : 0);

    // Shutdown hook: flush to disk on SIGTERM / SIGINT (Node.js only)
    const enableHook = opts.shutdownHook ?? !!opts.filePath;
    if (
      enableHook &&
      typeof process !== "undefined" &&
      typeof (process as NodeJS.Process).once === "function"
    ) {
      const onExit = () => {
        try {
          this.save();
        } catch {
          /* best effort — never throw on exit */
        }
      };
      process.once("SIGTERM", onExit);
      process.once("SIGINT", onExit);
    }
  }

  // ── Factories ──────────────────────────────────────────────────────────────

  /** Load a persisted session. Optionally attach tools (functions aren't serialised). */
  static load(
    filePath: string,
    opts: {
      tools?: ToolMap;
      autoSaveEvery?: number;
      shutdownHook?: boolean;
    } = {},
  ): NemoSession {
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
  static loadOrCreate(
    filePath: string,
    opts: {
      tools?: ToolMap;
      autoSaveEvery?: number;
      shutdownHook?: boolean;
    } = {},
  ): NemoSession {
    try {
      return NemoSession.load(filePath, opts);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
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
    // Auto-save after N teach() calls (state changes only happen here, not in run())
    if (this._autoEvery > 0) {
      this._teachCount++;
      if (this._teachCount % this._autoEvery === 0) {
        try {
          this.save();
        } catch {
          /* non-fatal */
        }
      }
    }
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
