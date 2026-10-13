# Roadmap (stabilization plan)

- [x] Phase 1a: build pipeline uses the real output `dist/client` (package.json, capacitor.config.ts, CI, verify script)
- [x] Phase 1b: Tor starts after the UI (TransportStatusChip, retry), no silent background service fallback
- [x] Phase 1c: CI unified on www/ + bun frozen install, universal APK selection, libtor.so per-ABI audit step, GitHub artifact upload (tor-android 0.4.5.7 AAR verified to ship all 4 ABIs)
- [ ] Phase 1c-run: first green CI run on GitHub (needs a push; cannot run Gradle CI here)
- [x] Phase 2: WebRTC/WSS removed; identity = .onion derived from the Ed25519 key
- [x] Phase 3: sealed E2EE frames, Dexie outbox + inbox_raw, DELIVERED_ACK
- [ ] Phase 4: lint cleanup, CI emulator job with logcat capture, final change log
