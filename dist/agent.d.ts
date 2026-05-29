/**
 * agent.ts — HDCAgent: self-evolving semantic memory.
 *
 * Prototype state uses running sum (float64 accumulator) for exact bundle.
 * Accepts/rejects new HVs via per-field threshold θ = mean - 1.5·std.
 *
 * Persistence: agent.toJSON() / HDCAgent.fromJSON()
 */
export interface Episode {
    hv: number[];
    field: string;
    meta: Record<string, unknown>;
    sim: number;
}
export interface ClassifyResult {
    field: string;
    confidence: number;
    rawSim: number;
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
export declare class HDCAgent {
    readonly dim: number;
    private _sum;
    private _proto;
    private _n;
    private _theta;
    private _calSims;
    private _episodes;
    nObserved: number;
    nAccepted: number;
    nClassified: number;
    nCorrect: number;
    calibrated: boolean;
    constructor(dim?: number);
    private _accum;
    private _recalibrate;
    /** Unconditional accumulate during training/calibration. */
    observe(hv: Float32Array, field: string): void;
    /** Compute per-field thresholds. Call once after observe() phase. */
    calibrate(): Record<string, number>;
    /** Find nearest field prototype. O(n_fields). */
    classify(hv: Float32Array): ClassifyResult;
    /** Test coherence against a specific field. */
    verify(hv: Float32Array, field: string): [boolean, number];
    /**
     * Unconditional ground-truth update (call after LLM confirms the field).
     * Unlike update(), this bypasses the similarity threshold — it's always accepted.
     */
    feedback(hv: Float32Array, confirmedField: string, meta?: Record<string, unknown>): void;
    /** Conditional self-update: verify → accumulate → store episode. */
    update(hv: Float32Array, field: string, meta?: Record<string, unknown>): [boolean, number];
    /** Full agent loop: classify → update. */
    step(hv: Float32Array, meta?: Record<string, unknown>, groundTruth?: string): ClassifyResult;
    /** k-nearest episode retrieval (prototype-ranked when field not specified). */
    retrieve(queryHV: Float32Array, k?: number, field?: string): Episode[];
    get fields(): string[];
    get nFields(): number;
    get nEpisodes(): number;
    snapshot(): Record<string, unknown>;
    /** Serialise full agent state to a plain JSON-compatible object. */
    toJSON(): AgentState;
    /** Restore an agent from a state object produced by toJSON(). */
    static fromJSON(state: AgentState): HDCAgent;
}
//# sourceMappingURL=agent.d.ts.map