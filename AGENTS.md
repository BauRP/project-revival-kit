<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Peer identity is the v3 .onion derived from the user's Ed25519 key (src/lib/onion-id.ts); never introduce other peer IDs — the address itself authenticates the key.
- Every Tor frame is sealed via src/lib/envelope.ts before TorTransport.send; queues (outbox, inbox_raw) live only in Dexie — native code keeps no message queue.
- "Delivered" status comes only from the peer's DELIVERED_ACK, sent after its Dexie commit.
- Capacitor webDir is `www/`, filled only by scripts/stage-web.mjs from the real build (dist/client or .output/public, resolved in scripts/web-dir.mjs); why: build output location differs between environments, staging gives one verified path.
- CI installs with `bun install --frozen-lockfile` and publishes APKs via actions/upload-artifact only; why: reproducible builds and no third-party file hosts.
