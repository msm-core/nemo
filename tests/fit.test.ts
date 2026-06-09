/**
 * fit.test.ts — discriminative (iterative) retraining.
 *
 * Verifies HDCAgent.fit() builds inter-class margin that a plain centroid
 * (observe-only) lacks: it never increases training error, drives well-separated
 * data to zero error, and reduces error on confusable (correlated) classes.
 */

import { HDCAgent } from "../src/agent";
import { randomHV, makeRNG } from "../src/hdc";

const DIM = 2000;

interface Ex {
  hv: Float32Array;
  field: string;
}

/** Flip a fraction of bits (deterministic via the provided rng). */
function noisy(base: Float32Array, flip: number, rng: () => number): Float32Array {
  const hv = new Float32Array(base);
  for (let i = 0; i < hv.length; i++) if (rng() < flip) hv[i] = -hv[i];
  return hv;
}

function trainErrors(agent: HDCAgent, ex: Ex[]): number {
  return ex.filter((e) => agent.classify(e.hv).field !== e.field).length;
}

describe("HDCAgent.fit — discriminative retraining", () => {
  it("drives well-separated data to zero training error and converges", () => {
    const rng = makeRNG(7);
    const bases = Array.from({ length: 6 }, () => randomHV(DIM, rng));
    const ex: Ex[] = [];
    for (let f = 0; f < bases.length; f++)
      for (let k = 0; k < 15; k++) ex.push({ hv: noisy(bases[f], 0.12, rng), field: "f" + f });

    const agent = new HDCAgent(DIM);
    for (const { hv, field } of ex) agent.observe(hv, field);

    const info = agent.fit(ex, { epochs: 30 });
    expect(info.finalErrors).toBe(0);
    expect(trainErrors(agent, ex)).toBe(0);
  });

  it("never increases training error and reduces it on confusable classes", () => {
    const rng = makeRNG(99);
    // Correlated classes: a shared global base with only a small unique tweak
    // per field → centroids cluster and confuse each other.
    const global = randomHV(DIM, rng);
    const bases = Array.from({ length: 5 }, () => noisy(global, 0.1, rng));
    const ex: Ex[] = [];
    for (let f = 0; f < bases.length; f++)
      for (let k = 0; k < 20; k++) ex.push({ hv: noisy(bases[f], 0.15, rng), field: "f" + f });

    const agent = new HDCAgent(DIM);
    for (const { hv, field } of ex) agent.observe(hv, field);

    const before = trainErrors(agent, ex);
    agent.fit(ex, { epochs: 40 });
    const after = trainErrors(agent, ex);

    expect(after).toBeLessThanOrEqual(before);
    if (before > 0) expect(after).toBeLessThan(before);
  });
});
