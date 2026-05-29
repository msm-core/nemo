/**
 * persist.ts — File-based persistence for nemo agent sessions.
 *
 * Saves agent + encoder atom state to a single .nemo.json file.
 * No external dependencies — Node.js built-in `fs` only.
 *
 * Usage:
 *   saveToFile("./memory.nemo.json", agent, encoder)
 *   const { agent, encoder } = loadFromFile("./memory.nemo.json")
 */
import { HDCAgent, AgentState } from "./agent";
import { HDVEncoder, AtomState } from "./encoder";
export interface NemoFile {
    version: number;
    savedAt: string;
    agent: AgentState;
    encoderAtoms: AtomState;
    meta: Record<string, unknown>;
}
/**
 * Save agent + encoder state to a JSON file.
 * Creates parent directories if they don't exist.
 */
export declare function saveToFile(filePath: string, agent: HDCAgent, encoder: HDVEncoder, meta?: Record<string, unknown>): void;
/**
 * Load agent + encoder from a previously saved .nemo.json file.
 */
export declare function loadFromFile(filePath: string): {
    agent: HDCAgent;
    encoder: HDVEncoder;
    meta: Record<string, unknown>;
};
//# sourceMappingURL=persist.d.ts.map