/**
 * Entry point for `node --test infra/railway/`. Node 24 resolves a directory argument like `require()` does (to its
 * index.js) instead of expanding it to the test files inside, so this file imports every `*.test.mjs` below it.
 * `node --test "infra/railway/**\/*.test.mjs"` runs the same files directly.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const testFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? testFiles(join(dir, entry.name))
      : entry.name.endsWith(".test.mjs")
        ? [join(dir, entry.name)]
        : [],
  );

for (const file of testFiles(root).sort()) await import(pathToFileURL(file).href);
