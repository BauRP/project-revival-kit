// ============================================================================
//  Capacitor asset path normaliser.
//  ---------------------------------------------------------------------------
//  TanStack Start serialises its manifest with the router basepath prefixed to
//  every asset URL. Combined with Vite's relative `base: "./"` that yields
//  root-relative hybrids such as "/./assets/app.js" and "/favicon.ico", which
//  cannot be resolved when the WebView loads the bundle from file://.
//  This script rewrites every such path in the built SPA to a strictly
//  document-relative one.
// ============================================================================

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "dist/client");
const TEXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".map"]);

/** Files that must keep absolute URLs (none today, kept for clarity). */
const SKIP = new Set([]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let touched = 0;
try {
  statSync(ROOT);
} catch {
  console.log("[trivo] dist/ missing — nothing to normalise");
  process.exit(0);
}

for (const file of walk(ROOT)) {
  const ext = file.slice(file.lastIndexOf("."));
  if (!TEXT.has(ext) || SKIP.has(file)) continue;
  const before = readFileSync(file, "utf8");
  const after = before
    // "/./assets/x" and '/./_build/x' → "./assets/x"
    .replaceAll("/./", "./")
    // ("/assets/… | "/_build/… | "/favicon.ico → relative
    .replace(
      /(["'(])\/(assets\/|_build\/|_serverFn\/|favicon\.ico|robots\.txt|placeholder\.svg)/g,
      "$1./$2",
    );
  if (after !== before) {
    writeFileSync(file, after);
    touched += 1;
  }
}

console.log(`[trivo] normalised asset paths in ${touched} file(s)`);
