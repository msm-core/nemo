/**
 * prep.ts — Preparation layer: rule-based intent frame between CST and HDC.
 *
 * Produces a ReasoningFrame that enriches classification before HDC lookup.
 */

import { CSTToken } from "./tokenizer";

// ── Field → Tool mappings ─────────────────────────────────────────────────────

export const FIELD_TOOL: Record<string, string> = {
  know:     "knowledge_base",   think:    "reasoning_engine",
  speak:    "dialogue_manager", write:    "writing_assistant",
  see:      "vision_analyzer",  feel:     "sentiment_analyzer",
  make:     "task_executor",    create:   "creative_generator",
  destroy:  "delete_handler",   fix:      "debug_assistant",
  work:     "workflow_manager", move:     "navigation_service",
  send:     "communication_hub",give:     "resource_manager",
  gather:   "aggregator",       hold:     "storage_manager",
  connect:  "integration_bus",  exist:    "state_tracker",
  want:     "intent_classifier",govern:   "policy_engine",
  fight:    "conflict_resolver",trade:    "market_service",
  social:   "social_graph",     possess:  "ownership_registry",
  science:  "research_engine",  health:   "medical_advisor",
  tech:     "code_assistant",   art:      "creative_studio",
  sport:    "sports_analytics", nature:   "environment_service",
  weather:  "weather_service",  animal:   "species_classifier",
  plant:    "botany_service",   body:     "anatomy_reference",
  food:     "recipe_advisor",   material: "material_catalog",
  color:    "color_service",    time:     "calendar_service",
  place:    "location_service", size:     "measurement_service",
  measure:  "measurement_service", quality: "quality_evaluator",
};

// ── Resolution rules (co-occurrence → override) ───────────────────────────────

const RULES: Array<[Set<string>, string]> = [
  [new Set(["tech", "fix"]),      "fix"],
  [new Set(["tech", "code"]),     "tech"],
  [new Set(["health", "food"]),   "health"],
  [new Set(["move", "time"]),     "move"],
  [new Set(["speak", "work"]),    "speak"],
  [new Set(["write", "send"]),    "write"],
  [new Set(["trade", "know"]),    "know"],
];

const CREATIVE_TRIGGERS = new Set([
  "imagine", "invent", "dream", "story", "poem", "fantasy", "fiction",
  "creative", "novel", "compose", "brainstorm", "idea", "concept",
  "write", "draw", "design", "art",
]);

// ── Text-level patterns ───────────────────────────────────────────────────────

interface Pattern {
  subs:       string[];
  queryType:  string;
  fieldOverride?: string;
}

const PATTERNS: Pattern[] = [
  { subs: ["weather", "forecast", "temperature", "rain", "snow", "wind", "storm"],
    queryType: "weather_query" },
  { subs: ["recipe", "ingredient", "cook", "bake", "how to make", "how to cook"],
    queryType: "recipe_query", fieldOverride: "food" },
  { subs: ["match", "score", "game", "league", "standings", "championship", "fixture"],
    queryType: "sports_query" },
  { subs: ["symptom", "pain", "fever", "cough", "treatment", "headache", "dose", "medication"],
    queryType: "health_query" },
  { subs: ["schedule", "reminder", "calendar", "appointment", "deadline", "booking"],
    queryType: "calendar_query", fieldOverride: "time" },
  { subs: ["navigate", "route", "direction", "map", "nearest", "nearby", "distance"],
    queryType: "navigation_query", fieldOverride: "place" },
  { subs: ["stock", "price", "exchange", "bitcoin", "crypto", "currency", "gold"],
    queryType: "finance_query", fieldOverride: "trade" },
  { subs: ["dna", "experiment", "hypothesis", "physics", "chemistry", "quantum"],
    queryType: "science_query" },
  { subs: ["code", "bug", "error", "debug", "syntax", "compile", "import", "exception"],
    queryType: "tech_query" },
  { subs: ["translate", "meaning", "definition", "explain", "clarify", "describe"],
    queryType: "explanation_query", fieldOverride: "know" },
  { subs: ["best", "recommend", "suggest", "advice", "should i", "which is"],
    queryType: "recommendation_query" },
  { subs: ["email", "message", "send", "notify", "alert", "inbox"],
    queryType: "communication_query", fieldOverride: "send" },
];

const ACTION_FIELDS = new Set([
  "fix", "create", "move", "send", "govern",
  "fight", "destroy", "connect", "give",
]);

// ── Public types ──────────────────────────────────────────────────────────────

export interface ReasoningFrame {
  queryType:        string;
  dominantField:    string;
  secondaryFields:  string[];
  conceptCounts:    Record<string, number>;
  isQuestion:       boolean;
  hasNegation:      boolean;
  hasLocationQ:     boolean;
  hasTemporalQ:     boolean;
  hasMethodQ:       boolean;
  hasCauseQ:        boolean;
  hasAgentQ:        boolean;
  negatedFields:    string[];
  resolutionRule:   string | null;
  patternMatch:     string | null;
  fieldOverride:    string | null;
  verbField:        string | null;
  objectFields:     string[];
  candidateTools:   string[];
  excludedTools:    string[];
  confidencePrior:  number;
}

// ── Build function ────────────────────────────────────────────────────────────

export function buildFrame(text: string, tokens: CSTToken[]): ReasoningFrame {
  const textLower = text.toLowerCase();
  const fieldCounts: Record<string, number> = {};

  // Token-level analysis
  const isQuestion  = tokens.some(t => t.type === "QUERY");
  const hasNegation = tokens.some(t => t.type === "NEG");
  const hasLocationQ= tokens.some(t => t.type === "WHERE_Q");
  const hasTemporalQ= tokens.some(t => t.type === "WHEN_Q");
  const hasMethodQ  = tokens.some(t => t.type === "HOW_Q");
  const hasCauseQ   = tokens.some(t => t.type === "WHY_Q");
  const hasAgentQ   = tokens.some(t => t.type === "WHO_Q");

  for (const tok of tokens) {
    if (tok.type === "CONCEPT" && tok.field) {
      fieldCounts[tok.field] = (fieldCounts[tok.field] ?? 0) + 1;
    }
  }

  // Find dominant + secondary
  const sortedFields = Object.entries(fieldCounts).sort((a, b) => b[1] - a[1]);
  let dominantField  = sortedFields[0]?.[0] ?? "know";
  const secondaryFields = sortedFields.slice(1).map(e => e[0]);

  // Co-occurrence resolution rules
  let resolutionRule: string | null = null;
  const fieldSet = new Set(Object.keys(fieldCounts));
  for (const [pair, result] of RULES) {
    if ([...pair].every(f => fieldSet.has(f))) {
      dominantField  = result;
      resolutionRule = [...pair].join("+") + "→" + result;
      break;
    }
  }

  // Pattern matching
  let patternMatch:  string | null = null;
  let fieldOverride: string | null = null;
  let queryType      = isQuestion ? "factual_query" : "action";

  for (const pat of PATTERNS) {
    if (pat.subs.some(s => textLower.includes(s))) {
      patternMatch  = pat.subs.find(s => textLower.includes(s)) ?? null;
      queryType     = pat.queryType;
      fieldOverride = pat.fieldOverride ?? null;
      break;
    }
  }
  if (fieldOverride) dominantField = fieldOverride;

  // Creative override
  if ([...CREATIVE_TRIGGERS].some(w => textLower.includes(w)) && !fieldOverride) {
    queryType = "creative_query";
    dominantField = "create";
  }

  // Verb field vs object fields
  let verbField: string | null = null;
  const objectFields: string[] = [];
  for (const tok of tokens) {
    if (tok.type === "CONCEPT" && tok.field) {
      if (ACTION_FIELDS.has(tok.field) && !verbField) verbField = tok.field;
      else objectFields.push(tok.field);
    }
  }

  // Negated fields
  const negatedFields: string[] = [];
  if (hasNegation) {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === "NEG") {
        const next = tokens[i + 1];
        if (next?.type === "CONCEPT" && next.field) negatedFields.push(next.field);
      }
    }
  }

  // Candidate tools
  const candidateFields = [dominantField, ...secondaryFields.slice(0, 2)];
  const candidateTools  = [...new Set(candidateFields.map(f => FIELD_TOOL[f]).filter(Boolean))];
  const excludedTools   = negatedFields.map(f => FIELD_TOOL[f]).filter(Boolean);

  // Confidence prior
  const hasPattern = !!patternMatch;
  const hasRule    = !!resolutionRule;
  let confidencePrior = 0.35;
  if (hasPattern && hasRule) confidencePrior = 0.75;
  else if (hasPattern)       confidencePrior = 0.65;
  else if (hasRule)          confidencePrior = 0.55;

  return {
    queryType, dominantField, secondaryFields, conceptCounts: fieldCounts,
    isQuestion, hasNegation, hasLocationQ, hasTemporalQ,
    hasMethodQ, hasCauseQ, hasAgentQ,
    negatedFields, resolutionRule, patternMatch, fieldOverride,
    verbField, objectFields, candidateTools, excludedTools, confidencePrior,
  };
}
