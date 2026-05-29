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

import fs from "fs";
import path from "path";
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
export function saveToFile(
  filePath: string,
  agent: HDCAgent,
  encoder: HDVEncoder,
  meta: Record<string, unknown> = {},
): void {
  const file: NemoFile = {
    version: 1,
    savedAt: new Date().toISOString(),
    agent: agent.toJSON(),
    encoderAtoms: encoder.atomState(),
    meta,
  };
  const dir = path.dirname(path.resolve(filePath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(file, null, 2), "utf8");
}

/**
 * Load agent + encoder from a previously saved .nemo.json file.
 */
export function loadFromFile(filePath: string): {
  agent: HDCAgent;
  encoder: HDVEncoder;
  meta: Record<string, unknown>;
} {
  const raw = fs.readFileSync(filePath, "utf8");
  const file = JSON.parse(raw) as NemoFile;
  if (!file.version || !file.agent) {
    throw new Error(`Invalid nemo file: ${filePath}`);
  }
  const agent = HDCAgent.fromJSON(file.agent);
  const encoder = new HDVEncoder(file.agent.dim);
  if (file.encoderAtoms) encoder.loadAtomState(file.encoderAtoms);
  return { agent, encoder, meta: file.meta ?? {} };
}
