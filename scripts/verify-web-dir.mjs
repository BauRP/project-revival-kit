// Fails if the Capacitor webDir (www/) is not a real SPA build:
// index.html must exist, reference a local script, and every local asset it references must exist.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STAGE_DIR } from "./web-dir.mjs";

const index = resolve(STAGE_DIR, "index.html");
if (!existsSync(index)) {
  console.error(`[verify-web-dir] missing ${index} — run scripts/stage-web.mjs after the build`);
  process.exit(1);
}
const html = readFileSync(index, "utf8");
const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)].map((m) => m[1]);
if (!refs.some((r) => r.endsWith(".js"))) {
  console.error("[verify-web-dir] index.html references no relative local script");
  process.exit(1);
}
if (/(?:src|href)="\/(?!\/)/.test(html)) {
  console.error("[verify-web-dir] index.html still contains root-absolute asset paths");
  process.exit(1);
}
const missing = refs.filter((r) => !existsSync(resolve(STAGE_DIR, r)));
if (missing.length) {
  console.error("[verify-web-dir] missing assets:", missing);
  process.exit(1);
}
console.log(`[verify-web-dir] OK: ${refs.length} local assets referenced by ${index} exist`);
