import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw, Copy } from "lucide-react";
import {
  getLastFatalError,
  reportFatalError,
  clearFatalError,
  subscribeToFatalErrors,
  type FatalErrorRecord,
} from "@/lib/boot-guard";
import { bridgeInfo } from "@/lib/native-bridge";
import { isStorageAvailable } from "@/lib/safe-storage";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  record: FatalErrorRecord | null;
  copied: boolean;
}

/**
 * Root-level crash recovery boundary.
 *
 * Renders the Emergency Diagnostic Screen (dark mode) with the exact error
 * message, stack trace and environment details, plus a "Reload App" button.
 * Because it is mounted above every provider, a throw in identity/crypto/Dexie
 * initialisation degrades to this screen instead of an empty WebView, which is
 * what Android reports as "keeps stopping".
 */
class ErrorBoundary extends Component<Props, State> {
  private unsubscribeFatal: (() => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, record: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      record: {
        message: error.message || error.name || "Unknown error",
        stack: error.stack || "",
        source: "react",
        at: Date.now(),
      },
    };
  }

  componentDidMount() {
    this.unsubscribeFatal = subscribeToFatalErrors((record) => {
      this.setState({ hasError: true, record, copied: false });
    });
    const existing = getLastFatalError();
    if (existing) this.setState({ hasError: true, record: existing, copied: false });
  }

  componentWillUnmount() {
    this.unsubscribeFatal?.();
    this.unsubscribeFatal = null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const record = reportFatalError(error, "react");
    const componentStack = info?.componentStack ? `\n\nComponent stack:${info.componentStack}` : "";
    this.setState({
      hasError: true,
      record: { ...record, stack: `${record.stack}${componentStack}` },
    });
  }

  handleRestart = () => {
    clearFatalError();
    this.setState({ hasError: false, record: null, copied: false });
  };

  handleReload = () => {
    try {
      window.location.reload();
    } catch {
      this.handleRestart();
    }
  };

  handleCopy = async () => {
    const record = this.state.record ?? getLastFatalError();
    const text = `${record?.message ?? "Unknown error"}\n\n${record?.stack ?? ""}`;
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const record = this.state.record ?? getLastFatalError();
    const info = bridgeInfo();
    const storageOk = isStorageAvailable("localStorage");

    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#08090d",
          color: "#e8ecf5",
          padding: "24px 16px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          overflowY: "auto",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            borderRadius: 20,
            padding: 20,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                background: "rgba(255,80,80,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <AlertTriangle size={22} color="#ff6b6b" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Emergency Diagnostics</h1>
              <p style={{ margin: 0, fontSize: 12.5, color: "rgba(232,236,245,0.6)" }}>
                The app was stopped safely — your keys and messages are untouched.
              </p>
            </div>
          </div>

          <div
            style={{
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(0,0,0,0.35)",
              padding: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: 0.4, color: "rgba(232,236,245,0.45)" }}>
              ERROR
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#ff9d9d", wordBreak: "break-word" }}>
              {record?.message ?? "Unknown error"}
            </div>
          </div>

          <div
            style={{
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(0,0,0,0.35)",
              padding: 12,
              marginBottom: 12,
              maxHeight: 260,
              overflow: "auto",
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: 0.4,
                color: "rgba(232,236,245,0.45)",
                marginBottom: 6,
              }}
            >
              STACK TRACE
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 11.5,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "rgba(232,236,245,0.8)",
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
              }}
            >
              {record?.stack || "No stack trace available."}
            </pre>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              fontSize: 11.5,
              color: "rgba(232,236,245,0.55)",
              marginBottom: 16,
            }}
          >
            <span>platform: {info.platform}</span>
            <span>·</span>
            <span>native: {String(info.native)}</span>
            <span>·</span>
            <span>storage: {storageOk ? "ok" : "memory fallback"}</span>
            <span>·</span>
            <span>source: {record?.source ?? "react"}</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 12,
                padding: "12px 18px",
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid #4f7cff",
                background: "#4f7cff",
                color: "#fff",
              }}
            >
              <RotateCcw size={16} />
              Reload App
            </button>
            <button
              type="button"
              onClick={this.handleRestart}
              style={{
                cursor: "pointer",
                borderRadius: 12,
                padding: "12px 18px",
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.06)",
                color: "#e8ecf5",
              }}
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={this.handleCopy}
              style={{
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 12,
                padding: "12px 18px",
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.06)",
                color: "#e8ecf5",
              }}
            >
              <Copy size={16} />
              {this.state.copied ? "Copied" : "Copy report"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
