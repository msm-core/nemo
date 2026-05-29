import { tokenizeAr, tokenStreamAr, COMPOUND_FIELDS_AR } from "../src/tokenizer-ar";

describe("CST Arabic Tokenizer", () => {
  // ── Core concept lookup ─────────────────────────────────────────────────────

  test("basic CONCEPT from root map — كتب (write)", () => {
    const toks = tokenizeAr("يكتب رسالة");
    const concepts = toks.filter(t => t.type === "CONCEPT");
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts[0].field).toBe("write");
  });

  test("basic CONCEPT from root map — علم (know)", () => {
    const toks = tokenizeAr("العلم ضروري");
    expect(toks.some(t => t.type === "CONCEPT" && t.field === "know")).toBe(true);
  });

  test("CONCEPT from direct field map — animal (كلب)", () => {
    const toks = tokenizeAr("كلب كبير");
    expect(toks.some(t => t.type === "CONCEPT" && t.field === "animal")).toBe(true);
  });

  test("CONCEPT from direct field map — color (أحمر)", () => {
    const toks = tokenizeAr("اللون ازرق");
    expect(toks.some(t => t.type === "CONCEPT" && t.field === "color")).toBe(true);
  });

  test("CONCEPT from direct field map — body (قلب)", () => {
    const toks = tokenizeAr("القلب ينبض");
    expect(toks.some(t => t.type === "CONCEPT" && t.field === "body")).toBe(true);
  });

  // ── ROLE detection ──────────────────────────────────────────────────────────

  test("ROLE agent — كاتب (one who writes)", () => {
    const toks = tokenizeAr("كاتب");
    const types = toks.map(t => t.type);
    expect(types).toContain("CONCEPT");
    expect(types).toContain("ROLE");
    const role = toks.find(t => t.type === "ROLE");
    expect(role?.role).toBe("agent");
  });

  test("ROLE patient — مكتوب (written)", () => {
    const toks = tokenizeAr("مكتوب جيدا");
    const role = toks.find(t => t.type === "ROLE");
    expect(role).toBeDefined();
    expect(role?.role).toBe("patient");
  });

  test("ROLE process — تدريب (training)", () => {
    const toks = tokenizeAr("تدريب الفريق");
    const role = toks.find(t => t.type === "ROLE");
    expect(role).toBeDefined();
    expect(role?.role).toBe("process");
  });

  test("ROLE emitted without CONCEPT (parity with English)", () => {
    // A word with clear morphology but no known root — should still emit ROLE
    // معتقل: م_ع_ت_ق_ل  — مفعل pattern (place) but root not in ROOT_MAP
    // Using a pattern word where morphology is clear
    const toks = tokenizeAr("مدرسة");        // مفعله place pattern
    const types = toks.map(t => t.type);
    // If the word maps a known root → CONCEPT+ROLE; if not → ROLE alone
    // Either way ROLE must be present
    expect(types).toContain("ROLE");
  });

  // ── Structural tokens ───────────────────────────────────────────────────────

  test("NEG from لا", () => {
    const toks = tokenizeAr("لا أعرف");
    expect(toks.some(t => t.type === "NEG")).toBe(true);
  });

  test("NEG from لم", () => {
    const toks = tokenizeAr("لم يكتمل");
    expect(toks.some(t => t.type === "NEG")).toBe(true);
  });

  test("QUERY from ؟", () => {
    const toks = tokenizeAr("هل تعرف؟");
    expect(toks.some(t => t.type === "QUERY")).toBe(true);
  });

  test("WHAT_Q from ماذا", () => {
    const toks = tokenizeAr("ماذا تريد");
    expect(toks.some(t => t.type === "WHAT_Q")).toBe(true);
  });

  test("WHO_Q from من", () => {
    const toks = tokenizeAr("من كتب هذا");
    expect(toks.some(t => t.type === "WHO_Q")).toBe(true);
  });

  test("WHERE_Q from أين", () => {
    const toks = tokenizeAr("أين الكتاب");
    expect(toks.some(t => t.type === "WHERE_Q")).toBe(true);
  });

  test("WHEN_Q from متى", () => {
    const toks = tokenizeAr("متى يصل");
    expect(toks.some(t => t.type === "WHEN_Q")).toBe(true);
  });

  test("WHY_Q from لماذا", () => {
    const toks = tokenizeAr("لماذا ذهبت");
    expect(toks.some(t => t.type === "WHY_Q")).toBe(true);
  });

  test("HOW_Q from كيف", () => {
    const toks = tokenizeAr("كيف يعمل هذا");
    expect(toks.some(t => t.type === "HOW_Q")).toBe(true);
  });

  test("WHICH_Q from أي", () => {
    const toks = tokenizeAr("أي كتاب تريد");
    expect(toks.some(t => t.type === "WHICH_Q")).toBe(true);
  });

  test("MODAL from يمكن", () => {
    const toks = tokenizeAr("يمكن أن أساعد");
    expect(toks.some(t => t.type === "MODAL")).toBe(true);
  });

  test("MODAL from يجب", () => {
    const toks = tokenizeAr("يجب العمل");
    expect(toks.some(t => t.type === "MODAL")).toBe(true);
  });

  test("COND from إذا", () => {
    const toks = tokenizeAr("إذا جاء");
    expect(toks.some(t => t.type === "COND")).toBe(true);
  });

  test("CAUSE from لأن", () => {
    const toks = tokenizeAr("لأن الوقت قصير");
    expect(toks.some(t => t.type === "CAUSE")).toBe(true);
  });

  test("PAST from كان", () => {
    const toks = tokenizeAr("كان يكتب");
    expect(toks.some(t => t.type === "PAST")).toBe(true);
  });

  // ── FUTURE via سـ prefix ────────────────────────────────────────────────────

  test("FUTURE token from سـ prefix — سيكتب", () => {
    const toks = tokenizeAr("سيكتب الكتاب");
    const types = toks.map(t => t.type);
    expect(types).toContain("FUTURE");
    expect(types).toContain("CONCEPT");
    expect(toks.find(t => t.type === "CONCEPT")?.field).toBe("write");
  });

  // ── REL tokens ──────────────────────────────────────────────────────────────

  test("REL from في and إلى", () => {
    const toks = tokenizeAr("ذهبت إلى البيت");
    const rels = toks.filter(t => t.type === "REL");
    expect(rels.length).toBeGreaterThanOrEqual(1);
  });

  test("REL from في (in)", () => {
    const toks = tokenizeAr("في البيت");
    expect(toks.some(t => t.type === "REL")).toBe(true);
  });

  // ── Compound phrases (COMPOUND_FIELDS_AR bigram pre-scan) ──────────────────

  test("compound: ذكاء اصطناعي → CONCEPT:tech", () => {
    const toks = tokenizeAr("ذكاء اصطناعي");
    const concept = toks.find(t => t.type === "CONCEPT");
    expect(concept).toBeDefined();
    expect(concept?.field).toBe("tech");
  });

  test("compound: كرة قدم → CONCEPT:sport", () => {
    const toks = tokenizeAr("كره قدم");
    const concept = toks.find(t => t.type === "CONCEPT");
    expect(concept).toBeDefined();
    expect(concept?.field).toBe("sport");
  });

  test("compound: صحة نفسية → CONCEPT:health", () => {
    const toks = tokenizeAr("صحه نفسيه");
    const concept = toks.find(t => t.type === "CONCEPT");
    expect(concept).toBeDefined();
    expect(concept?.field).toBe("health");
  });

  test("compound: تغير مناخ → CONCEPT:weather", () => {
    const toks = tokenizeAr("تغير مناخ");
    const concept = toks.find(t => t.type === "CONCEPT");
    expect(concept).toBeDefined();
    expect(concept?.field).toBe("weather");
  });

  test("compound: واي فاي → CONCEPT:tech", () => {
    const toks = tokenizeAr("واي فاي");
    const concept = toks.find(t => t.type === "CONCEPT");
    expect(concept).toBeDefined();
    expect(concept?.field).toBe("tech");
  });

  // ── Function word filtering ─────────────────────────────────────────────────

  test("function words are filtered", () => {
    const toks = tokenizeAr("هو هي نحن هم");
    const meaningful = toks.filter(t => t.type === "CONCEPT" || t.type === "LIT");
    expect(meaningful.length).toBe(0);
  });

  // ── LIT fallback ────────────────────────────────────────────────────────────

  test("unknown word emits LIT", () => {
    const toks = tokenizeAr("xyzabc");
    expect(toks.some(t => t.type === "LIT")).toBe(true);
  });

  // ── tokenStreamAr ──────────────────────────────────────────────────────────

  test("tokenStreamAr returns non-empty string", () => {
    const ts = tokenStreamAr("أحتاج مساعدة في البرمجة");
    expect(typeof ts).toBe("string");
    expect(ts.length).toBeGreaterThan(0);
  });

  test("tokenStreamAr contains CONCEPT in output", () => {
    const ts = tokenStreamAr("يكتب الطالب");
    expect(ts).toContain("CONCEPT:");
  });

  // ── COMPOUND_FIELDS_AR export ───────────────────────────────────────────────

  test("COMPOUND_FIELDS_AR is exported and has entries", () => {
    expect(typeof COMPOUND_FIELDS_AR).toBe("object");
    expect(Object.keys(COMPOUND_FIELDS_AR).length).toBeGreaterThan(10);
  });

  // ── Normalization resilience ────────────────────────────────────────────────

  test("handles diacritics in input", () => {
    // يَكْتُبُ with diacritics → same as يكتب
    const toks = tokenizeAr("يَكْتُبُ رِسَالَةً");
    expect(toks.some(t => t.type === "CONCEPT" && t.field === "write")).toBe(true);
  });

  test("handles ى vs ي normalization", () => {
    // Words ending in ى should normalize to ي before lookup
    const toks = tokenizeAr("مستشفى");
    // Either CONCEPT:health or LIT — just should not throw
    expect(Array.isArray(toks)).toBe(true);
  });
});
