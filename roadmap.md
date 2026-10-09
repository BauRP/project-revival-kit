# Roadmap (stabilization plan)

- [x] Phase 1a: build pipeline uses the real output `dist/client` (package.json, capacitor.config.ts, CI, verify script)
- [x] Phase 1b: Tor starts after the UI (TransportStatusChip, retry), no silent background service fallback
- [ ] Phase 1c: build debug + release APKs and audit libtor.so per ABI / R8-kept classes
- [ ] Phase 2: remove WebRTC/WSS legacy path, single canonical peer ID
- [ ] Phase 3: E2E encryption on text path, transactional inbound queue, app-level ACK
- [ ] Phase 4: lint cleanup, CI emulator job with logcat capture, final change log
