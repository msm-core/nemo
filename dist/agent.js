/**
 * agent.ts — HDCAgent: self-evolving semantic memory.
 *
 * Prototype state uses running sum (float64 accumulator) for exact bundle.
 * Accepts/rejects new HVs via per-field threshold θ = mean - 1.5·std.
 *
 * Persistence: agent.toJSON() / HDCAgent.fromJSON()
 */
import { similarity, DIM } from "./hdc.js";
export class HDCAgent {
    dim;
    _sum = new Map(); // running sum (f64)
    _proto = new Map(); // sign(_sum) (f32)
    _n = new Map();
    _theta = new Map();
    _calSims = new Map();
    _episodes = new Map();
    nObserved = 0;
    nAccepted = 0;
    nClassified = 0;
    nCorrect = 0;
    calibrated = false;
    constructor(dim = DIM) {
        this.dim = dim;
    }
    // ── Internal ────────────────────────────────────────────────────────────────
    _accum(field, hv) {
        let s = this._sum.get(field);
        if (!s) {
            s = new Float64Array(this.dim);
            this._sum.set(field, s);
            this._n.set(field, 0);
        }
        for (let i = 0; i < this.dim; i++)
            s[i] += hv[i];
        this._n.set(field, (this._n.get(field) ?? 0) + 1);
        // Recompute prototype: sign(sum), ties → +1
        const p = new Float32Array(this.dim);
        for (let i = 0; i < this.dim; i++)
            p[i] = s[i] >= 0 ? 1 : -1;
        this._proto.set(field, p);
    }
    _recalibrate(field) {
        const sims = this._calSims.get(field) ?? [];
        if (sims.length === 0) {
            this._theta.set(field, 0.01);
            return;
        }
        const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
        const std = Math.sqrt(sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length);
        this._theta.set(field, mean - 1.5 * std);
    }
    // ── Core API ────────────────────────────────────────────────────────────────
    /** Unconditional accumulate during training/calibration. */
    observe(hv, field) {
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
    calibrate() {
        for (const field of this._proto.keys())
            this._recalibrate(field);
        this.calibrated = true;
        const out = {};
        for (const [f, t] of this._theta)
            out[f] = t;
        return out;
    }
    /** Find nearest field prototype. O(n_fields). */
    classify(hv) {
        if (this._proto.size === 0) {
            return {
                field: "unknown",
                confidence: 0,
                rawSim: 0,
                accepted: false,
                top3: [],
            };
        }
        const scored = [];
        for (const [f, p] of this._proto)
            scored.push([f, similarity(hv, p)]);
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
    verify(hv, field) {
        const proto = this._proto.get(field);
        if (!proto)
            return [false, 0];
        const sim = similarity(hv, proto);
        const theta = this._theta.get(field) ?? 0.01;
        return [sim >= theta, sim];
    }
    /**
     * Unconditional ground-truth update (call after LLM confirms the field).
     * Unlike update(), this bypasses the similarity threshold — it's always accepted.
     */
    feedback(hv, confirmedField, meta = {}) {
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
    update(hv, field, meta = {}) {
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
    step(hv, meta = {}, groundTruth) {
        const result = this.classify(hv);
        const [accepted] = this.update(hv, result.field, meta);
        result.accepted = accepted;
        if (groundTruth && result.field === groundTruth)
            this.nCorrect++;
        return result;
    }
    /** k-nearest episode retrieval (prototype-ranked when field not specified). */
    retrieve(queryHV, k = 5, field) {
        if (this._episodes.size === 0)
            return [];
        if (field) {
            const eps = this._episodes.get(field) ?? [];
            return [...eps]
                .sort((a, b) => similarity(queryHV, new Float32Array(b.hv)) -
                similarity(queryHV, new Float32Array(a.hv)))
                .slice(0, k);
        }
        const protoRanked = [...this._proto.entries()]
            .filter(([f]) => this._episodes.has(f))
            .map(([f, p]) => [f, similarity(queryHV, p)])
            .sort((a, b) => b[1] - a[1])
            .slice(0, k);
        return protoRanked.map(([f]) => {
            const eps = this._episodes.get(f);
            return eps.reduce((best, e) => similarity(queryHV, new Float32Array(e.hv)) >
                similarity(queryHV, new Float32Array(best.hv))
                ? e
                : best);
        });
    }
    // ── Inspection ──────────────────────────────────────────────────────────────
    get fields() {
        return [...this._proto.keys()].sort();
    }
    get nFields() {
        return this._proto.size;
    }
    get nEpisodes() {
        let t = 0;
        for (const eps of this._episodes.values())
            t += eps.length;
        return t;
    }
    snapshot() {
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
    toJSON() {
        const sum = {};
        for (const [f, s] of this._sum)
            sum[f] = Array.from(s);
        const eps = {};
        for (const [f, e] of this._episodes)
            eps[f] = e;
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
    static fromJSON(state) {
        const agent = new HDCAgent(state.dim);
        agent.nObserved = state.nObserved;
        agent.nAccepted = state.nAccepted;
        agent.nClassified = state.nClassified;
        agent.nCorrect = state.nCorrect;
        agent.calibrated = state.calibrated;
        agent._n = new Map(Object.entries(state.n));
        agent._theta = new Map(Object.entries(state.theta));
        agent._calSims = new Map(Object.entries(state.calSims));
        agent._episodes = new Map(Object.entries(state.episodes).map(([f, eps]) => [f, eps]));
        for (const [field, arr] of Object.entries(state.sum)) {
            const s = new Float64Array(arr);
            agent._sum.set(field, s);
            const p = new Float32Array(state.dim);
            for (let i = 0; i < state.dim; i++)
                p[i] = s[i] >= 0 ? 1 : -1;
            agent._proto.set(field, p);
        }
        return agent;
    }
}
//# sourceMappingURL=agent.js.map