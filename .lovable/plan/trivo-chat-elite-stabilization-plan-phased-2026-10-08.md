# Trivo Chat Elite — stabilization plan (phased)

Your brief has 14 parts touching the build, the Android shell, Tor, encryption, queues and delivery status. Doing all of it in one pass risks breaking working parts, so the work is split into four phases, each built and checked before the next.

## Honest limits up front
- This workspace has no Android emulator or device, so `adb logcat`, installs, cold-start and x86_64/ARM64 runtime tests cannot be run here. I can build debug + release APKs and inspect their contents (libtor.so per ABI, retained classes after R8). Runtime tests on a device need you, or a GitHub Actions emulator job (added in Phase 4).
- Real Tor send/receive can only be tested between two running Android installs.

## Phase 1 — Build pipeline and crash-proof startup (parts 1–5)
- Find the real web output folder, point Capacitor's `webDir` and the GitHub workflow at it, and remove the `dist/client` copy/rename steps and the fallback copy logic in CI.
- Two-stage startup: UI + local storage first; Tor starts only after the UI is up, from a "Connect" status chip with retry, never blocking the first frame. The app keeps working if Tor is off or fails.
- Tor service: start only while the app is in the foreground, handle rejection by showing a status (no silent background fallback), release wake locks, clean stop/restart, report service disconnects to the UI.
- Inspect every built APK: libtor.so present for each declared ABI (drop any ABI that has no library), JNI and plugin classes kept in release.

## Phase 2 — One transport, one identity (parts 6–7, 12)
- Remove the old WebRTC/WSS/STUN code (`p2p.ts`, `trivo-server.ts`, connection-manager relay parts); keep only Tor in the send path.
- One canonical peer ID (the contact's public-key ID) used everywhere: chats, contacts, onion address book, queue, ACKs. Drop the generated `trivo-...` IDs, with a one-time migration of stored chats.
- Keep the demo peer and security scan apart from real delivery status.

## Phase 3 — Encryption, queues, delivery (parts 8–11)
- Text messages: encrypt to the recipient's key, sign, send; verify and decrypt on arrival. Queues hold only ciphertext.
- Dexie holds message state; the native queue holds only transport frames, using the same message ID; retries are idempotent.
- Inbound: native queue "claim → JS stores → confirm → remove", so frames survive a crash; duplicate-safe storage.
- Two ACK levels: "sent" = reached the remote socket; "delivered" = the remote app verified, decrypted and saved it (signed ACK frame back).

## Phase 4 — Code quality and validation (parts 13–14)
- Fix lint errors in the startup and transport files properly (no rule disabling).
- Run web build, cap sync, debug + release APK builds, APK content audit.
- Add an optional GitHub Actions emulator job (x86_64) that installs the APK, cold-starts it and saves `logcat` crash output, so a crash comes with a real stack trace.
- Final change log: confirmed causes, files changed, commands run, and what is still unverified.

## Technical details
- Key files: `vite.config.ts`, `package.json`, `capacitor.config.ts`, `.github/workflows/android_build.yml`, `src/pages/Index.tsx`, `src/lib/onion-engine.ts`, `src/lib/outbox.ts`, `src/lib/dexie-db.ts`, `src/lib/crypto*.ts`, `src/components/ChatRoom.tsx`, `TorTransportPlugin.java`, `TorOnionService.java`, `OnionFrameQueue.java`, `TorNativeSupport.java`, `AndroidManifest.xml`, `proguard-rules.pro`.
- Wire format change (encrypted envelope + app ACK) is not compatible with APKs already installed; both phones need the new build.
