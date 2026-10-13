// Copies the real framework build into www/ (Capacitor webDir). Fatal if no build exists.
import { cpSync, rmSync } from "node:fs";
import { BUILD_CANDIDATES, STAGE_DIR, findBuildOutput } from "./web-dir.mjs";

const src = findBuildOutput();
if (!src) {
  console.error("[stage-web] no build output with index.html in:", BUILD_CANDIDATES);
  process.exit(1);
}
rmSync(STAGE_DIR, { recursive: true, force: true });
cpSync(src, STAGE_DIR, { recursive: true });
console.log(`[stage-web] staged ${src} -> ${STAGE_DIR}`);
