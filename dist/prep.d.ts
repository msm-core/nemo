/**
 * prep.ts — Preparation layer: rule-based intent frame between CST and HDC.
 *
 * Produces a ReasoningFrame that enriches classification before HDC lookup.
 */
import { NemoToken } from "./tokenizer";
export declare const FIELD_TOOL: Record<string, string>;
export interface ReasoningFrame {
    queryType: string;
    dominantField: string;
    secondaryFields: string[];
    conceptCounts: Record<string, number>;
    isQuestion: boolean;
    hasNegation: boolean;
    hasLocationQ: boolean;
    hasTemporalQ: boolean;
    hasMethodQ: boolean;
    hasCauseQ: boolean;
    hasAgentQ: boolean;
    negatedFields: string[];
    resolutionRule: string | null;
    patternMatch: string | null;
    fieldOverride: string | null;
    verbField: string | null;
    objectFields: string[];
    candidateTools: string[];
    excludedTools: string[];
    confidencePrior: number;
}
export declare function buildFrame(text: string, tokens: NemoToken[]): ReasoningFrame;
//# sourceMappingURL=prep.d.ts.map