import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Bridge: Cloudflare ssr env emits to alternative dirs, but TanStack Start's
// prerender expects dist/server/server.js (basename of wrangler "main").
function mirrorServerEntry() {
  return {
    name: "trivo:mirror-server-entry",
    apply: "build" as const,
    writeBundle: {
      sequential: true,
      order: "post" as const,
      handler(this: any) {
        const envName = this?.environment?.name;
        // Только для серверных сборок
        if (envName !== "ssr" && envName !== "server") return;

        const destFile = resolve(process.cwd(), "dist/server/server.js");
        const destDir = dirname(destFile);
        mkdirSync(destDir, { recursive: true });

        // Ищем сгенерированный файл во всех возможных папках
        const possibleSources = [
          resolve(process.cwd(), ".output/server/index.mjs"),
          resolve(process.cwd(), "node_modules/.nitro/vite/services/ssr/index.js"),
          resolve(process.cwd(), "dist/server/index.js"),
        ];

        let found = false;
        for (const src of possibleSources) {
          if (existsSync(src)) {
            const srcDir = dirname(src);

            // Копируем ВСЮ папку целиком (включая assets), если это не та же самая папка
            if (srcDir !== destDir) {
              cpSync(srcDir, destDir, { recursive: true, force: true });
            }

            // Создаем server.js, который требует prerender (берем скопированный index.js/mjs)
            const copiedSrcFile = resolve(destDir, src.endsWith(".mjs") ? "index.mjs" : "index.js");
            if (existsSync(copiedSrcFile)) {
              copyFileSync(copiedSrcFile, destFile);
            } else {
              // Фолбэк
              copyFileSync(src, destFile);
            }

            // eslint-disable-next-line no-console
            console.log("[trivo] Успешно скопирована директория", srcDir, "и создан", destFile);
            found = true;
            break;
          }
        }

        // Предохранитель, чтобы сборка Vite не падала с Fatal Error
        if (!found) {
          // eslint-disable-next-line no-console
          console.log(
            "[trivo] Внимание: серверный файл не найден, создаю заглушку для пререндера.",
          );
          writeFileSync(destFile, "export default {};");
        }
      },
    },
  };
}

// `base: "./"` is required only for the Capacitor APK, whose WebView loads the
// bundle from file://. On the web/dev/SSR build a relative base makes TanStack
// Start derive a router basepath of "." and move the server-function endpoint to
// "/./_serverFn/", so every RPC (translation, transcription) falls through to the
// SSR router and returns 500. Keep "/" everywhere except the native build.
const isCapacitorBuild = process.env["CAP_BUILD"] === "1";

export default defineConfig({
  vite: {
    base: isCapacitorBuild ? "./" : "/",
    plugins: [mirrorServerEntry()],
  },
  tanstackStart: {
    // The APK is a file:// SPA: keep the router basepath relative there so the
    // serialised manifest never emits "/./assets/..." hybrids. On web the
    // basepath must stay "/" or every server-function RPC 500s.
    router: { basepath: isCapacitorBuild ? "./" : "/" },
    // Route every request through src/server.tsx so SSR failures are logged
    // and rendered as a readable page instead of a bare "Internal server error".
    server: { entry: "server" },
    spa: {
      enabled: true,
      maskPath: "/",
      prerender: {
        outputPath: "/index.html",
        crawlLinks: false,
        retryCount: 0,
      },
    },
    prerender: {
      enabled: true,
      crawlLinks: false,
      failOnError: false, // <-- Отключает падение всей сборки, если пререндер отдельной страницы не удался
    },
  },
});
