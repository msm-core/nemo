/**
 * agent.ts — HDCAgent: self-evolving semantic memory.
 *
 * Prototype state uses running sum (float64 accumulator) for exact bundle.
 * Accepts/rejects new HVs via per-field threshold θ = mean - 1.5·std.
 *
 * Persistence: agent.toJSON() / HDCAgent.fromJSON()
 */

import { similarity, bundle, DIM } from "./hdc";

export interface Episode {
  hv: number[]; // Float32 stored as plain array for JSON
  field: string;
  meta: Record<string, unknown>;
  sim: number;
}

export interface ClassifyResult {
  field: string;
  confidence: number; // tanh-scaled ∈ (0, 1)
  rawSim: number; // raw cosine similarity
  accepted: boolean;
  top3: Array<[string, number]>;
}

/** Serialisable snapshot of agent state (used by toJSON / fromJSON). */
export interface AgentState {
  dim: number;
  nObserved: number;
  nAccepted: number;
  nClassified: number;
  nCorrect: number;
  calibrated: boolean;
  sum: Record<string, number[]>;
  n: Record<string, number>;
  theta: Record<string, number>;
  calSims: Record<string, number[]>;
  episodes: Record<string, Episode[]>;
}

export class HDCAgent {
  readonly dim: number;

  private _sum: Map<string, Float64Array> = new Map(); // running sum (f64)
  private _proto: Map<string, Float32Array> = new Map(); // sign(_sum) (f32)
  private _n: Map<string, number> = new Map();
  private _theta: Map<string, number> = new Map();
  private _calSims: Map<string, number[]> = new Map();
  private _episodes: Map<string, Episode[]> = new Map();

  nObserved = 0;
  nAccepted = 0;
  nClassified = 0;
  nCorrect = 0;
  calibrated = false;

  constructor(dim: number = DIM) {
    this.dim = dim;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _accum(field: string, hv: Float32Array): void {
    let s = this._sum.get(field);
    if (!s) {
      s = new Float64Array(this.dim);
      this._sum.set(field, s);
      this._n.set(field, 0);
    }
    for (let i = 0; i < this.dim; i++) s[i] += hv[i];
    this._n.set(field, (this._n.get(field) ?? 0) + 1);

    // Recompute prototype: sign(sum), ties → +1
    const p = new Float32Array(this.dim);
    for (let i = 0; i < this.dim; i++) p[i] = s[i] >= 0 ? 1 : -1;
    this._proto.set(field, p);
  }

  private _recalibrate(field: string): void {
    const sims = this._calSims.get(field) ?? [];
    if (sims.length === 0) {
      this._theta.set(field, 0.01);
      return;
    }
    const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
    const std = Math.sqrt(
      sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length,
    );
    this._theta.set(field, mean - 1.5 * std);
  }

  // ── Core API ────────────────────────────────────────────────────────────────

  /** Unconditional accumulate during training/calibration. */
  observe(hv: Float32Array, field: string): void {
    const proto = this._proto.get(field);
    if (proto) {
      const s = similarity(hv, proto);
      const arr = this._calSims.get(field) ?? [];
      arr.push(s);
      this._calSims.set(field, arr);
    }
    this._accum(field, hv);
    this.nObserved++;
  }

  /** Compute per-field thresholds. Call once after observe() phase. */
  calibrate(): Record<string, number> {
    for (const field of this._proto.keys()) this._recalibrate(field);
    this.calibrated = true;
    const out: Record<string, number> = {};
    for (const [f, t] of this._theta) out[f] = t;
    return out;
  }

  /** Find nearest field prototype. O(n_fields). */
  classify(hv: Float32Array): ClassifyResult {
    if (this._proto.size === 0) {
      return {
        field: "unknown",
        confidence: 0,
        rawSim: 0,
        accepted: false,
        top3: [],
      };
    }
    const scored: Array<[string, number]> = [];
    for (const [f, p] of this._proto) scored.push([f, similarity(hv, p)]);
    scored.sort((a, b) => b[1] - a[1]);
    const [topField, topSim] = scored[0];
    const confidence = Math.tanh(2.5 * Math.max(0, topSim));
    this.nClassified++;
    return {
      field: topField,
      confidence,
      rawSim: topSim,
      accepted: false,
      top3: scored.slice(0, 3),
    };
  }

  /** Test coherence against a specific field. */
  verify(hv: Float32Array, field: string): [boolean, number] {
    const proto = this._proto.get(field);
    if (!proto) return [false, 0];
    const sim = similarity(hv, proto);
    const theta = this._theta.get(field) ?? 0.01;
    return [sim >= theta, sim];
  }

  /**
   * Unconditional ground-truth update (call after LLM confirms the field).
   * Unlike update(), this bypasses the similarity threshold — it's always accepted.
   */
  feedback(
    hv: Float32Array,
    confirmedField: string,
    meta: Record<string, unknown> = {},
  ): void {
    this._accum(confirmedField, hv);
    const proto = this._proto.get(confirmedField);
    const sim = proto ? similarity(hv, proto) : 1.0;
    const arr = this._calSims.get(confirmedField) ?? [];
    arr.push(sim);
    this._calSims.set(confirmedField, arr);
    this._recalibrate(confirmedField);
    const eps = this._episodes.get(confirmedField) ?? [];
    eps.push({ hv: Array.from(hv), field: confirmedField, meta, sim });
    this._episodes.set(confirmedField, eps);
    this.nAccepted++;
  }

  /** Conditional self-update: verify → accumulate → store episode. */
  update(
    hv: Float32Array,
    field: string,
    meta: Record<string, unknown> = {},
  ): [boolean, number] {
    const [accepted, sim] = this.verify(hv, field);
    if (accepted) {
      this._accum(field, hv);
      const arr = this._calSims.get(field) ?? [];
      arr.push(sim);
      this._calSims.set(field, arr);
      this._recalibrate(field);
      const eps = this._episodes.get(field) ?? [];
      eps.push({ hv: Array.from(hv), field, meta, sim });
      this._episodes.set(field, eps);
      this.nAccepted++;
    }
    return [accepted, sim];
  }

  /** Full agent loop: classify → update. */
  step(
    hv: Float32Array,
    meta: Record<string, unknown> = {},
    groundTruth?: string,
  ): ClassifyResult {
    const result = this.classify(hv);
    const [accepted] = this.update(hv, result.field, meta);
    result.accepted = accepted;
    if (groundTruth && result.field === groundTruth) this.nCorrect++;
    return result;
  }

  /** k-nearest episode retrieval (prototype-ranked when field not specified). */
  retrieve(queryHV: Float32Array, k = 5, field?: string): Episode[] {
    if (this._episodes.size === 0) return [];
    if (field) {
      const eps = this._episodes.get(field) ?? [];
      return [...eps]
        .sort(
          (a, b) =>
            similarity(queryHV, new Float32Array(b.hv)) -
            similarity(queryHV, new Float32Array(a.hv)),
        )
        .slice(0, k);
    }
    const protoRanked = [...this._proto.entries()]
      .filter(([f]) => this._episodes.has(f))
      .map(([f, p]) => [f, similarity(queryHV, p)] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);

    return protoRanked.map(([f]) => {
      const eps = this._episodes.get(f)!;
      return eps.reduce((best, e) =>
        similarity(queryHV, new Float32Array(e.hv)) >
        similarity(queryHV, new Float32Array(best.hv))
          ? e
          : best,
      );
    });
  }

  // ── Inspection ──────────────────────────────────────────────────────────────

  get fields(): string[] {
    return [...this._proto.keys()].sort();
  }
  get nFields(): number {
    return this._proto.size;
  }
  get nEpisodes(): number {
    let t = 0;
    for (const eps of this._episodes.values()) t += eps.length;
    return t;
  }
  snapshot(): Record<string, unknown> {
    return {
      nFields: this.nFields,
      nObserved: this.nObserved,
      nClassified: this.nClassified,
      nAccepted: this.nAccepted,
      nEpisodes: this.nEpisodes,
      fields: this.fields,
    };
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  /** Serialise full agent state to a plain JSON-compatible object. */
  toJSON(): AgentState {
    const sum: Record<string, number[]> = {};
    for (const [f, s] of this._sum) sum[f] = Array.from(s);
    const eps: Record<string, Episode[]> = {};
    for (const [f, e] of this._episodes) eps[f] = e;
    return {
      dim: this.dim,
      nObserved: this.nObserved,
      nAccepted: this.nAccepted,
      nClassified: this.nClassified,
      nCorrect: this.nCorrect,
      calibrated: this.calibrated,
      sum,
      n: Object.fromEntries(this._n),
      theta: Object.fromEntries(this._theta),
      calSims: Object.fromEntries(this._calSims),
      episodes: eps,
    };
  }

  /** Restore an agent from a state object produced by toJSON(). */
  static fromJSON(state: AgentState): HDCAgent {
    const agent = new HDCAgent(state.dim);
    agent.nObserved = state.nObserved;
    agent.nAccepted = state.nAccepted;
    agent.nClassified = state.nClassified;
    agent.nCorrect = state.nCorrect;
    agent.calibrated = state.calibrated;
    agent._n = new Map(Object.entries(state.n));
    agent._theta = new Map(Object.entries(state.theta));
    agent._calSims = new Map(Object.entries(state.calSims));
    agent._episodes = new Map(
      Object.entries(state.episodes).map(([f, eps]) => [f, eps]),
    );
    for (const [field, arr] of Object.entries(state.sum)) {
      const s = new Float64Array(arr);
      agent._sum.set(field, s);
      const p = new Float32Array(state.dim);
      for (let i = 0; i < state.dim; i++) p[i] = s[i] >= 0 ? 1 : -1;
      agent._proto.set(field, p);
    }
    return agent;
  }
}
