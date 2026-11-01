import {
  Shield,
  Key,
  Fingerprint,
  Lock,
  Wifi,
  RefreshCw,
  Activity,
  Zap,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import { onionCurrentStatus, onionOnStatus, onionInit } from "@/lib/onion-engine";
import { motion } from "framer-motion";
import { useIdentity } from "@/contexts/IdentityContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBiometricAuth } from "@/hooks/useBiometricAuth";

const SecurityDashboard = () => {
  const { identity, fingerprint, stealthMode } = useIdentity();
  const { t } = useLanguage();
  const { isEnabled: biometricEnabled } = useBiometricAuth();
  // Key Information accordion — collapsed by default to save vertical space.
  const [keysOpen, setKeysOpen] = useState(false);
  const [torState, setTorState] = useState(() => onionCurrentStatus());
  const [reconnecting, setReconnecting] = useState(false);
  const [torRetryError, setTorRetryError] = useState<string | null>(null);
  useEffect(() => onionOnStatus(setTorState), []);
  const torConnected = torState.running && torState.bootstrapped && !!torState.onion && !torState.lastError;
  const torStatusText = torConnected
    ? "Tor подключён — скрытый сервис активен"
    : torState.running
      ? `Tor подключается — ${torState.bootstrapPercent}%`
      : "Tor отключён";

  const statusItems = [
    {
      icon: Lock,
      label: t("encryptionStatus"),
      value: t("e2eeActive"),
      color: "text-primary",
      active: true,
    },
    {
      icon: Fingerprint,
      label: t("biometricLock"),
      value: biometricEnabled ? t("active") : t("inactive"),
      color: "text-pink-400",
      active: biometricEnabled,
    },
    {
      icon: stealthMode ? EyeOff : Eye,
      label: t("stealthMode"),
      value: stealthMode ? t("active") : t("inactive"),
      color: stealthMode ? "text-primary" : "text-muted-foreground",
      active: stealthMode,
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="header-safe-zone px-4 pb-3 shrink-0">
        <h1 className="text-xl font-bold gradient-text">{t("security")}</h1>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {/* Shield Icon — separated from the list below with a fixed bottom gap */}
        <div
          className="flex justify-center mb-8"
          style={{ paddingTop: "0.75rem", paddingBottom: "0.5rem" }}
        >
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center neon-glow"
          >
            <Shield size={34} className="text-primary" />
          </motion.div>
        </div>

        {/* 1. Encryption  2. Biometric Lock  3. Stealth Mode */}
        <div className="px-4 space-y-1.5">
          {statusItems.map(({ icon: Icon, label, value, color, active }) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl glass-panel-sm neon-border"
            >
              <Icon
                size={20}
                className={color}
                style={active ? { filter: "drop-shadow(0 0 4px currentColor)" } : {}}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className={`text-xs ${active ? "text-primary" : "text-muted-foreground"}`}>
                  {value}
                </p>
              </div>
              {/* Read-only status badge */}
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full ${active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {active ? t("active") : t("inactive")}
              </span>
            </motion.div>
          ))}
        </div>

        <div className="px-4 mt-1.5 space-y-1.5 pb-6">
          {/* 4. P2P Network */}
          <div className="glass-panel-sm neon-border rounded-xl p-3">
            <div className="flex items-start gap-3">
              <Wifi size={18} className="text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t("p2pNetwork")}</p>
                <p className={`text-xs mt-1 ${torConnected ? "text-primary" : "text-muted-foreground"}`} role="status" aria-live="polite">{torStatusText}</p>
                {(torRetryError || torState.lastError) && (
                  <p className="text-xs text-destructive mt-1 break-words">{torRetryError || torState.lastError}</p>
                )}
                {!torConnected && (
                  <button
                    type="button"
                    disabled={reconnecting}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary disabled:opacity-50"
                    onClick={() => {
                      setTorRetryError(null);
                      setReconnecting(true);
                      void onionInit().catch((error) =>
                        setTorRetryError(error instanceof Error ? error.message : String(error)),
                      ).finally(() => setReconnecting(false));
                    }}
                  >
                    <RefreshCw size={12} className={reconnecting ? "animate-spin" : ""} />
                    {reconnecting ? "Подключение…" : "Подключить Tor повторно"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 5. Key Info — collapsible accordion (collapsed by default), always last */}
          <button
            type="button"
            onClick={() => setKeysOpen((open) => !open)}
            aria-expanded={keysOpen}
            aria-controls="security-key-info"
            className="w-full flex items-center gap-2 px-1 py-1.5 mt-2"
          >
            <span className="flex-1 min-w-0 text-left text-xs text-muted-foreground font-medium truncate">
              {t("localKeyInfo")}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {keysOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </span>
          </button>

          {keysOpen && (
            <div
              id="security-key-info"
              className="glass-panel neon-border rounded-xl p-3 space-y-2.5"
            >
              <div className="flex items-center gap-3">
                <Fingerprint
                  size={18}
                  className="text-pink-400"
                  style={{ filter: "drop-shadow(0 0 4px #f472b6)" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{t("keyFingerprint")}</p>
                  <p className="text-sm font-mono text-foreground truncate">
                    {fingerprint || "..."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Key
                  size={18}
                  className="text-yellow-400"
                  style={{ filter: "drop-shadow(0 0 4px #facc15)" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{t("signingKey")}</p>
                  <p className="text-sm font-mono text-foreground truncate">
                    {identity?.signing.publicKey.substring(0, 24)}...
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Zap
                  size={18}
                  className="text-blue-400"
                  style={{ filter: "drop-shadow(0 0 4px #60a5fa)" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{t("exchangeKey")}</p>
                  <p className="text-sm font-mono text-foreground truncate">
                    {identity?.exchange.publicKey.substring(0, 24)}...
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Activity
                  size={18}
                  className="text-purple-400"
                  style={{ filter: "drop-shadow(0 0 4px #a78bfa)" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{t("pqxdhStatus")}</p>
                  <p className="text-sm text-muted-foreground font-medium">Постквантовая защита не подтверждена</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SecurityDashboard;
