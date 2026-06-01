#!/usr/bin/env node
// Post-build: add .js extensions to bare relative imports in dist/*.js
// Needed because tsc with moduleResolution:bundler emits bare specifiers,
// which Node.js ESM requires to be explicit.

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const distDir = new URL("../dist", import.meta.url).pathname;

for (const file of readdirSync(distDir)) {
  if (!file.endsWith(".js")) continue;
  const filePath = join(distDir, file);
  const original = readFileSync(filePath, "utf8");
  const patched = original.replace(
    /(from\s+["'])(\.\/[^"'.]+)(["'])/g,
    "$1$2.js$3",
  );
  if (patched !== original) {
    writeFileSync(filePath, patched, "utf8");
    console.log(`patched: ${file}`);
  }
}
