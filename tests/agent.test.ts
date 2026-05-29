import { HDCAgent } from "../src/agent";
import { HDVEncoder } from "../src/encoder";
import { tokenize } from "../src/tokenizer";

const DIM = 1000; // smaller for tests — faster

function makeEncoder() { return new HDVEncoder(DIM, 42); }
function makeAgent()   { return new HDCAgent(DIM); }

function hvFor(text: string, enc: HDVEncoder): Float32Array {
  const [hv] = enc.encode(tokenize(text));
  return hv;
}

function trainAgent(agent: HDCAgent, enc: HDVEncoder): void {
  const techPhrases = [
    "write code", "fix bug", "debug error", "python script", "software system",
  ];
  const weatherPhrases = [
    "weather forecast", "rain tomorrow", "temperature today", "snow storm", "wind speed",
  ];
  for (const p of techPhrases)    agent.observe(hvFor(p, enc), "tech");
  for (const p of weatherPhrases) agent.observe(hvFor(p, enc), "weather");
  agent.calibrate();
}

describe("HDVEncoder", () => {
  test("encode returns Float32Array of correct dim", () => {
    const enc = makeEncoder();
    const [hv] = enc.encode(tokenize("write code"));
    expect(hv).toBeInstanceOf(Float32Array);
    expect(hv.length).toBe(DIM);
  });

  test("encode returns dominant field", () => {
    const enc = makeEncoder();
    const [, field] = enc.encode(tokenize("fix the bug in the code"));
    expect(field).toBeTruthy();
  });

  test("same text → same HV (deterministic)", () => {
    const enc1 = makeEncoder();
    const enc2 = makeEncoder();
    const [hv1] = enc1.encode(tokenize("write code"));
    const [hv2] = enc2.encode(tokenize("write code"));
    let diff = 0;
    for (let i = 0; i < DIM; i++) diff += Math.abs(hv1[i] - hv2[i]);
    expect(diff).toBe(0);
  });

  test("atomState / loadAtomState roundtrip", () => {
    const enc1 = makeEncoder();
    const [hv1] = enc1.encode(tokenize("write code"));
    const state = enc1.atomState();

    const enc2 = new HDVEncoder(DIM, 99); // different seed
    enc2.loadAtomState(state);
    const [hv2] = enc2.encode(tokenize("write code"));

    let diff = 0;
    for (let i = 0; i < DIM; i++) diff += Math.abs(hv1[i] - hv2[i]);
    expect(diff).toBe(0);
  });

  test("empty token list returns valid HV", () => {
    const enc = makeEncoder();
    const [hv] = enc.encode([]);
    expect(hv.length).toBe(DIM);
  });
});

describe("HDCAgent", () => {
  test("fields are populated after observe", () => {
    const enc = makeEncoder();
    const agent = makeAgent();
    trainAgent(agent, enc);
    expect(agent.fields).toContain("tech");
    expect(agent.fields).toContain("weather");
  });

  test("classify returns a result", () => {
    const enc = makeEncoder();
    const agent = makeAgent();
    trainAgent(agent, enc);
    const hv = hvFor("write code", enc);
    const result = agent.classify(hv);
    expect(result.field).toBeTruthy();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.top3.length).toBeGreaterThan(0);
  });

  test("tech input → tech field", () => {
    const enc = makeEncoder();
    const agent = makeAgent();
    trainAgent(agent, enc);
    const result = agent.classify(hvFor("fix software bug", enc));
    expect(result.field).toBe("tech");
  });

  test("weather input → weather field", () => {
    const enc = makeEncoder();
    const agent = makeAgent();
    trainAgent(agent, enc);
    const result = agent.classify(hvFor("rain storm forecast", enc));
    expect(result.field).toBe("weather");
  });

  test("snapshot has expected keys", () => {
    const enc = makeEncoder();
    const agent = makeAgent();
    trainAgent(agent, enc);
    const snap = agent.snapshot();
    expect(snap).toHaveProperty("nFields");
    expect(snap).toHaveProperty("nObserved");
    expect(snap).toHaveProperty("fields");
  });

  test("toJSON / fromJSON roundtrip preserves fields", () => {
    const enc = makeEncoder();
    const agent = makeAgent();
    trainAgent(agent, enc);
    const state = agent.toJSON();
    const agent2 = HDCAgent.fromJSON(state);
    expect(agent2.fields.sort()).toEqual(agent.fields.sort());
    expect(agent2.nObserved).toBe(agent.nObserved);
  });

  test("toJSON / fromJSON preserves classification", () => {
    const enc = makeEncoder();
    const agent = makeAgent();
    trainAgent(agent, enc);
    const hv  = hvFor("fix software bug", enc);
    const r1  = agent.classify(hv);
    const r2  = HDCAgent.fromJSON(agent.toJSON()).classify(hv);
    expect(r2.field).toBe(r1.field);
  });

  test("episodes are stored and retrievable", () => {
    const enc = makeEncoder();
    const agent = makeAgent();
    trainAgent(agent, enc);
    // Force an update to store episode
    const hv = hvFor("fix software bug", enc);
    agent.update(hv, "tech", { note: "test" });
    expect(agent.nEpisodes).toBeGreaterThan(0);
    const eps = agent.retrieve(hv, 1, "tech");
    expect(eps.length).toBeGreaterThan(0);
  });
});
