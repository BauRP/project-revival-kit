// Single source of truth for the Capacitor web directory.
// The framework build lands in dist/client locally, but some environments
// (Nitro presets on CI) emit .output/public. stage-web.mjs copies whichever
// real build exists into STAGE_DIR, which capacitor.config.ts uses as webDir.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const STAGE_DIR = resolve(process.cwd(), "www");

export const BUILD_CANDIDATES = [
  resolve(process.cwd(), "dist/client"),
  resolve(process.cwd(), ".output/public"),
];

/** Returns the first candidate containing index.html, or null. */
export function findBuildOutput() {
  return BUILD_CANDIDATES.find((dir) => existsSync(resolve(dir, "index.html"))) ?? null;
}
