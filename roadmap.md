# Roadmap (stabilization plan)

- [x] Phase 1a: build pipeline uses the real output `dist/client` (package.json, capacitor.config.ts, CI, verify script)
- [x] Phase 1b: Tor starts after the UI (TransportStatusChip, retry), no silent background service fallback
- [ ] Phase 1c: build debug + release APKs and audit libtor.so per ABI / R8-kept classes
- [x] Phase 2: WebRTC/WSS removed; identity = .onion derived from the Ed25519 key
- [x] Phase 3: sealed E2EE frames, Dexie outbox + inbox_raw, DELIVERED_ACK
- [ ] Phase 4: lint cleanup, CI emulator job with logcat capture, final change log
