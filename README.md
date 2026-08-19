# Trivo Chat Elite (`com.baurp.trivochat`)

Zero-trust, serverless messenger. Every message is end-to-end encrypted on device and
transported peer-to-peer over a **Tor v3 onion service** hosted by the Android app itself.
There is no application backend, no analytics, no ads and no third-party BaaS.

## Stack

| Layer | Technology |
| --- | --- |
| UI | React 19 + TypeScript, Vite 7, Tailwind CSS v4 (`src/styles.css`, `src/index.css`), Radix/shadcn, Lucide |
| Routing | TanStack Router / TanStack Start (`src/routes`, `src/router.tsx`, hash history in the APK) |
| Native shell | Capacitor 8.5.0 (`capacitor.config.ts`), Java Android project in `android/` |
| Transport | Custom `TorTransport` Capacitor plugin → `TorOnionService` (tor-android 0.4.5.7 + jtorctl), SOCKS5 client, persistent frame queues |
| Crypto | tweetnacl (Ed25519 / X25519) executed inside `src/lib/workers/crypto.worker.ts` |
| Local data | Dexie / IndexedDB with encrypted payloads, `safe-storage.ts` fallback |
| Offline assistant | NLP.js (`@nlpjs/*`) trained on device inside `src/lib/workers/nlp.worker.ts` |

## Explicitly absent

Firebase, Supabase, GunDB, Google AdMob/AdSense, Yandex Ads, `google-services.json`,
`YandexAdsPlugin.java`, `ad-config.ts`, `capacitor.config.json` — all removed. Only
`capacitor.config.ts` exists, and no tracking or ad SDK is referenced by Gradle or npm.

## Scripts

```bash
npm run dev                  # Vite dev server (web preview)
npm run build                # Web/SPA build into dist/
npm run build:android        # CAP_BUILD=1 build + relative-path fix + cap sync + assembleDebug
npm run build:android:release# same pipeline, assembleRelease
npm run lint                 # ESLint (incl. prettier rules)
npm run format               # Prettier write
```

`scripts/fix-relative-assets.mjs` rewrites any `/./assets/...`, `/assets/...` or
`/favicon.ico` reference in `dist/` to a document-relative path, which is mandatory for
the `file://` WebView. `CAP_BUILD=1` additionally sets Vite `base: "./"` and the TanStack
router basepath to `"./"`.

## Android notes

- Permissions are limited to what Tor needs plus user-triggered capabilities:
  `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `FOREGROUND_SERVICE(+DATA_SYNC)`,
  `POST_NOTIFICATIONS`, camera/mic/media.
- Cleartext is enabled only for loopback (`127.0.0.1`, `localhost`, `10.0.2.2`) through
  `res/xml/network_security_config.xml`, because the Tor SOCKS proxy is local.
- `libtor.so` is loaded lazily by `tor/TorNativeSupport.java` on the first explicit
  `start()` — never at class-load time — so an unsupported ABI degrades gracefully
  instead of crashing the process.
- `MainActivity` installs a global `UncaughtExceptionHandler`, logs the whole boot
  sequence under the `TrivoMain` tag, and paints a native diagnostic screen if the
  Capacitor bridge itself fails.
