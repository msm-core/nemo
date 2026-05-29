import { randomHV, bind, bundle, similarity, DIM, makeRNG } from "../src/hdc";

describe("HDC primitives", () => {
  test("randomHV has correct dimension", () => {
    const hv = randomHV();
    expect(hv.length).toBe(DIM);
  });

  test("randomHV is bipolar {-1, +1}", () => {
    const hv = randomHV();
    for (let i = 0; i < hv.length; i++) {
      expect(Math.abs(hv[i])).toBe(1);
    }
  });

  test("bind is self-inverse: bind(bind(a,b), b) == a", () => {
    const rng = makeRNG(1);
    const a = randomHV(DIM, rng);
    const b = randomHV(DIM, rng);
    const roundtrip = bind(bind(a, b), b);
    let diff = 0;
    for (let i = 0; i < DIM; i++) diff += Math.abs(roundtrip[i] - a[i]);
    expect(diff).toBe(0);
  });

  test("bundle returns same-dimension vector", () => {
    const rng = makeRNG(2);
    const vs = Array.from({ length: 10 }, () => randomHV(DIM, rng));
    expect(bundle(vs).length).toBe(DIM);
  });

  test("bundle is bipolar", () => {
    const rng = makeRNG(3);
    const vs = Array.from({ length: 7 }, () => randomHV(DIM, rng));
    const b = bundle(vs);
    for (let i = 0; i < b.length; i++) expect(Math.abs(b[i])).toBe(1);
  });

  test("similarity with self ≈ 1", () => {
    const hv = randomHV(DIM, makeRNG(4));
    expect(similarity(hv, hv)).toBeCloseTo(1, 5);
  });

  test("two random HVs have low similarity", () => {
    const rng = makeRNG(5);
    const a = randomHV(DIM, rng);
    const b = randomHV(DIM, rng);
    expect(Math.abs(similarity(a, b))).toBeLessThan(0.1);
  });

  test("seeded RNG is deterministic", () => {
    const a = randomHV(DIM, makeRNG(42));
    const b = randomHV(DIM, makeRNG(42));
    let diff = 0;
    for (let i = 0; i < DIM; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBe(0);
  });
});
