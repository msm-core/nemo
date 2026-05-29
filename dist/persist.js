"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveToFile = saveToFile;
exports.loadFromFile = loadFromFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const agent_1 = require("./agent");
const encoder_1 = require("./encoder");
/**
 * Save agent + encoder state to a JSON file.
 * Creates parent directories if they don't exist.
 */
function saveToFile(filePath, agent, encoder, meta = {}) {
    const file = {
        version: 1,
        savedAt: new Date().toISOString(),
        agent: agent.toJSON(),
        encoderAtoms: encoder.atomState(),
        meta,
    };
    const dir = path_1.default.dirname(path_1.default.resolve(filePath));
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(filePath, JSON.stringify(file, null, 2), "utf8");
}
/**
 * Load agent + encoder from a previously saved .nemo.json file.
 */
function loadFromFile(filePath) {
    const raw = fs_1.default.readFileSync(filePath, "utf8");
    const file = JSON.parse(raw);
    if (!file.version || !file.agent) {
        throw new Error(`Invalid nemo file: ${filePath}`);
    }
    const agent = agent_1.HDCAgent.fromJSON(file.agent);
    const encoder = new encoder_1.HDVEncoder(file.agent.dim);
    if (file.encoderAtoms)
        encoder.loadAtomState(file.encoderAtoms);
    return { agent, encoder, meta: file.meta ?? {} };
}
//# sourceMappingURL=persist.js.map