import { pipeline, GATE_HIGH, GATE_MED, FIELD_TOOL } from "../src/index";
import { HDCAgent } from "../src/agent";
import { HDVEncoder } from "../src/encoder";
import { tokenize } from "../src/tokenizer";
import { buildFrame } from "../src/prep";

const DIM = 1000;

function makeEncoder() { return new HDVEncoder(DIM, 42); }

function trainedAgent(enc: HDVEncoder): HDCAgent {
  const agent = new HDCAgent(DIM);
  const train = (phrases: string[], field: string) => {
    for (const p of phrases) {
      const [hv] = enc.encode(tokenize(p));
      agent.observe(hv, field);
    }
  };
  train(["write code", "fix bug", "debug error", "python script"], "tech");
  train(["weather forecast", "rain tomorrow", "temperature today"], "weather");
  train(["recipe pasta", "cook chicken", "bake bread"], "food");
  train(["calendar meeting", "schedule reminder", "appointment tomorrow"], "time");
  agent.calibrate();
  return agent;
}

describe("buildFrame (prep layer)", () => {
  test("location query sets WHERE_Q", () => {
    const toks = tokenize("where is the nearest coffee shop?");
    const frame = buildFrame("where is the nearest coffee shop?", toks);
    expect(frame.hasLocationQ).toBe(true);
  });

  test("negation detected", () => {
    const toks = tokenize("I can't fix this bug");
    const frame = buildFrame("I can't fix this bug", toks);
    expect(frame.hasNegation).toBe(true);
  });

  test("recipe pattern overrides field to food", () => {
    const toks = tokenize("how do I cook pasta?");
    const frame = buildFrame("how do I cook pasta?", toks);
    expect(frame.queryType).toBe("recipe_query");
  });

  test("tech pattern sets queryType", () => {
    const toks = tokenize("I have a syntax error in python");
    const frame = buildFrame("I have a syntax error in python", toks);
    expect(frame.queryType).toBe("tech_query");
  });

  test("weather pattern sets queryType", () => {
    const toks = tokenize("what is the weather forecast for tomorrow?");
    const frame = buildFrame("what is the weather forecast for tomorrow?", toks);
    expect(frame.queryType).toBe("weather_query");
  });

  test("candidate tools are populated", () => {
    const toks = tokenize("write code");
    const frame = buildFrame("write code", toks);
    expect(frame.candidateTools.length).toBeGreaterThan(0);
  });
});

describe("pipeline", () => {
  test("returns all expected keys", () => {
    const enc = makeEncoder();
    const agent = trainedAgent(enc);
    const result = pipeline("fix software bug", agent, enc);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("tokens");
    expect(result).toHaveProperty("frame");
    expect(result).toHaveProperty("classification");
    expect(result).toHaveProperty("tool");
    expect(result).toHaveProperty("gate");
  });

  test("gate is one of the three values", () => {
    const enc = makeEncoder();
    const agent = trainedAgent(enc);
    const result = pipeline("write code", agent, enc);
    expect(["skip_llm", "llm_assist", "full_llm"]).toContain(result.gate);
  });

  test("tech phrase → code/debug assistant tool", () => {
    const enc = makeEncoder();
    const agent = trainedAgent(enc);
    const result = pipeline("fix software bug in python code", agent, enc);
    expect(["code_assistant", "debug_assistant"]).toContain(result.tool);
  });

  test("frame is included", () => {
    const enc = makeEncoder();
    const agent = trainedAgent(enc);
    const result = pipeline("what is the weather forecast?", agent, enc);
    expect(result.frame.queryType).toBe("weather_query");
  });

  test("FIELD_TOOL has entries for all fields", () => {
    expect(FIELD_TOOL["tech"]).toBe("code_assistant");
    expect(FIELD_TOOL["weather"]).toBe("weather_service");
    expect(FIELD_TOOL["food"]).toBe("recipe_advisor");
  });
});
