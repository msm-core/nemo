import { tokenize, tokenStream } from "../src/tokenizer";

describe("CST Tokenizer", () => {
  test("basic concept", () => {
    const toks = tokenize("write a document");
    const concepts = toks.filter(t => t.type === "CONCEPT");
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts[0].field).toBe("write");
  });

  test("NEG from 'not'", () => {
    const toks = tokenize("not working");
    const neg = toks.find(t => t.type === "NEG");
    expect(neg).toBeDefined();
  });

  test("NEG from contraction can't", () => {
    const toks = tokenize("I can't do this");
    const neg = toks.find(t => t.type === "NEG");
    expect(neg).toBeDefined();
  });

  test("NEG from won't", () => {
    const toks = tokenize("it won't work");
    const neg = toks.find(t => t.type === "NEG");
    expect(neg).toBeDefined();
  });

  test("QUERY from question mark", () => {
    const toks = tokenize("how does this work?");
    expect(toks.some(t => t.type === "QUERY")).toBe(true);
  });

  test("WHERE_Q from where", () => {
    const toks = tokenize("where is the coffee shop");
    expect(toks.some(t => t.type === "WHERE_Q")).toBe(true);
  });

  test("WHO_Q from who", () => {
    const toks = tokenize("who invented Python");
    expect(toks.some(t => t.type === "WHO_Q")).toBe(true);
  });

  test("function words are filtered", () => {
    const toks = tokenize("the a an is are");
    const concepts = toks.filter(t => t.type === "CONCEPT");
    expect(concepts.length).toBe(0);
  });

  test("concept+role pair for morphological word", () => {
    const toks = tokenize("teacher");
    const types = toks.map(t => t.type);
    expect(types).toContain("CONCEPT");
    expect(types).toContain("ROLE");
  });

  test("'place' maps to place (not move)", () => {
    const toks = tokenize("a nice place");
    const concepts = toks.filter(t => t.type === "CONCEPT");
    expect(concepts.some(c => c.field === "place")).toBe(true);
    expect(concepts.every(c => c.field !== "move")).toBe(true);
  });

  test("'draft' maps to write (not send)", () => {
    const toks = tokenize("draft an email");
    const concepts = toks.filter(t => t.type === "CONCEPT");
    expect(concepts.some(c => c.field === "write")).toBe(true);
  });

  test("'share' maps to give (not trade)", () => {
    const toks = tokenize("share the document");
    const concepts = toks.filter(t => t.type === "CONCEPT");
    expect(concepts.some(c => c.field === "give")).toBe(true);
  });

  test("animal vocabulary", () => {
    const toks = tokenize("a lion and a dolphin");
    expect(toks.some(t => t.field === "animal")).toBe(true);
  });

  test("color vocabulary", () => {
    const toks = tokenize("the sky is blue");
    expect(toks.some(t => t.field === "color")).toBe(true);
  });

  test("body vocabulary", () => {
    const toks = tokenize("my heart is beating");
    expect(toks.some(t => t.field === "body")).toBe(true);
  });

  test("tokenStream returns string", () => {
    const ts = tokenStream("I need help with code");
    expect(typeof ts).toBe("string");
    expect(ts.length).toBeGreaterThan(0);
  });

  test("PAST from was", () => {
    const toks = tokenize("it was done");
    expect(toks.some(t => t.type === "PAST")).toBe(true);
  });

  test("COND from if", () => {
    const toks = tokenize("if it rains");
    expect(toks.some(t => t.type === "COND")).toBe(true);
  });

  test("MODAL from should", () => {
    const toks = tokenize("you should know");
    expect(toks.some(t => t.type === "MODAL")).toBe(true);
  });
});
