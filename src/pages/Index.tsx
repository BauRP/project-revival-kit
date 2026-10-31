import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import BottomNav from "@/components/BottomNav";
import ChatList from "@/components/ChatList";
import ChatRoom from "@/components/ChatRoom";
import AddFriend from "@/components/AddFriend";
import FriendsList from "@/components/FriendsList";
import ProfilePage from "@/components/ProfilePage";
import SecurityDashboard from "@/components/SecurityDashboard";
import TabbedWorkspace from "@/components/TabbedWorkspace";
import type { ChatFolder } from "@/hooks/useFolders";
import FloatingVideoHost from "@/components/FloatingVideoHost";
import { useIdentity } from "@/contexts/IdentityContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  onP2PMessage,
  onConnectionChange,
  connectToPeer,
  purgeExpiredLocalMessages,
  saveChatMeta,
  getChatMeta,
  type P2PMessage,
} from "@/lib/p2p";
import { startMediaCacheMonitor } from "@/lib/dexie-db";
import { TransportStatusChip } from "@/components/TransportStatusChip";
import { executePanic, createPanicLongPress } from "@/lib/panic";
import { startPresence, setInvisibleMode } from "@/lib/presence";
import { listenForFriendRequests, acceptFriendRequest } from "@/lib/sync/peer-sync";
import { initMockPeer } from "@/lib/mock-peer";
import { LAYOUT_CONFIG, getAppTopOffset, getBottomNavOffset } from "@/lib/layout-metrics";
import { toast } from "sonner";
import { useBiometricAuth } from "@/hooks/useBiometricAuth";
import { useBackNavigation } from "@/hooks/useBackNavigation";

type Tab = "chats" | "add-friend" | "friends" | "security" | "profile";

const BIOMETRIC_GRACE_PERIOD = 5000; // 5 seconds

const Index = () => {
  const [activeTab, setActiveTab] = useState<Tab>("chats");
  const [openChat, setOpenChat] = useState<{ id: string; name: string; emoji: string } | null>(
    null,
  );
  const [activeFolder, setActiveFolder] = useState<ChatFolder | null>(null);
  const [biometricLocked, setBiometricLocked] = useState(false);
  const { userId, stealthMode } = useIdentity();
  const { language } = useLanguage();
  const { isEnabled: biometricEnabled, isLocked: hookLocked, authenticate } = useBiometricAuth();
  const backgroundTimestamp = useRef<number>(0);

  const panicHandlers = useMemo(() => createPanicLongPress(executePanic), []);

  // Biometric Guard: lock after 5s in background
  useEffect(() => {
    if (!biometricEnabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        backgroundTimestamp.current = Date.now();
      } else {
        const elapsed = Date.now() - backgroundTimestamp.current;
        if (elapsed > BIOMETRIC_GRACE_PERIOD && backgroundTimestamp.current > 0) {
          setBiometricLocked(true);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [biometricEnabled]);

  const handleUnlock = useCallback(async () => {
    const success = await authenticate();
    if (success) {
      setBiometricLocked(false);
    }
  }, [authenticate]);

  // Auto-prompt on lock
  useEffect(() => {
    if (biometricLocked) {
      handleUnlock();
    }
  }, [biometricLocked, handleUnlock]);

  // Invisible Mode → presence ONLY. Never touches ad rendering.
  useEffect(() => {
    setInvisibleMode(stealthMode, userId || undefined);
  }, [stealthMode, userId]);

  useEffect(() => {
    if (!userId) return;
    // Bring up the transport stack. On NATIVE Android this boots the full Tor
    // hidden-service engine + foreground service; in the WEB PREVIEW every
    // native bridge reports "unavailable" and the stack keeps working purely
    // against IndexedDB. Each call is individually guarded so a single failing
    // subsystem can never blank the whole UI.
    let disposed = false;
    let bootTimer: number | undefined;
    let paintFrame: number | undefined;
    let stopPresence: (() => void) | undefined;

    // Two animation frames guarantee that React's initial UI has been committed
    // and presented before crypto, IndexedDB and the native Tor service start.
    // This keeps first launch responsive and prevents native/JNI work from
    // competing with WebView creation on Android's main thread.
    paintFrame = window.requestAnimationFrame(() => {
      paintFrame = window.requestAnimationFrame(() => {
        bootTimer = window.setTimeout(() => {
          if (disposed) return;

          try {
            startMediaCacheMonitor();
          } catch (err) {
            console.warn("[trivo] media cache monitor failed:", err);
          }
          // Tor (Stage B) is started by <TransportStatusChip>, after the UI is
          // idle and visible, so no JNI/foreground-service work happens here.
          try {
            stopPresence = startPresence(userId);
          } catch (err) {
            console.warn("[trivo] startPresence failed:", err);
          }

          void initMockPeer(language).catch((err) => {
            console.warn("[trivo] local support initialization failed:", err);
          });
        }, 250);
      });
    });

    // Listen for incoming friend requests
    const unsubFriendReq = listenForFriendRequests(userId, async (req) => {
      const existing = await getChatMeta(req.from);
      if (!existing) {
        await saveChatMeta({
          friendId: req.from,
          friendName: req.fromName || req.from.substring(0, 8),
          lastMessage: "",
          lastMessageTime: req.timestamp,
          unread: 0,
          started: false,
        });
        await acceptFriendRequest(req.from);
        toast.info(`${req.fromName || "Someone"} added you as a friend`);
      }
    });

    const unsubMsg = onP2PMessage(async (msg: P2PMessage) => {
      // The onion engine deduplicates by committed message ID in Dexie.
      // Never share a 'seen' flag with ChatRoom: both listeners must run.
      const existing = await getChatMeta(msg.from);
      await saveChatMeta({
        friendId: msg.from,
        friendName: existing?.friendName || msg.from.substring(0, 8),
        friendAvatar: existing?.friendAvatar,
        lastMessage: msg.text || "New message",
        lastMessageTime: msg.timestamp,
        unread: (existing?.unread || 0) + 1,
        started: true,
      });
    });

    const unsubConn = onConnectionChange((peerId, connected) => {
      if (connected) connectToPeer(peerId);
    });

    return () => {
      disposed = true;
      if (paintFrame !== undefined) window.cancelAnimationFrame(paintFrame);
      if (bootTimer !== undefined) window.clearTimeout(bootTimer);
      try {
        unsubMsg();
      } catch {
        /* noop */
      }
      try {
        unsubConn();
      } catch {
        /* noop */
      }
      try {
        unsubFriendReq();
      } catch {
        /* noop */
      }
      try {
        stopPresence?.();
      } catch {
        /* noop */
      }
    };
  }, [userId, language]);

  useEffect(() => {
    const purgeExpired = async () => {
      await purgeExpiredLocalMessages();
    };

    purgeExpired().catch(() => {});
    const interval = window.setInterval(() => {
      purgeExpired().catch(() => {});
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);

  const handleOpenChat = (id: string, name: string, emoji: string) => {
    setOpenChat({ id, name, emoji });
  };

  // Hardware/web Back closes the open chat first.
  const closeOpenChat = useCallback(() => {
    setOpenChat(null);
  }, []);
  useBackNavigation(!!openChat, closeOpenChat);

  // Biometric lock screen — full blur overlay to prevent data peeking
  const lockActive = biometricLocked || hookLocked;
  const biometricOverlay = lockActive ? (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Blur layer: prevents reading underlying chat content */}
      <div
        className="absolute inset-0 bg-background/80"
        style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
      />
      <div className="relative z-10 glass-panel neon-border rounded-2xl p-8 text-center space-y-4 mx-6 max-w-sm">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto neon-glow">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-foreground">Trivo Locked</h2>
        <p className="text-sm text-muted-foreground">Use biometric authentication to unlock</p>
        <button
          onClick={handleUnlock}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold neon-glow"
        >
          Unlock
        </button>
      </div>
    </div>
  ) : null;

  // The app is ad-free: the shell claims the full viewport height and
  // only reserves the OS safe-area inset at the top.
  const rootStyle = {
    backgroundImage: "var(--gradient-bg)",
    paddingTop: "env(safe-area-inset-top, 0px)",
    height: "100dvh",
    boxSizing: "border-box" as const,
    ["--bottom-nav-offset" as string]: getBottomNavOffset(),
    ["--bottom-nav-height" as string]: `${LAYOUT_CONFIG.BOTTOM_NAV_HEIGHT}px`,
    ["--app-top-offset" as string]: getAppTopOffset(),
  } as React.CSSProperties;

  if (openChat) {
    return (
      <div className="w-full flex flex-col overflow-hidden" style={rootStyle}>
        {biometricOverlay}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ChatRoom
            chatId={openChat.id}
            name={openChat.name}
            emoji={openChat.emoji}
            onBack={() => setOpenChat(null)}
          />
        </div>
        <FloatingVideoHost
          onExpand={() => {
            /* already inside the chat */
          }}
        />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col overflow-hidden" style={rootStyle}>
      {biometricOverlay}
      {/* Panic gesture hotspot. Anchored to the TOP-CENTER: the top-left corner
          holds the "ВСЕ" folder tab and the top-right corner holds the Profile
          "Settings" button — this invisible layer was swallowing both. It also
          sits below interactive chrome (z-30) so it can never block a control. */}
      <div
        {...panicHandlers}
        className="absolute left-1/2 -translate-x-1/2 w-12 h-12 z-30 safe-top-offset"
        aria-hidden="true"
      />

      <div
        className="flex-1 min-h-0 overflow-hidden"
        style={{ paddingBottom: getBottomNavOffset() }}
      >
        <div key={activeTab} className="h-full overflow-y-auto scrollbar-hide">
          {activeTab === "chats" && (
            <div className="flex flex-col h-full">
              <TabbedWorkspace onActiveFolderChange={(f) => setActiveFolder(f)} />
              {userId && (
                <div className="flex justify-end px-3 py-1">
                  <TransportStatusChip userId={userId} />
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-hidden">
                <ChatList
                  onOpenChat={handleOpenChat}
                  activeFolderId={activeFolder?.id || null}
                  isSystemFolder={!!activeFolder?.is_system}
                />
              </div>
            </div>
          )}
          {activeTab === "add-friend" && <AddFriend />}
          {activeTab === "friends" && <FriendsList onOpenChat={handleOpenChat} />}
          {activeTab === "security" && <SecurityDashboard />}
          {activeTab === "profile" && <ProfilePage />}
        </div>
      </div>
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      <FloatingVideoHost
        onExpand={() => {
          /* future: route back to source chat */
        }}
      />
    </div>
  );
};

export default Index;
