#!/usr/bin/env node
// Deduplicate Arabic keys in tokenizer-ar.ts
// Keeps first occurrence of each Arabic key within each top-level const object.

const fs = require("fs");
let src = fs.readFileSync("src/tokenizer-ar.ts", "utf8");

const lines = src.split("\n");
const result = [];

const seenKeys = new Set();
let inObject = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Detect start of new top-level const object
  if (/^const\s+\w+\s*[=:]/.test(line)) {
    seenKeys.clear();
    inObject = true;
  }
  // Detect end of top-level object (closing };)
  if (inObject && /^\s*\};\s*$/.test(line)) {
    inObject = false;
    result.push(line);
    continue;
  }

  if (!inObject) {
    result.push(line);
    continue;
  }

  // Find all Arabic key-value pairs on this line
  // Match: "arabic-word": "value", OR "arabic-word": alphanumeric,
  const entryRe = /"([\u0600-\u06FF]+)"\s*:\s*(?:"[^"]*"|[\w.:]+),?/g;
  let m;
  const toRemove = [];
  // Process one by one so within-line duplicates are caught
  while ((m = entryRe.exec(line)) !== null) {
    const key = m[1];
    if (seenKeys.has(key)) {
      toRemove.push(m[0]);
    } else {
      seenKeys.add(key); // register immediately to catch same-line duplicates
    }
  }

  let newLine = line;
  for (const entry of toRemove) {
    // Escape for RegExp
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Remove entry + optional trailing comma/whitespace
    newLine = newLine.replace(new RegExp(escaped + ",?\\s*"), "");
  }

  // Skip lines that became only whitespace
  if (/^\s*$/.test(newLine)) continue;

  result.push(newLine);
}

const fixed = result.join("\n");
fs.writeFileSync("src/tokenizer-ar.ts", fixed);
console.log(`Done. Lines: ${lines.length} -> ${result.length}`);
