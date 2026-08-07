/**
 * Trivo Elite — Connection Manager
 *
 * Group A: STUN nodes (WebRTC / NAT traversal / signalling).
 * Group B: WSS relay nodes (data sync redundancy).
 *
 * Algorithm:
 *  - Sequential failover (<=200 ms switch to next node).
 *  - Infinite circular rotation across each pool.
 *  - Background "resurrection" ping every 45 s for offline nodes.
 *  - Priority recovery: if any STUN node returns, signalling falls back to Group A.
 *
 * Runs entirely in the browser/web worker context. The Android-side foreground
 * service is provided by the native shell (legacy/android) — this module is the
 * cross-platform JS core consumed by both web and Capacitor builds.
 */

export type NodeKind = "stun" | "wss";

export interface NetNode {
  url: string;
  kind: NodeKind;
  online: boolean;
  lastCheck: number;
  failures: number;
}

// ───────────────────────────── Group A — STUN ──────────────────────────────
export const STUN_NODES: string[] = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun2.l.google.com:19302",
  "stun:stun3.l.google.com:19302",
  "stun:stun4.l.google.com:19302",
  "stun:stun.ekiga.net:3478",
  "stun:stun.ideasip.com:3478",
  "stun:stun.voiparound.com:3478",
  "stun:stun.voipbuster.com:3478",
  "stun:stun.voipstunt.com:3478",
];

// ──────────────────────── Group B — WSS data relay ─────────────────────────
export const WSS_NODES: string[] = [
  "wss://echo.websocket.org",
  "wss://ws.postman-echo.com",
  "wss://sockets.sh",
  "wss://stream.binance.com:9443/ws/btcusdt",
  "wss://demo.piesocket.com/v3/channel_1?api_key=VCXCEuvhGcBDP7XhiIMUDvDxWTOaTEOftXUsWVT4",
  "wss://free.blr2.piesocket.com/v3/channel_1?api_key=o8SEPMpTsu8mYVOTsBwM3MA6mVDk7A&notify_self=1",
  "wss://ws.ifelse.io",
  "wss://ws-feed.exchange.coinbase.com",
  "wss://fstream.binance.com/ws/btcusdt",
  "wss://www.bitmex.com/realtime",
  "wss://api.gemini.com/v1/marketdata/BTCUSD",
  "wss://pubsub.pubnub.com/v2/subscribe/sub-c-52a9ab50-816d-11df-92a0-60f8122ab307/demo-channel",
  "wss://sockets.pasv.us",
  "wss://ws.vi-board.com/ws",
  "wss://demo.piesocket.com/v3/channel_2?api_key=VCXCEuvhGcBDP7XhiIMUDvDxWTOaTEOftXUsWVT4",
  "wss://ws.blockchain.info/inv",
  "wss://streaming.bitfinex.com/ws/2",
  "wss://ws.kraken.com",
  "wss://streamer.cryptocompare.com/v2?api_key=demo",
  "wss://ws-ie.pusher.com/app/1?protocol=7&client=js&version=7.0.0&flash=false",
  "wss://echo.websocket.in",
  "wss://ws.coincap.io/v2/assets",
  "wss://socket.polygon.io/stocks",
  "wss://ws.bitstamp.net",
  "wss://api.bybit.com/v5/public/spot",
  "wss://api.huobi.pro/ws",
  "wss://stream.bytick.com/realtime",
  "wss://www.okx.com/ws/v3/public",
  "wss://api.gateio.ws/ws/v4/",
  "wss://ws.derivws.com/websockets/v3?app_id=1089",
];

const FAILOVER_MS = 200;
const RESURRECT_INTERVAL_MS = 45_000;

function makeNodes(urls: string[], kind: NodeKind): NetNode[] {
  return urls.map((url) => ({ url, kind, online: true, lastCheck: 0, failures: 0 }));
}

class ConnectionManager {
  private stun: NetNode[] = makeNodes(STUN_NODES, "stun");
  private wss: NetNode[] = makeNodes(WSS_NODES, "wss");
  private stunIdx = 0;
  private wssIdx = 0;
  private resurrectTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(active: NetNode | null, kind: NodeKind) => void>();

  start() {
    if (this.resurrectTimer) return;
    this.resurrectTimer = setInterval(() => this.resurrectionSweep(), RESURRECT_INTERVAL_MS);
  }

  stop() {
    if (this.resurrectTimer) clearInterval(this.resurrectTimer);
    this.resurrectTimer = null;
  }

  /** Full RTCConfiguration STUN list (Group A). */
  iceServers(): RTCIceServer[] {
    return this.stun.filter((n) => n.online).map((n) => ({ urls: n.url }));
  }

  /** Currently active STUN. */
  activeStun(): NetNode | null {
    return this.pickActive(this.stun, this.stunIdx);
  }

  /** Currently active WSS relay. */
  activeWss(): NetNode | null {
    return this.pickActive(this.wss, this.wssIdx);
  }

  /** Mark current node failed and rotate within ≤200 ms. */
  async reportFailure(kind: NodeKind): Promise<NetNode | null> {
    const pool = kind === "stun" ? this.stun : this.wss;
    const idx = kind === "stun" ? this.stunIdx : this.wssIdx;
    const node = pool[idx];
    if (node) {
      node.online = false;
      node.failures += 1;
      node.lastCheck = Date.now();
    }
    await new Promise((r) => setTimeout(r, FAILOVER_MS));
    return this.advance(kind);
  }

  /** Manually advance to next node (circular). */
  advance(kind: NodeKind): NetNode | null {
    const pool = kind === "stun" ? this.stun : this.wss;
    for (let step = 0; step < pool.length; step++) {
      const next = kind === "stun"
        ? (this.stunIdx = (this.stunIdx + 1) % pool.length)
        : (this.wssIdx = (this.wssIdx + 1) % pool.length);
      if (pool[next].online) {
        this.emit(pool[next], kind);
        return pool[next];
      }
    }
    return null;
  }

  /** Open a managed WebSocket with auto-failover across Group B. */
  openSocket(onMessage?: (ev: MessageEvent) => void): { close: () => void } {
    let closed = false;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      const node = this.activeWss();
      if (!node) return;
      try {
        socket = new WebSocket(node.url);
        socket.onopen = () => {
          node.online = true;
          node.failures = 0;
          this.emit(node, "wss");
        };
        socket.onmessage = (ev) => onMessage?.(ev);
        socket.onerror = async () => {
          await this.reportFailure("wss");
          connect();
        };
        socket.onclose = async () => {
          if (closed) return;
          await this.reportFailure("wss");
          connect();
        };
      } catch {
        void this.reportFailure("wss").then(connect);
      }
    };

    connect();
    return {
      close: () => {
        closed = true;
        try { socket?.close(); } catch { /* noop */ }
      },
    };
  }

  /** Subscribe to active-node changes (priority recovery / failover). */
  onChange(cb: (active: NetNode | null, kind: NodeKind) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  // ───────────────────────────── internals ─────────────────────────────────
  private pickActive(pool: NetNode[], idx: number): NetNode | null {
    const cur = pool[idx];
    if (cur?.online) return cur;
    for (let i = 1; i <= pool.length; i++) {
      const n = pool[(idx + i) % pool.length];
      if (n.online) return n;
    }
    return null;
  }

  private emit(node: NetNode | null, kind: NodeKind) {
    this.listeners.forEach((l) => { try { l(node, kind); } catch { /* noop */ } });
  }

  /** Silent ping sweep — re-promotes nodes that recover. */
  private async resurrectionSweep() {
    const offline = [...this.stun, ...this.wss].filter((n) => !n.online);
    await Promise.all(offline.map((n) => this.ping(n)));
    // Priority Recovery: if any STUN came back, snap signalling back to Group A.
    const firstAlive = this.stun.findIndex((n) => n.online);
    if (firstAlive >= 0 && !this.stun[this.stunIdx].online) {
      this.stunIdx = firstAlive;
      this.emit(this.stun[firstAlive], "stun");
    }
  }

  private ping(node: NetNode): Promise<void> {
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        node.online = ok;
        node.lastCheck = Date.now();
        if (ok) {
          node.failures = 0;
          this.emit(node, node.kind);
        }
        resolve();
      };

      if (node.kind === "stun") {
        try {
          const pc = new RTCPeerConnection({ iceServers: [{ urls: node.url }] });
          let settled = false;
          pc.onicecandidate = (ev) => {
            if (settled) return;
            if (ev.candidate && /typ (srflx|relay)/.test(ev.candidate.candidate)) {
              settled = true; pc.close(); done(true);
            }
          };
          pc.createDataChannel("p");
          pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
          setTimeout(() => { if (!settled) { pc.close(); done(false); } }, 4000);
        } catch { done(false); }
        return;
      }

      // wss probe
      try {
        const ws = new WebSocket(node.url);
        const timer = setTimeout(() => { try { ws.close(); } catch {} done(false); }, 4000);
        ws.onopen = () => { clearTimeout(timer); try { ws.close(); } catch {} done(true); };
        ws.onerror = () => { clearTimeout(timer); done(false); };
      } catch { done(false); }
    });
  }
}

export const connectionManager = new ConnectionManager();
if (typeof window !== "undefined") connectionManager.start();
