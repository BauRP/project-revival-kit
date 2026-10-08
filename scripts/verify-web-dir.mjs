// Fails the build if the Capacitor webDir (dist/client) is not a real SPA build:
// index.html must exist and every local script/stylesheet it references must exist.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.cwd(), "dist/client");
const index = resolve(dir, "index.html");
if (!existsSync(index)) {
  console.error(`[verify-web-dir] missing ${index}`);
  process.exit(1);
}
const html = readFileSync(index, "utf8");
const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)].map((m) => m[1]);
const missing = refs.filter((r) => !existsSync(resolve(dir, r)));
if (!refs.some((r) => r.endsWith(".js"))) {
  console.error("[verify-web-dir] index.html references no local script");
  process.exit(1);
}
if (missing.length) {
  console.error("[verify-web-dir] missing assets:", missing);
  process.exit(1);
}
console.log(`[verify-web-dir] OK: ${refs.length} local assets referenced by index.html exist`);
