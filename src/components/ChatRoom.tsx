import {
  ArrowLeft,
  FileText,
  Check,
  CheckCheck,
  Phone,
  Video,
  Flag,
  Download,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Search,
  Pin,
  X,
  CornerUpLeft,
  Languages,
  BellOff,
  MoreVertical,
  TimerReset,
  Eye,
  Star,
  StarOff,
  Ban,
  VolumeX,
  Trash2,
  Archive,
  ArchiveRestore,
  FolderPlus,
  UserMinus,
} from "lucide-react";
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import CustomEmojiPicker from "./CustomEmojiPicker";
import { Share } from "@capacitor/share";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useIdentity } from "@/contexts/IdentityContext";
import DefaultAvatar from "./DefaultAvatar";
import CallScreen from "./CallScreen";
import ReportMenu from "./ReportMenu";
import { uploadMedia, formatFileSize, type MediaAttachment } from "@/lib/media";
import { ensureMediaUrl, purgeConsumedMedia, TRIVO_MAX_UPLOAD_BYTES } from "@/lib/media-store";
import { subscribeToPresence, getPresenceStatus } from "@/lib/presence";
import { onionOnConnectionChange, onionIsConnectedTo } from "@/lib/onion-engine";
import { dxdb, getContactLastSeen, setContactLastSeen } from "@/lib/dexie-db";
import { toast } from "@/hooks/use-toast";
import { generateUUIDv4 } from "@/lib/local-peer-cache";
import {
  simulateSecurityScan,
  stripExifMetadata,
  getBlockedFileMessage,
} from "@/lib/security-scan";
import {
  sendP2PMessage,
  getMessagesForChat,
  onP2PMessage,
  connectToPeer,
  onDeliveryUpdate,
  saveLocalMessage,
  saveChatMeta,
  getChatMeta,
  type P2PMessage,
} from "@/lib/p2p";
import { sendReadReceipt, listenForReadReceipts } from "@/lib/sync/peer-sync";
import { isValidOnion } from "@/lib/onion-id";
import { getLocalHistoryProtection, getRemoteHistoryProtection, setLocalHistoryProtection, onLocalHistoryProtection, onRemoteHistoryProtection, HISTORY_PROTECTION_NOTICE } from "@/lib/history-protection";
import {
  subscribeLifecycle,
  editMessage as fsEditMessage,
  deleteMessageForMe as fsDeleteForMe,
  deleteMessageForEveryone as fsDeleteForEveryone,
  pinMessage as fsPinMessage,
  unpinMessage as fsUnpinMessage,
  type MessageLifecycle,
} from "@/lib/sync/message-lifecycle";
import AudioWaveformPlayer from "./AudioWaveformPlayer";
import SecurityScanOverlay from "./SecurityScanOverlay";
import MessageInput from "./MessageInput";
import ChatSelectionBar from "./ChatSelectionBar";
import ChatSearchBar from "./ChatSearchBar";
import ForwardMediaSheet from "./ForwardMediaSheet";
import TranslationPlate from "./TranslationPlate";
import AttachmentMenu from "./AttachmentMenu";
import PinnedHeader from "./PinnedHeader";
import DeleteMessageSheet from "./DeleteMessageSheet";
import UploadOverlay from "./UploadOverlay";
import DisappearingMessagesModal from "./DisappearingMessagesModal";
import ScheduleSheet from "./ScheduleSheet";
import OneTimeViewer from "./OneTimeViewer";
import OneTimeMediaBubble from "./OneTimeMediaBubble";
import RoundVideoRecorder from "./RoundVideoRecorder";
import { enqueue as enqueueOutbox, registerSender, type ScheduledItem } from "@/lib/outbox";
import {
  getChatPreferences,
  getDeleteAt,
  isExpired,
  updateChatPreferences,
  getMuteUntil,
  type DisappearingDuration,
} from "@/lib/chat-preferences";
import MuteModal from "./MuteModal";
import ContactAssignSheet from "./ContactAssignSheet";
import { blockUser, unblockUser } from "@/lib/report";
import { clearMessagesForChat } from "@/lib/p2p";
import { dbGet, dbPut, dbDelete } from "@/lib/storage";
import {
  notifyIncomingMessage,
  translateIncomingMessage,
  translateOutgoingInverse,
} from "@/lib/notifications";
import { useBackNavigation } from "@/hooks/useBackNavigation";

import { RichText } from "./SpoilerText";
import ReactionsBar, { type ReactionEmoji } from "./ReactionsBar";
import {
  aggregate as aggregateReactions,
  getReactions,
  toggleReaction,
  broadcastReaction,
  subscribeReactions,
  type ReactionMap,
} from "@/lib/reactions";
import LinkPreviewCard from "./LinkPreviewCard";
import SelectiveCopySheet from "./SelectiveCopySheet";
import { extractFirstUrl } from "@/lib/link-preview";
import ChatProfileSheet from "./ChatProfileSheet";
import { shouldBlockIncoming, moveToBlocked } from "@/lib/contacts-filter";
import { shouldAutoDownload } from "@/lib/data-saver";
import { isTrivoSupport, SUPPORT_BOT_NAME } from "@/lib/mock-peer";
import { supportBot } from "@/lib/support-bot";
// Phase 2 §4 — FloatingVideo hosting is owned by Index; ChatRoom only renders bubbles.

interface Message {
  id: string;
  text: string;
  sent: boolean;
  time: string;
  status: "pending" | "sent" | "delivered" | "read";
  media?: MediaAttachment;
  blocked?: boolean;
  blockedMessage?: { title: string; footer: string };
  caption?: string;
  deleteAt?: number;
  translatedText?: string | null;
  translating?: boolean;
  translateError?: boolean;
  /** Strict typed silent flag — recipient suppresses notification ping. */
  silent?: boolean;
  /** Media auto-purges after a single full-screen view. */
  oneTimeView?: boolean;
  /** When true, the media is a 1:1 round video (circular bubble). */
  roundVideo?: boolean;
  /** True once the recipient has viewed the one-time media (locally tombstoned). */
  oneTimeConsumed?: boolean;
  /** Non-erasable system notification bubble (e.g. disappearing-mode toggle). */
  system?: boolean;
}

interface ChatRoomProps {
  chatId: string;
  name: string;
  emoji: string;
  onBack: () => void;
}

// Phase 3 §4 — Data Saver: tap-to-download placeholder for media that the
// auto-download policy has paused on cellular.
const TapToDownload = ({
  label,
  sizeBytes,
  render,
  onDownload,
}: {
  label: string;
  sizeBytes?: number;
  render: () => React.ReactElement;
  onDownload?: () => Promise<void>;
}) => {
  const { t } = useLanguage();
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  if (loaded) return render();
  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => {
        if (!onDownload) { setLoaded(true); return; }
        setLoading(true);
        void onDownload().then(() => setLoaded(true)).catch((error) => {
          console.warn("[media] manual download failed", error);
        }).finally(() => setLoading(false));
      }}
      className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#00FFFF]/40 bg-black text-[#00FFFF] hover:bg-[#00FFFF]/10 transition-colors"
    >
      <Download size={14} />
      <span className="text-xs font-medium truncate max-w-[200px]">
        {t("tapToDownload")} — {label}
      </span>
      {sizeBytes ? (
        <span className="text-[10px] opacity-60">{formatFileSize(sizeBytes)}</span>
      ) : null}
    </button>
  );
};

const ChatRoom = ({ chatId, name: rawName, emoji, onBack }: ChatRoomProps) => {
  // The built-in system assistant always renders under its canonical title.
  const name = isTrivoSupport(chatId) ? SUPPORT_BOT_NAME : rawName;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [silent, setSilent] = useState(false);
  const [oneTimeView, setOneTimeView] = useState(false);
  const [showRoundVideo, setShowRoundVideo] = useState(false);
  const [viewerMessage, setViewerMessage] = useState<Message | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [callType, setCallType] = useState<"audio" | "video" | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Block 3 — Track current upload meta + a cancel hook so the overlay's "X"
  // can abort a hung media upload (or at least dismiss the UI immediately).
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(-1);
  const [uploadSizeLabel, setUploadSizeLabel] = useState<string>("");
  const uploadCancelRef = useRef<(() => void) | null>(null);
  const uploadCancelledRef = useRef(false);
  const [peerStatus, setPeerStatus] = useState<"online" | "away" | "offline">("offline");
  // Trivo Support (Bot): true while the offline NLP.js worker composes a reply.
  const [botTyping, setBotTyping] = useState(false);
  const [scanOverlay, setScanOverlay] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [forwardingMedia, setForwardingMedia] = useState<MediaAttachment | null>(null);
  const [forwardSheetOpen, setForwardSheetOpen] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [disappearingDuration, setDisappearingDuration] = useState<
    "1h" | "6h" | "12h" | "24h" | "off"
  >("off");
  const [lifecycle, setLifecycle] = useState<Record<string, MessageLifecycle>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; preview: string; sent: boolean } | null>(
    null,
  );
  // V6 §2 — Master Translator toggle. When ACTIVE the outgoing Mirror-Inverse swap
  // intercepts every send, replaces the input with the translated string, and
  // discards the original. When INACTIVE messages are sent as plain text.
  const [translatorActive, setTranslatorActive] = useState(false);
  // Phase 2 §5 — quick reactions (double-tap on bubble).
  const [reactions, setReactions] = useState<ReactionMap>({});
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  // Phase 2 §2 — selective copy sheet.
  const [copyTarget, setCopyTarget] = useState<string | null>(null);
  // Phase 2 §3 — live URL extracted from the input draft for OG preview.
  const draftUrl = useMemo(() => extractFirstUrl(input), [input]);
  const [draftPreviewDismissed, setDraftPreviewDismissed] = useState<string | null>(null);
  // Phase 3 §1 — Chat profile / media hub.
  const [profileOpen, setProfileOpen] = useState(false);
  // Header three-dot menu (Silent, One-time, Disappearing).
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [historyProtected, setHistoryProtected] = useState(false);
  const [peerHistoryProtected, setPeerHistoryProtected] = useState(false);
  const [disappearingModalOpen, setDisappearingModalOpen] = useState(false);
  // System bubbles (e.g. "Disappearing messages turned ON") — local, non-erasable.
  const [systemBubbles, setSystemBubbles] = useState<Message[]>([]);
  // Unified context-menu chat preferences (Mute / Block / Favorite / Archive).
  const [chatFavorite, setChatFavorite] = useState(false);
  const [chatBlocked, setChatBlocked] = useState(false);
  const [chatArchived, setChatArchived] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // Forward state — when sourcing from a text-only message, `forwardingText`
  // carries the payload (mutually exclusive with `forwardingMedia`).
  const [forwardingText, setForwardingText] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  // Scroll viewport + "is the user pinned to the bottom?" tracking.
  // The chat must open already at the bottom (no visible animation), and it
  // must NEVER yank the user back down once they've scrolled up to read.
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const didInitialJumpRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { t, language } = useLanguage();
  const { theme } = useTheme();
  const { userId } = useIdentity();

  // Back-navigation: pop overlays in priority order before exiting the chat.
  // Most-specific / most-recent overlay first.
  const anyOverlayOpen =
    showEmoji ||
    showAttach ||
    showReport ||
    forwardSheetOpen ||
    deleteSheetOpen ||
    searchOpen ||
    callType !== null ||
    selectedIds.length > 0 ||
    editingId !== null ||
    replyTo !== null;

  const handleBack = useCallback(() => {
    if (showEmoji) {
      setShowEmoji(false);
      return true;
    }
    if (showAttach) {
      setShowAttach(false);
      return true;
    }
    if (showReport) {
      setShowReport(false);
      return true;
    }
    if (forwardSheetOpen) {
      setForwardSheetOpen(false);
      return true;
    }
    if (deleteSheetOpen) {
      setDeleteSheetOpen(false);
      return true;
    }
    if (callType !== null) {
      setCallType(null);
      return true;
    }
    if (searchOpen) {
      setSearchOpen(false);
      setSearchQuery("");
      return true;
    }
    if (editingId) {
      setEditingId(null);
      return true;
    }
    // CAB / selection has priority over reply-quote so the user can dismiss
    // the contextual bar without losing their pending reply draft.
    if (selectedIds.length > 0) {
      setSelectedIds([]);
      return true;
    }
    if (replyTo) {
      setReplyTo(null);
      return true;
    }
    return false;
  }, [
    showEmoji,
    showAttach,
    showReport,
    forwardSheetOpen,
    deleteSheetOpen,
    callType,
    searchOpen,
    editingId,
    selectedIds.length,
    replyTo,
  ]);

  useBackNavigation(anyOverlayOpen, handleBack);
  // Block 2 — Translate is universal: every message (incoming AND outgoing)
  // gets a translation pass so the user can verify what the other side reads
  // and reread their own thoughts in the configured target language.
  const syncIncomingTranslations = async (items: Message[]) => {
    const translated = await Promise.all(
      items.map(async (message) => {
        if (!message.text.trim() || isExpired(message.deleteAt)) {
          return { ...message, translatedText: null };
        }

        const translatedText = await translateIncomingMessage(message.text);
        return { ...message, translatedText };
      }),
    );

    setMessages((prev) =>
      prev.map((message) => translated.find((item) => item.id === message.id) || message),
    );
  };

  useEffect(() => {
    // Reset immediately when switching chats; a previous peer's policy must
    // never appear as the new peer's protection state.
    setHistoryProtected(false);
    setPeerHistoryProtected(false);
    if (!isValidOnion(chatId)) return;
    let active = true;
    void getLocalHistoryProtection(chatId).then((v) => { if (active) setHistoryProtected(v.enabled); });
    void getRemoteHistoryProtection(chatId).then((v) => { if (active) setPeerHistoryProtected(v.enabled); });
    const offLocal = onLocalHistoryProtection(chatId, (v) => setHistoryProtected(v.enabled));
    const offRemote = onRemoteHistoryProtection(chatId, (v) => setPeerHistoryProtected(v.enabled));
    return () => { active = false; offLocal(); offRemote(); };
  }, [chatId]);

  // P2P lifecycle (edit / delete / pin) — source of truth
  useEffect(() => {
    if (!userId || !chatId) return;
    const unsub = subscribeLifecycle(userId, chatId, (map) => {
      setLifecycle(map);
    });
    return unsub;
  }, [userId, chatId]);

  // Phase 2 §5 — load reactions for the open chat.
  useEffect(() => {
    if (!chatId) return;
    void getReactions(chatId).then(setReactions);
    return subscribeReactions(chatId, setReactions);
  }, [chatId]);

  // Phase 2 §3 — when the user types a new URL, clear any prior dismissal so
  // the preview re-renders.
  useEffect(() => {
    if (draftUrl !== draftPreviewDismissed) setDraftPreviewDismissed(null);
  }, [draftUrl, draftPreviewDismissed]);

  // Double-tap detector — registers a tap and arms a 280ms window for the
  // second tap. We attach it to each bubble below.
  const lastTap = useRef<{ id: string; t: number } | null>(null);
  const handleBubbleTap = useCallback((id: string) => {
    const now = Date.now();
    if (lastTap.current && lastTap.current.id === id && now - lastTap.current.t < 280) {
      setReactionTarget(id);
      lastTap.current = null;
    } else {
      lastTap.current = { id, t: now };
    }
  }, []);

  const onPickReaction = useCallback(
    async (msgId: string, emoji: ReactionEmoji) => {
      if (!userId) return;
      const next = await toggleReaction(chatId, msgId, userId, emoji);
      setReactions(next);
      broadcastReaction(chatId, msgId, next[msgId]?.[userId] || null);
      setReactionTarget(null);
    },
    [chatId, userId],
  );

  const [lastSeen, setLastSeen] = useState<number | null>(null);

  useEffect(() => {
    setPeerStatus(getPresenceStatus(chatId));
    const unsub = subscribeToPresence(chatId);
    const interval = setInterval(() => {
      setPeerStatus(getPresenceStatus(chatId));
    }, 5000);
    // Real-time P2P online indicator overrides presence when an RTCDataChannel
    // is verified. On close we stamp lastSeen locally in Dexie and reflect it.
    if (onionIsConnectedTo(chatId)) setPeerStatus("online");
    void getContactLastSeen(chatId).then((ts) => setLastSeen(ts));
    const offRtc = onionOnConnectionChange((uid, connected) => {
      if (uid !== chatId) return;
      if (connected) {
        setPeerStatus("online");
      } else {
        const now = Date.now();
        setLastSeen(now);
        void setContactLastSeen(chatId, now).catch(() => undefined);
        setPeerStatus(getPresenceStatus(chatId));
      }
    });
    return () => {
      unsub();
      clearInterval(interval);
      offRtc();
    };
  }, [chatId]);

  // Spec §2 — Click-away listener for the header ⋯ menu. Any pointer event
  // outside the dropdown closes it instantly. ESC also dismisses.
  const headerMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!headerMenuOpen) return;
    const handler = (event: MouseEvent | TouchEvent) => {
      const node = headerMenuRef.current;
      if (!node) return;
      const target = event.target as Node | null;
      if (target && node.contains(target)) return;
      setHeaderMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHeaderMenuOpen(false);
    };
    document.addEventListener("mousedown", handler, true);
    document.addEventListener("touchstart", handler, true);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", handler, true);
      document.removeEventListener("touchstart", handler, true);
      document.removeEventListener("keydown", onEsc);
    };
  }, [headerMenuOpen]);

  useEffect(() => {
    const loadMessages = async () => {
      const stored = await getMessagesForChat(chatId);
      if (stored.length === 0) setSessionStarted(true);
      const nextMessages = stored
        .map((m) => {
          // Legacy migration: strip the deprecated 🔕 prefix and lift it to a typed flag.
          const rawText = m.text || "";
          const legacySilent = rawText.startsWith("🔕 ");
          const cleanText = legacySilent ? rawText.slice(2).trimStart() : rawText;
          return {
            id: m.id,
            text: cleanText,
            sent: m.from === userId,
            time: new Date(m.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            status: (m.status as any) || "sent",
            media: (m as any).media,
            caption: (m as any).caption,
            deleteAt: (m as any).deleteAt,
            silent: (m as any).silent || legacySilent || undefined,
            oneTimeView: (m as any).oneTimeView || undefined,
            oneTimeConsumed: (m as any).oneTimeConsumed || undefined,
            roundVideo: (m as any).roundVideo || undefined,
          };
        })
        .filter((m) => !isExpired(m.deleteAt));

      setMessages(nextMessages);
      await syncIncomingTranslations(nextMessages);
      const preferences = await getChatPreferences(chatId);
      setDisappearingDuration(preferences.disappearingDuration || "off");
      setChatFavorite(!!preferences.favorite);
      setChatBlocked(!!preferences.blocked);
      setChatArchived(!!preferences.archived);
      setChatMuted(!!preferences.mutedUntil && preferences.mutedUntil > Date.now());
      if (preferences.silentDefault) setSilent(true);
      if (preferences.oneTimeDefault) setOneTimeView(true);

      for (const m of stored) {
        if (m.from !== userId && m.status !== "read" && isValidOnion(m.from)) {
          void sendReadReceipt(m.from, m.id).catch(() => undefined);
        }
      }
    };
    loadMessages();

    // БОСС: Усиленное подключение к пиру
    const peerId = chatId;
    connectToPeer(peerId);

    // "sent" = peer's hidden service accepted the bytes; "delivered" only on
    // the peer's signed DELIVERED_ACK; "read" on its read receipt.
    const setStatus = (messageId: string, status: "sent" | "delivered" | "read") =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && (m.status !== "read" || status === "read")
            ? { ...m, status: status as any }
            : m,
        ),
      );
    const unsubDelivery = onDeliveryUpdate(setStatus);
    const unsubRead = listenForReadReceipts((id) => setStatus(id, "read"));

    return () => {
      unsubDelivery();
      unsubRead();
    };
  }, [chatId, userId]);

  useEffect(() => {
    const handleRefresh = () => {
      setMessages((prev) => prev.filter((message) => !isExpired(message.deleteAt)));
      void syncIncomingTranslations(messages.filter((message) => !isExpired(message.deleteAt)));
    };

    window.addEventListener("focus", handleRefresh);
    const interval = window.setInterval(() => {
      setMessages((prev) => prev.filter((message) => !isExpired(message.deleteAt)));
    }, 30_000);

    return () => {
      window.removeEventListener("focus", handleRefresh);
      window.clearInterval(interval);
    };
  }, [messages]);

  useEffect(() => {
    const unsub = onP2PMessage((msg: P2PMessage) => {
      if (msg.from === chatId || msg.to === chatId) {
        // Dexie and this component's local message IDs handle duplicates;
        // the chat listener must not consume the global listener's event.
        // Phase 3 §3 — Contacts-only mode: drop & block non-contact senders.
        if (msg.from !== userId && shouldBlockIncoming(msg.from)) {
          moveToBlocked(msg.from);
          return;
        }

        setMessages((prev: Message[]) => {
          if (prev.some((m: Message) => m.id === msg.id)) return prev;

          let blocked = false;
          let blockedMessage: { title: string; footer: string } | undefined;
          const media = (msg as any).media as MediaAttachment | undefined;

          if (media && msg.from !== userId) {
            const scanResult = simulateSecurityScan(media.name, false);
            if (!scanResult.safe) {
              blocked = true;
              blockedMessage = getBlockedFileMessage(
                language,
                media.type === "image" ? "photo" : "file",
              );
            }
            // Lazy-resolve the Trivo file: fetch with x-api-key, replace the
            // remote placeholder URL with a local blob URL, then re-render.
            if (!blocked && media.fileId && shouldAutoDownload(media.type === "image" ? "image" : media.type === "audio" ? "audio" : "file")) {
              ensureMediaUrl(media, msg.from)
                .then((resolved) => {
                  if (!resolved) return;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === msg.id ? { ...m, media: { ...resolved } as MediaAttachment } : m,
                    ),
                  );
                })
                .catch(() => {});
            }
          }

          return [
            ...prev,
            {
              id: msg.id,
              text: msg.text,
              sent: msg.from === userId,
              time: new Date(msg.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
              status: "delivered",
              media,
              blocked,
              blockedMessage,
              caption: (msg as any).caption,
              deleteAt: (msg as any).deleteAt,
              silent: (msg as any).silent || undefined,
              oneTimeView: (msg as any).oneTimeView || undefined,
              roundVideo: (msg as any).roundVideo || undefined,
            },
          ];
        });
        setSessionStarted(false);
        if (msg.from !== userId) {
          setMessages((prev) =>
            prev.map((item) =>
              item.id === msg.id ? { ...item, translating: true, translateError: false } : item,
            ),
          );
          translateIncomingMessage(msg.text).then((translatedText) => {
            setMessages((prev) =>
              prev.map((item) =>
                item.id === msg.id
                  ? {
                      ...item,
                      translatedText: translatedText || null,
                      translating: false,
                      translateError: !translatedText,
                    }
                  : item,
              ),
            );
          });
          // Strict silent flag honored — suppress notification ping when set.
          if (!(msg as any).silent) {
            void getChatPreferences(chatId).then((prefs) => notifyIncomingMessage(
              name, msg.text || (msg as any).media?.name || "New media",
              { mutedUntil: prefs.mutedUntil, blocked: prefs.blocked, silent: !!(msg as any).silent },
            )).catch((error) => console.warn("[notifications] chat policy unavailable", error));
          }
          if (isValidOnion(msg.from)) void sendReadReceipt(msg.from, msg.id).catch(() => undefined);
        }
      }
    });
    return unsub;
  }, [chatId, userId, language]);

  // Reset stickiness whenever we switch conversations so each chat opens
  // pinned to its newest message.
  useEffect(() => {
    stickToBottomRef.current = true;
    didInitialJumpRef.current = false;
  }, [chatId]);

  // Track whether the user is (roughly) at the bottom. 80px of slack keeps
  // "stick to bottom" true for sub-pixel/keyboard jitter without hijacking a
  // deliberate scroll-up.
  const handleScrollViewport = useCallback(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 80;
  }, []);

  // Layout-effect so the very first paint is already scrolled to the bottom:
  // the user never sees the list travel down from the top.
  useLayoutEffect(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    if (!didInitialJumpRef.current) {
      if (messages.length === 0) return;
      el.scrollTop = el.scrollHeight;
      didInitialJumpRef.current = true;
      stickToBottomRef.current = true;
      return;
    }
    // Subsequent updates only follow along when the user is still at the
    // bottom; otherwise their reading position is left untouched.
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Apply lifecycle:
  //  - Keep deleted-for-me messages visible (rendered as a "You deleted this
  //    message" placeholder, WhatsApp-style — only the deleter sees it).
  //  - "Deleted for everyone" rendered as the public tombstone for both sides.
  //  - Edits override displayed text.
  const visibleMessages = useMemo(() => {
    return messages.filter((message) => !isExpired(message.deleteAt));
  }, [messages]);

  const getEffectiveText = useCallback(
    (msg: Message): { text: string; isEdited: boolean; isTombstone: boolean } => {
      const lc = lifecycle[msg.id];
      if (lc?.deletedForEveryone) {
        return { text: t("messageDeletedForAll"), isEdited: false, isTombstone: true };
      }
      if (userId && lc?.deletedFor?.includes(userId)) {
        return { text: t("messageDeletedByMe"), isEdited: false, isTombstone: true };
      }
      if (lc?.isEdited && typeof lc.editedText === "string") {
        return { text: lc.editedText, isEdited: true, isTombstone: false };
      }
      return { text: msg.text, isEdited: false, isTombstone: false };
    },
    [lifecycle, t, userId],
  );

  const pinnedMessageId = useMemo(() => {
    let bestId: string | null = null;
    let bestAt = 0;
    for (const [id, lc] of Object.entries(lifecycle)) {
      if (lc.pinnedAt && lc.pinnedAt > bestAt && !lc.deletedForEveryone) {
        // Only show pin if message is still visible to this user
        const exists = messages.some((m) => m.id === id);
        const hiddenForMe = userId ? lc.deletedFor?.includes(userId) : false;
        if (exists && !hiddenForMe) {
          bestId = id;
          bestAt = lc.pinnedAt;
        }
      }
    }
    return bestId;
  }, [lifecycle, messages, userId]);

  const pinnedMessage = pinnedMessageId ? messages.find((m) => m.id === pinnedMessageId) : null;
  const pinnedPreview = pinnedMessage
    ? (() => {
        const eff = getEffectiveText(pinnedMessage);
        if (eff.text) return eff.text;
        if (pinnedMessage.media) return pinnedMessage.media.name || "Media";
        return "Message";
      })()
    : "";

  const filteredMessages = visibleMessages;
  const searchMatches = useMemo(
    () =>
      filteredMessages.filter(
        (message) =>
          searchQuery.trim() &&
          getEffectiveText(message).text.toLowerCase().includes(searchQuery.trim().toLowerCase()),
      ),
    [filteredMessages, searchQuery, getEffectiveText],
  );

  useEffect(() => {
    if (!searchMatches.length) return;
    const current = searchMatches[Math.min(activeMatchIndex, searchMatches.length - 1)];
    const node = messageRefs.current[current.id];
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeMatchIndex, searchMatches]);

  const sendMessage = async (override?: {
    text?: string;
    silent?: boolean;
    skipClear?: boolean;
    messageId?: string;
    scheduledTimestamp?: number;
  }) => {
    const sourceText = override?.text ?? input;
    const isSilent = override?.silent ?? silent;
    if (!sourceText.trim() || !userId) return;

    // ── Edit mode: write the new text to the local lifecycle store and exit edit mode.
    if (editingId) {
      const newText = input.trim();
      try {
        await fsEditMessage(userId, chatId, editingId, newText);
        toast({ title: t("edited") });
      } catch (e) {
        toast({ title: e instanceof Error ? e.message : HISTORY_PROTECTION_NOTICE, variant: "destructive" });
        console.error("[ChatRoom] edit failed", e);
        return; // Preserve the original text and unfinished draft on failure.
      }
      setInput("");
      setEditingId(null);
      setSelectedIds([]);
      return;
    }

    const msgId = override?.messageId || generateUUIDv4();
    // Block 5: prepend the quoted reply preview to the outgoing text. Persists
    // through the P2P transport as plain markdown-style quotation, so both ends
    // see the threaded context without requiring a schema migration.
    const quoted = replyTo
      ? replyTo.preview
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      : "";
    let currentInput = quoted + sourceText;

    // V6 §3 — Mirror-Inverse Instant Swap (only when toggle is ACTIVE).
    if (translatorActive) {
      try {
        const swapped = await translateOutgoingInverse(sourceText);
        if (swapped && swapped.trim()) {
          currentInput = quoted + swapped;
        }
      } catch (e) {
        console.warn("[ChatRoom] inverse translation failed, sending original", e);
      }
    }

    // Strict typed silent flag — recipient client suppresses the notification ping.
    // No string prefixing; see legacy outbox/💬 prefix migration notes.

    const msg: P2PMessage = {
      id: msgId,
      from: userId,
      to: chatId,
      text: currentInput,
      timestamp: override?.scheduledTimestamp ?? Date.now(),
      status: "pending",
      deleteAt: getDeleteAt(override?.scheduledTimestamp ?? Date.now(), disappearingDuration),
      silent: isSilent || undefined,
    };

    // БОСС: Сразу добавляем в список, чтобы не было задержки
    setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [
      ...prev,
      {
        id: msg.id,
        text: currentInput,
        sent: true,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        status: "pending",
        deleteAt: msg.deleteAt,
        silent: isSilent || undefined,
      },
    ]);

    // Outgoing bubbles never show a translation plate (V6 UX spec §1).
    // The sender either ships the original text (toggle OFF) or the
    // translated text (toggle ON) — there is nothing extra to display.

    if (!override?.skipClear) {
      setInput("");
    }
    setReplyTo(null);
    setShowEmoji(false);
    setSessionStarted(false);

    const peerId = chatId;

    // The native Tor outbox owns delivery; do not fall back to a cloud.
    try {
      // Persisted sealed in the Dexie outbox; status advances via
      // onDeliveryUpdate (sent → delivered on the peer's ACK).
      await sendP2PMessage(peerId, msg);
    } catch (e) {
      console.error("Ошибка отправки:", e);
      if (override?.messageId) throw e; // Retain the scheduled item for retry.
    }

    // Сохраняем в историю чатов
    const existing = await getChatMeta(chatId);
    await saveChatMeta({
      friendId: chatId,
      friendName: isTrivoSupport(chatId) ? SUPPORT_BOT_NAME : existing?.friendName || name,
      friendAvatar: existing?.friendAvatar,
      lastMessage: currentInput,
      lastMessageTime: Date.now(),
      unread: 0,
      started: true,
    });

    // Trivo Support (Bot): the built-in system assistant answers locally,
    // fully offline, using the bundled knowledge base.
    if (isTrivoSupport(chatId)) {
      await replyAsSupportBot(sourceText);
    }
  };

  /**
   * Produces and persists an incoming answer from the system bot for the
   * message the user just sent. Slash-commands (/help, /status, /security,
   * /friends ...) resolve to their exact knowledge-base entries.
   */
  const replyAsSupportBot = async (userText: string) => {
    const botLang: "ru" | "en" | undefined =
      language === "ru" ? "ru" : language === "en" ? "en" : undefined;
    // The NLP.js pipeline runs inside a Web Worker; show the typing state
    // while the promise resolves so the UI stays responsive.
    setBotTyping(true);
    let reply: string;
    try {
      reply = await supportBot.getReply(userText, botLang);
    } catch (e) {
      console.warn("[ChatRoom] support bot NLP failed", e);
      reply =
        botLang === "ru"
          ? "⚠️ Локальный ассистент временно недоступен. Попробуйте ещё раз."
          : "⚠️ The local assistant is temporarily unavailable. Please try again.";
    } finally {
      setBotTyping(false);
    }
    const botMsg = {
      id: generateUUIDv4(),
      from: chatId,
      to: userId || "self",
      text: reply,
      timestamp: Date.now(),
      status: "delivered" as const,
    };
    setMessages((prev) => [
      ...prev,
      {
        id: botMsg.id,
        text: reply,
        sent: false,
        time: new Date(botMsg.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        status: "delivered",
      },
    ]);
    try {
      await saveLocalMessage(botMsg as P2PMessage);
      const meta = await getChatMeta(chatId);
      await saveChatMeta({
        friendId: chatId,
        friendName: SUPPORT_BOT_NAME,
        friendAvatar: meta?.friendAvatar,
        lastMessage: reply,
        lastMessageTime: botMsg.timestamp,
        unread: 0,
        started: true,
      });
    } catch (e) {
      console.warn("[ChatRoom] support bot persistence failed", e);
    }
  };

  const handleFileSelect = async (accept: string) => {
    setShowAttach(false);
    if (accept === "round-video") {
      setShowRoundVideo(true);
      return;
    }
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  };

  // Block 3 — single source of truth for the upload overlay. Strict success
  // / error / cancel paths so the banner never gets stuck.
  const beginUpload = (fileName: string, totalBytes: number) => {
    uploadCancelledRef.current = false;
    uploadCancelRef.current = null;
    setUploadFileName(fileName);
    setUploadProgress(0);
    setUploadSizeLabel(`0 B / ${formatFileSize(totalBytes)}`);
    setUploading(true);
  };
  const endUpload = () => {
    uploadCancelRef.current = null;
    setUploadFileName(null);
    setUploadProgress(-1);
    setUploadSizeLabel("");
    setUploading(false);
  };
  const handleCancelUpload = () => {
    uploadCancelledRef.current = true;
    try {
      uploadCancelRef.current?.();
    } catch {
      /* ignore */
    }
    endUpload();
    toast({ title: t("uploadCancelled") || "Upload cancelled" });
  };

  // Shared upload options: feeds the real-time progress bar and registers the
  // XHR abort handle so the overlay's X button can kill an in-flight transfer.
  const buildUploadOpts = (totalBytes: number) => ({
    onProgress: (p: { loaded: number; total: number; percent: number }) => {
      setUploadProgress(p.percent);
      setUploadSizeLabel(`${formatFileSize(p.loaded)} / ${formatFileSize(p.total || totalBytes)}`);
    },
    onHandle: (abort: () => void) => {
      uploadCancelRef.current = abort;
    },
  });

  // Voice messages bypass EXIF scrub (audio has no EXIF) and the malware scan
  // (internal recording, not user-supplied). They flow through uploadMedia →
  // Local media store → sendP2PMessage (sealed Tor outbox).
  const handleVoiceRecorded = async (file: File) => {
    if (!userId) return;
    beginUpload(file.name, file.size);
    try {
      const media = await uploadMedia(file, buildUploadOpts(file.size));
      if (uploadCancelledRef.current) return;
      const msgId = generateUUIDv4();
      const msg: P2PMessage & { media: MediaAttachment } = {
        id: msgId,
        from: userId,
        to: chatId,
        text: "",
        timestamp: Date.now(),
        status: "sent",
        media,
        deleteAt: getDeleteAt(Date.now(), disappearingDuration),
      };
      const peerId = chatId;
      const sent = await sendP2PMessage(peerId, msg as any);
      void sent;

      // Immediate UI refresh — bubble appears the instant the URL is back.
      setMessages((prev) => [
        ...prev,
        {
          id: msg.id,
          text: "",
          sent: true,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          status: "sent",
          media,
          deleteAt: msg.deleteAt,
        },
      ]);
    } catch (err) {
      if (!uploadCancelledRef.current) {
        console.error("[ChatRoom] voice upload failed", err);
        toast({ title: t("mediaUploadFailed") || "Upload failed", variant: "destructive" });
      }
    } finally {
      endUpload();
    }
  };
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    if (!file || !userId) return;
    e.target.value = "";

    // 1 GB ceiling — matches the Trivo server's max upload size.
    if (file.size > TRIVO_MAX_UPLOAD_BYTES) {
      toast({
        title:
          t("fileTooLarge") || `File too large (max ${formatFileSize(TRIVO_MAX_UPLOAD_BYTES)})`,
        variant: "destructive",
      });
      return;
    }

    beginUpload(file.name, file.size);
    try {
      file = await stripExifMetadata(file);
      const scanResult = simulateSecurityScan(file.name, false);
      if (!scanResult.safe) {
        toast({
          title: getBlockedFileMessage(language, file.type.startsWith("image") ? "photo" : "file")
            .footer,
          variant: "destructive",
        });
        endUpload();
        return;
      }

      const media = await uploadMedia(file, buildUploadOpts(file.size));
      if (uploadCancelledRef.current) return;
      const msgId = generateUUIDv4();
      const isOneTime = oneTimeView;
      const msg: P2PMessage & { media: MediaAttachment } = {
        id: msgId,
        from: userId,
        to: chatId,
        text: "",
        timestamp: Date.now(),
        status: "sent",
        media,
        deleteAt: getDeleteAt(Date.now(), disappearingDuration),
        oneTimeView: isOneTime || undefined,
        silent: silent || undefined,
      };

      const peerId = chatId;
      const sent = await sendP2PMessage(peerId, msg as any);
      void sent;

      setMessages((prev) => [
        ...prev,
        {
          id: msg.id,
          text: "",
          sent: true,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          status: "sent",
          media,
          deleteAt: msg.deleteAt,
          oneTimeView: isOneTime || undefined,
          silent: silent || undefined,
        },
      ]);
      // Strict one-shot — reset toggle so the next attachment isn't auto-flagged.
      if (isOneTime) setOneTimeView(false);
    } catch (err) {
      if (!uploadCancelledRef.current) {
        console.error("[ChatRoom] file upload failed", err);
        toast({ title: t("mediaUploadFailed") || "Upload failed", variant: "destructive" });
      }
    } finally {
      endUpload();
    }
  };

  // Round video — captured locally, then uploaded through the same media pipe.
  const handleRoundVideoRecorded = async (file: File, _durationMs: number) => {
    if (!userId) return;
    beginUpload(file.name, file.size);
    try {
      const media = await uploadMedia(file, buildUploadOpts(file.size));
      if (uploadCancelledRef.current) return;
      const msgId = generateUUIDv4();
      const isOneTime = oneTimeView;
      const msg: P2PMessage & { media: MediaAttachment } = {
        id: msgId,
        from: userId,
        to: chatId,
        text: "",
        timestamp: Date.now(),
        status: "sent",
        media,
        deleteAt: getDeleteAt(Date.now(), disappearingDuration),
        roundVideo: true,
        oneTimeView: isOneTime || undefined,
        silent: silent || undefined,
      };
      const peerId = chatId;
      const sentOk = await sendP2PMessage(peerId, msg as any);
      void sentOk;

      setMessages((prev) => [
        ...prev,
        {
          id: msg.id,
          text: "",
          sent: true,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          status: "sent",
          media,
          deleteAt: msg.deleteAt,
          roundVideo: true,
          oneTimeView: isOneTime || undefined,
          silent: silent || undefined,
        },
      ]);
      if (isOneTime) setOneTimeView(false);
    } catch (err) {
      if (!uploadCancelledRef.current) {
        console.error("[ChatRoom] round video upload failed", err);
        toast({ title: t("mediaUploadFailed") || "Upload failed", variant: "destructive" });
      }
    } finally {
      endUpload();
    }
  };

  // Purge one-time media: remove from local DB + memory, mark message as consumed.
  const purgeOneTimeMedia = async (msg: Message) => {
    try {
      // Persist the consumed marker; deleting the entire message would make
      // the UI forget it was opened after a restart.
      // Durably revoke the attachment BEFORE removing the message preview.
      if (msg.media?.fileId) await purgeConsumedMedia(msg.media.fileId);
      await dxdb.messages.update(msg.id, { media: undefined, oneTimeConsumed: true });
    } catch (error) {
      // Do not fake a consumed state if the durable tombstone failed.
      console.error("[one-time] could not persist consumed marker", error);
      toast({ title: "Не удалось безопасно удалить одноразовое вложение", variant: "destructive" });
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, media: undefined, oneTimeConsumed: true } : m)),
    );
  };

  // Pre-train the offline NLP model in the background as soon as the built-in
  // assistant chat opens, so the first answer is instant.
  useEffect(() => {
    if (!isTrivoSupport(chatId)) return;
    const timer = window.setTimeout(() => {
      void supportBot.warmup();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [chatId]);

  const lastSeenLabel = lastSeen
    ? `${t("lastSeenAt")} ${new Date(lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;
  const typingLabel =
    language === "ru"
      ? `${SUPPORT_BOT_NAME} печатает…`
      : language === "kk"
        ? `${SUPPORT_BOT_NAME} жазып отыр…`
        : `${SUPPORT_BOT_NAME} is typing…`;
  const statusLabel = botTyping
    ? typingLabel
    : peerStatus === "online"
      ? t("online")
      : peerStatus === "away"
        ? t("away")
        : lastSeenLabel || t("offline");
  const statusColor = botTyping
    ? "text-[#00FFFF]"
    : peerStatus === "online"
      ? "text-primary"
      : peerStatus === "away"
        ? "text-yellow-500"
        : "text-muted-foreground";
  const selectedMessages = filteredMessages.filter((message) => selectedIds.includes(message.id));
  const allowCopy =
    selectedMessages.length > 0 &&
    selectedMessages.every((message) => {
      const eff = getEffectiveText(message);
      return !!eff.text && !eff.isTombstone && !message.media;
    });
  const allowMediaActions = selectedMessages.length === 1 && !!selectedMessages[0]?.media;
  const singleSel = selectedMessages.length === 1 ? selectedMessages[0] : null;
  const singleSelLifecycle = singleSel ? lifecycle[singleSel.id] : undefined;
  const singleSelIsTombstone = singleSel ? getEffectiveText(singleSel).isTombstone : false;
  // Edit only own, text-only, non-tombstone messages.
  const allowEdit =
    !!singleSel &&
    singleSel.sent &&
    !singleSel.media &&
    !singleSelIsTombstone &&
    !!getEffectiveText(singleSel).text;
  const allowPin = !!singleSel && !singleSelIsTombstone;
  const isPinnedSel = !!singleSel && !!singleSelLifecycle?.pinnedAt;
  // Ownership gate: trash icon visible ONLY when every selected message
  // belongs to the current user (and isn't already a tombstone). This
  // prevents users from attempting to delete the other party's content.
  const allowDelete =
    selectedMessages.length > 0 &&
    selectedMessages.every((m) => m.sent && !getEffectiveText(m).isTombstone);
  // Inside the bottom sheet, "Delete for everyone" is offered whenever the
  // user owns the selection — i.e. always when allowDelete is true.
  const canDeleteForEveryone = allowDelete;
  // Reply only when exactly one non-tombstone message is selected.
  const allowReply = !!singleSel && !singleSelIsTombstone;

  const handleReplyStart = () => {
    if (!singleSel) return;
    const eff = getEffectiveText(singleSel);
    const preview = eff.text || singleSel.media?.name || (singleSel.media ? "Media" : "Message");
    setReplyTo({ id: singleSel.id, preview: preview.slice(0, 140), sent: singleSel.sent });
    setSelectedIds([]);
    setShowEmoji(false);
    setShowAttach(false);
  };

  const handleEditStart = async () => {
    if (!singleSel) return;
    try {
      // Re-read the durable flag: the incoming toggle can race React state.
      if (peerHistoryProtected || (await getRemoteHistoryProtection(chatId)).enabled) {
        toast({ title: HISTORY_PROTECTION_NOTICE });
        return;
      }
    } catch (error) {
      toast({ title: "Не удалось проверить защиту переписки", variant: "destructive" });
      return;
    }
    setEditingId(singleSel.id);
    setInput(getEffectiveText(singleSel).text);
    setSelectedIds([]);
    setShowEmoji(false);
    setShowAttach(false);
  };

  const handlePinToggle = async () => {
    if (!singleSel || !userId) return;
    try {
      if (singleSelLifecycle?.pinnedAt) {
        await fsUnpinMessage(userId, chatId, singleSel.id);
      } else {
        await fsPinMessage(userId, chatId, singleSel.id);
      }
    } catch (e) {
      console.error("[ChatRoom] pin toggle failed", e);
    }
    setSelectedIds([]);
  };

  // Optimistic UI: tombstone appears instantly via local lifecycle state,
  // then the local lifecycle write reconciles. Real text is never re-rendered.
  const handleDeleteForMe = async () => {
    if (!userId || selectedMessages.length === 0) return;
    const ids = selectedMessages.map((m) => m.id);
    setLifecycle((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const cur = next[id] || { messageId: id };
        const deletedFor = Array.from(new Set([...(cur.deletedFor || []), userId]));
        next[id] = { ...cur, deletedFor };
      }
      return next;
    });
    setDeleteSheetOpen(false);
    setSelectedIds([]);
    try {
      await Promise.all(selectedMessages.map((m) => fsDeleteForMe(userId, chatId, m.id)));
    } catch (e) {
      console.error("[ChatRoom] delete for me failed", e);
    }
  };

  const handleDeleteForEveryone = async () => {
    if (!userId || selectedMessages.length === 0) return;
    const ids = selectedMessages.map((m) => m.id);
    try {
      // Do not show an optimistic tombstone before confirming the policy.
      if (peerHistoryProtected || (await getRemoteHistoryProtection(chatId)).enabled) {
        setDeleteSheetOpen(false);
        toast({ title: HISTORY_PROTECTION_NOTICE });
        return;
      }
      await Promise.all(ids.map((id) => fsDeleteForEveryone(userId, chatId, id)));
      setLifecycle((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          const cur = next[id] || { messageId: id };
          next[id] = { ...cur, deletedForEveryone: true };
        }
        return next;
      });
      setDeleteSheetOpen(false);
      setSelectedIds([]);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Не удалось удалить сообщение", variant: "destructive" });
      console.error("[ChatRoom] delete for everyone failed", error);
    }
  };

  // Outbox sender — fires due scheduled messages while this chat is mounted.
  // Uses a ref so the registered closure always sees the latest sendMessage.
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  useEffect(() => {
    if (!chatId) return;
    return registerSender(chatId, async (item: ScheduledItem) => {
      // Re-entrant timers must not duplicate a message already in the Tor outbox.
      const queued = await dxdb.outbox.get(item.id);
      if (queued) return;
      const stored = await dxdb.messages.get(item.id);
      if (stored && stored.status !== "pending") return;
      await sendMessageRef.current({
        text: item.text, silent: item.silent, skipClear: true,
        messageId: item.id, scheduledTimestamp: item.scheduledAt,
      });
    });
  }, [chatId]);

  const jumpToMessage = (id: string) => {
    const node = messageRefs.current[id];
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (callType) {
    return <CallScreen name={name} type={callType} onEnd={() => setCallType(null)} />;
  }

  const renderMediaBubble = (msg: Message) => {
    const media = msg.media;
    if (msg.blocked && msg.blockedMessage) {
      return (
        <div className="rounded-xl overflow-hidden">
          <div className="bg-destructive/10 backdrop-blur-md p-4 text-center space-y-2">
            <ShieldAlert size={28} className="text-destructive mx-auto" />
            <p className="text-xs font-semibold text-destructive">{msg.blockedMessage.title}</p>
            <p className="text-[10px] text-destructive/70 font-bold uppercase">
              {msg.blockedMessage.footer}
            </p>
          </div>
        </div>
      );
    }

    // One-time view: masked placeholder until tapped, then purged on close.
    if (msg.oneTimeView) {
      return (
        <OneTimeMediaBubble
          consumed={msg.oneTimeConsumed}
          sent={msg.sent}
          onOpen={() => setViewerMessage(msg)}
        />
      );
    }

    if (!media) return null;

    // Round video — square 1:1 aspect, circular mask.
    if (msg.roundVideo) {
      return (
        <div
          className="relative rounded-full overflow-hidden border border-[#00FFFF]/40 bg-black"
          style={{ width: 200, height: 200, boxShadow: "0 0 10px rgba(0,255,255,0.25)" }}
        >
          <video
            src={media.url}
            controls
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
            style={{ clipPath: "circle(50% at 50% 50%)" }}
          />
        </div>
      );
    }

    if (media.type === "image") {
      if (!shouldAutoDownload("image")) {
        return (
          <TapToDownload
            label={media.name || t("image")}
            sizeBytes={media.size}
            onDownload={async () => {
              if (!media.fileId) throw new Error("Missing attachment ID");
              await ensureMediaUrl(media, msg.sent ? undefined : chatId);
              if (!media.url?.startsWith("blob:")) throw new Error("Attachment is not downloaded");
            }}
            render={() => (
              <a href={media.url} target="_blank" rel="noopener noreferrer" className="block">
                <img
                  src={media.url}
                  alt={media.name}
                  className="rounded-xl max-w-full max-h-[240px] object-cover"
                  loading="lazy"
                />
              </a>
            )}
          />
        );
      }
      return (
        <a href={media.url} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={media.url}
            alt={media.name}
            className="rounded-xl max-w-full max-h-[240px] object-cover"
            loading="lazy"
          />
        </a>
      );
    }
    if (media.type === "audio") {
      return <AudioWaveformPlayer src={media.url} name={media.name} sent={msg.sent} />;
    }
    return (
      <button
        onClick={() => {
          setPendingDownload(media.url);
          setScanOverlay(true);
        }}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity text-left w-full"
      >
        <FileText size={20} className={msg.sent ? "text-primary-foreground/80" : "text-primary"} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{media.name}</p>
          <p
            className={`text-[10px] ${msg.sent ? "text-primary-foreground/60" : "text-muted-foreground"}`}
          >
            {formatFileSize(media.size)}
          </p>
        </div>
        <Download
          size={14}
          className={`shrink-0 ${msg.sent ? "text-primary-foreground/60" : "text-muted-foreground"}`}
        />
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full max-w-[100vw] overflow-x-hidden">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />

      {selectedIds.length > 0 ? (
        <ChatSelectionBar
          count={selectedIds.length}
          allowCopy={allowCopy}
          allowMediaActions={allowMediaActions}
          allowEdit={allowEdit}
          allowPin={allowPin}
          isPinned={isPinnedSel}
          allowReply={allowReply}
          allowDelete={allowDelete}
          onClose={() => {
            setSelectedIds([]);
            setDeleteSheetOpen(false);
          }}
          onCopy={async () => {
            await navigator.clipboard.writeText(
              selectedMessages.map((message) => getEffectiveText(message).text).join("\n"),
            );
            toast({ title: "Copied" });
            setSelectedIds([]);
          }}
          onForward={() => {
            const first = selectedMessages[0];
            const media = first?.media || null;
            const text = !media ? getEffectiveText(first || ({} as Message)).text || "" : "";
            setForwardingMedia(media);
            setForwardingText(text);
            setForwardSheetOpen(true);
          }}
          onShare={async () => {
            const first = selectedMessages[0];
            if (!first) return;
            const media = first.media;
            try {
              if (media) {
                await Share.share({
                  title: media.name,
                  text: first.caption || "",
                  url: media.url,
                  dialogTitle: "Share",
                });
              } else {
                const text = selectedMessages
                  .map((m) => getEffectiveText(m).text)
                  .filter(Boolean)
                  .join("\n\n");
                if (!text) return;
                await Share.share({ text, dialogTitle: "Share" });
              }
            } catch (e) {
              console.warn("[ChatRoom] native share failed", e);
            }
            setSelectedIds([]);
          }}
          onEdit={handleEditStart}
          onPinToggle={handlePinToggle}
          onReply={handleReplyStart}
          onDelete={() => setDeleteSheetOpen(true)}
        />
      ) : (
        <div className="header-safe-zone glass-panel rounded-none border-x-0 border-t-0 px-3 pb-2 header-bar-56 gap-3 z-10 shrink-0 flex items-center">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors shrink-0"
          >
            <ArrowLeft size={20} className="text-foreground" />
          </button>
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-lg hover:bg-secondary/40 transition-colors px-1 py-0.5"
            aria-label={t("openChatProfile")}
          >
            <div className="relative shrink-0">
              <DefaultAvatar size={36} />
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${peerStatus === "online" ? "bg-primary" : peerStatus === "away" ? "bg-yellow-500" : "bg-muted-foreground/40"}`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-semibold text-sm text-foreground truncate">{name}</p>
                {disappearingDuration !== "off" && (
                  <TimerReset
                    size={12}
                    className="text-[#00FFFF] shrink-0"
                    style={{ filter: "drop-shadow(0 0 4px rgba(0,255,255,0.6))" }}
                    aria-label="Disappearing messages active"
                  />
                )}
              </div>
              <p className={`text-[11px] ${statusColor}`}>{statusLabel}</p>
            </div>
          </button>
          {/* V6 §2 — Header icon row. Padding tightened p-2 → p-1.5 (≈25%) to
            reclaim space for the new Translator master toggle. */}
          <button
            onClick={() => setCallType("audio")}
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground shrink-0"
            aria-label="Voice call"
          >
            <Phone size={20} />
          </button>
          <button
            onClick={() => setCallType("video")}
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground shrink-0"
            aria-label="Video call"
          >
            <Video size={20} />
          </button>
          {/* Spec §3 — Header search icon removed (duplicate of menu entry). Search remains accessible via the ⋯ menu below. */}
          <button
            type="button"
            onClick={() => setTranslatorActive((v) => !v)}
            aria-pressed={translatorActive}
            aria-label={
              translatorActive
                ? "Disable Mirror-Inverse translator"
                : "Enable Mirror-Inverse translator"
            }
            title={translatorActive ? "Translator: ON (Mirror-Inverse)" : "Translator: OFF"}
            className={`p-1.5 rounded-lg shrink-0 transition-all duration-200 ${
              translatorActive
                ? "text-[#00FFFF] bg-[#00FFFF]/10"
                : "text-muted-foreground hover:bg-secondary/50"
            }`}
            style={
              translatorActive
                ? {
                    boxShadow:
                      "0 0 10px rgba(0,255,255,0.85), 0 0 22px rgba(0,255,255,0.45), inset 0 0 6px rgba(0,255,255,0.35)",
                  }
                : undefined
            }
          >
            <Languages size={18} />
          </button>

          <div className="relative shrink-0" ref={headerMenuRef}>
            <button
              type="button"
              onClick={() => setHeaderMenuOpen((v) => !v)}
              className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground"
              aria-label={t("more")}
              aria-expanded={headerMenuOpen}
            >
              <MoreVertical size={18} />
            </button>
            <AnimatePresence>
              {headerMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: -4 }}
                  transition={{ duration: 0.14 }}
                  className="absolute right-0 top-10 min-w-[230px] rounded-xl border border-[#00FFFF]/30 bg-black z-40 py-1"
                  style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.6), 0 0 12px rgba(0,255,255,0.2)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSilent((s) => !s);
                      setHeaderMenuOpen(false);
                      toast({ title: silent ? t("silentSendOff") : t("silentSendOn") });
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    <BellOff
                      size={16}
                      className={silent ? "text-[#00FFFF]" : "text-muted-foreground"}
                    />
                    <span className="flex-1 text-left">{t("silentSend")}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-bold ${silent ? "text-[#00FFFF]" : "text-muted-foreground"}`}
                    >
                      {silent ? t("on") : t("off")}
                    </span>
                  </button>
                  {isValidOnion(chatId) && <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      if (!userId) return;
                      void setLocalHistoryProtection(userId, chatId, !historyProtected)
                        .then((state) => toast({ title: state.enabled ? "Защита истории переписки включена" : "Защита истории переписки выключена" }))
                        .catch((error) => toast({ title: error instanceof Error ? error.message : "Не удалось изменить защиту", variant: "destructive" }));
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    <ShieldCheck size={16} className={historyProtected ? "text-[#00FFFF]" : "text-muted-foreground"} />
                    <span className="flex-1 text-left">Защита истории переписки</span>
                    <span className="text-[10px] uppercase font-bold">{historyProtected ? "ВКЛ" : "ВЫКЛ"}</span>
                  </button>}
                  <button
                    type="button"
                    onClick={() => {
                      setOneTimeView((v) => !v);
                      setHeaderMenuOpen(false);
                      toast({ title: oneTimeView ? t("oneTimeViewOff") : t("oneTimeViewOn") });
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    <Eye
                      size={16}
                      className={oneTimeView ? "text-[#00FFFF]" : "text-muted-foreground"}
                    />
                    <span className="flex-1 text-left">{t("oneTimeView")}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-bold ${oneTimeView ? "text-[#00FFFF]" : "text-muted-foreground"}`}
                    >
                      {oneTimeView ? t("on") : t("off")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      setDisappearingModalOpen(true);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    <TimerReset
                      size={16}
                      className={
                        disappearingDuration !== "off" ? "text-[#00FFFF]" : "text-muted-foreground"
                      }
                    />
                    <span className="flex-1 text-left">{t("disappearingMessages")}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-bold ${disappearingDuration !== "off" ? "text-[#00FFFF]" : "text-muted-foreground"}`}
                    >
                      {disappearingDuration === "off"
                        ? t("off")
                        : disappearingDuration.toUpperCase()}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      setSearchOpen(true);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    <Search size={16} className="text-muted-foreground" />
                    <span className="flex-1 text-left">{t("search")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (chatMuted) {
                        // Already muted -> the row acts as a direct unmute switch.
                        setHeaderMenuOpen(false);
                        await updateChatPreferences(chatId, { mutedUntil: null });
                        setChatMuted(false);
                        toast({ title: t("unmute") });
                        return;
                      }
                      setHeaderMenuOpen(false);
                      setMuteOpen(true);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    <VolumeX
                      size={16}
                      className={chatMuted ? "text-yellow-400" : "text-muted-foreground"}
                    />
                    <span className="flex-1 text-left">{chatMuted ? t("unmute") : t("mute")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !chatBlocked;
                      setChatBlocked(next);
                      await updateChatPreferences(chatId, { blocked: next });
                      if (next) await blockUser(chatId);
                      else await unblockUser(chatId);
                      setHeaderMenuOpen(false);
                      toast({ title: next ? t("blockedToast") : t("unblockedToast") });
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    <Ban
                      size={16}
                      className={chatBlocked ? "text-red-400" : "text-muted-foreground"}
                    />
                    <span className="flex-1 text-left">
                      {chatBlocked ? t("unblock") : t("block")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !chatFavorite;
                      setChatFavorite(next);
                      await updateChatPreferences(chatId, { favorite: next });
                      const starred = (await dbGet<string[]>("settings", "starred-chats")) || [];
                      await dbPut(
                        "settings",
                        "starred-chats",
                        next
                          ? Array.from(new Set([...starred, chatId]))
                          : starred.filter((s) => s !== chatId),
                      );
                      setHeaderMenuOpen(false);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    {chatFavorite ? (
                      <StarOff size={16} className="text-[#00FFFF]" />
                    ) : (
                      <Star size={16} className="text-muted-foreground" />
                    )}
                    <span className="flex-1 text-left">
                      {chatFavorite ? t("removeFromFavorites") : t("addToFavorites")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !chatArchived;
                      setChatArchived(next);
                      await updateChatPreferences(chatId, { archived: next });
                      setHeaderMenuOpen(false);
                      toast({ title: next ? t("movedToArchive") : t("movedFromArchive") });
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    {chatArchived ? (
                      <ArchiveRestore size={16} className="text-[#00FFFF]" />
                    ) : (
                      <Archive size={16} className="text-muted-foreground" />
                    )}
                    <span className="flex-1 text-left">
                      {chatArchived ? t("unarchiveAction") : t("archiveAction")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      setAssignOpen(true);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    <FolderPlus size={16} className="text-[#00FFFF]" />
                    <span className="flex-1 text-left">{t("groups")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setHeaderMenuOpen(false);
                      await clearMessagesForChat(chatId);
                      setMessages([]);
                      toast({ title: t("chatCleared") });
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-white/5"
                  >
                    <Trash2 size={16} className="text-orange-400" />
                    <span className="flex-1 text-left">{t("clearChat")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      setShowReport(true);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-destructive hover:bg-white/5"
                  >
                    <Flag size={16} />
                    <span className="flex-1 text-left">{t("reportUser")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setHeaderMenuOpen(false);
                      await clearMessagesForChat(chatId);
                      try {
                        await dbDelete("contacts", chatId);
                      } catch {
                        /* ignore */
                      }
                      toast({ title: t("friendRemoved") });
                      onBack();
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-destructive hover:bg-white/5"
                  >
                    <UserMinus size={16} />
                    <span className="flex-1 text-left">{t("deleteFriend")}</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {searchOpen && (
        <ChatSearchBar
          value={searchQuery}
          resultCount={searchMatches.length}
          activeIndex={Math.min(activeMatchIndex, Math.max(searchMatches.length - 1, 0))}
          onChange={(value) => {
            setSearchQuery(value);
            setActiveMatchIndex(0);
          }}
          onNext={() =>
            setActiveMatchIndex((prev) =>
              searchMatches.length ? (prev + 1) % searchMatches.length : 0,
            )
          }
          onPrev={() =>
            setActiveMatchIndex((prev) =>
              searchMatches.length ? (prev - 1 + searchMatches.length) % searchMatches.length : 0,
            )
          }
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery("");
            setActiveMatchIndex(0);
          }}
        />
      )}

      <AnimatePresence>
        {pinnedMessage && pinnedMessageId && (
          <PinnedHeader
            key={pinnedMessageId}
            preview={pinnedPreview}
            label={t("pinnedMessage")}
            onJump={() => jumpToMessage(pinnedMessageId)}
            onUnpin={() =>
              userId && fsUnpinMessage(userId, chatId, pinnedMessageId).catch(() => {})
            }
          />
        )}
      </AnimatePresence>

      <div
        ref={scrollBoxRef}
        onScroll={handleScrollViewport}
        className={`flex-1 px-4 py-4 space-y-2 scrollbar-hide ${
          // Block 5 — selection mode locks the scroll viewport so the CAB
          // stays anchored and accidental drags don't drop the selection.
          selectedIds.length > 0 ? "overflow-hidden touch-none" : "overflow-y-auto"
        }`}
        onClick={() => {
          // Click-away dismissal: tapping the chat background closes the emoji picker.
          // Disabled while in selection mode so taps can toggle bubbles instead.
          if (selectedIds.length > 0) return;
          if (showEmoji) setShowEmoji(false);
          if (showAttach) setShowAttach(false);
        }}
      >
        {systemBubbles.map((sb) => (
          <div key={sb.id} className="flex justify-center my-2">
            <div className="px-3 py-1.5 rounded-full bg-[#00FFFF]/10 border border-[#00FFFF]/30 text-[11px] text-[#00FFFF] uppercase tracking-wide flex items-center gap-1.5">
              <TimerReset size={11} /> {sb.text}
            </div>
          </div>
        ))}
        <AnimatePresence initial={false}>
          {filteredMessages.map((msg) => {
            const eff = getEffectiveText(msg);
            const isMatch =
              !!searchQuery.trim() &&
              eff.text.toLowerCase().includes(searchQuery.trim().toLowerCase());
            const isActiveMatch = searchMatches[activeMatchIndex]?.id === msg.id;
            const isSelected = selectedIds.includes(msg.id);
            const isPinnedHere = pinnedMessageId === msg.id;
            const msgUrl = !eff.isTombstone ? extractFirstUrl(eff.text) : null;
            const reactionAgg = aggregateReactions(reactions[msg.id]);
            return (
              <motion.div
                key={msg.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                className={`flex ${msg.sent ? "justify-end" : "justify-start"}`}
              >
                <div className="relative max-w-[75%]">
                  <ReactionsBar
                    visible={reactionTarget === msg.id}
                    onPick={(emoji) => onPickReaction(msg.id, emoji)}
                    onDismiss={() => setReactionTarget(null)}
                    align={msg.sent ? "end" : "start"}
                  />
                  <motion.div
                    layout
                    ref={(node) => {
                      messageRefs.current[msg.id] = node;
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      // Spec §1 — long-press / right-click exclusively triggers the
                      // app's selection action bar. The native partial-copy menu is
                      // suppressed via user-select: none on the bubble.
                      setSelectedIds((prev) =>
                        prev.includes(msg.id)
                          ? prev.filter((id) => id !== msg.id)
                          : [...prev, msg.id],
                      );
                    }}
                    onPointerDown={(e) => {
                      if (selectedIds.length > 0) return;
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const target = e.currentTarget as HTMLDivElement & {
                        __trivoLPTimer?: number;
                        __trivoLPMove?: (ev: PointerEvent) => void;
                        __trivoLPEnd?: () => void;
                        __trivoLPFired?: boolean;
                      };
                      target.__trivoLPFired = false;
                      if (target.__trivoLPTimer) window.clearTimeout(target.__trivoLPTimer);
                      const cleanup = () => {
                        if (target.__trivoLPTimer) {
                          window.clearTimeout(target.__trivoLPTimer);
                          target.__trivoLPTimer = undefined;
                        }
                        if (target.__trivoLPMove) {
                          target.removeEventListener("pointermove", target.__trivoLPMove);
                          target.__trivoLPMove = undefined;
                        }
                        if (target.__trivoLPEnd) {
                          target.removeEventListener("pointerup", target.__trivoLPEnd);
                          target.removeEventListener("pointercancel", target.__trivoLPEnd);
                          target.__trivoLPEnd = undefined;
                        }
                      };
                      const onMove = (ev: PointerEvent) => {
                        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) cleanup();
                      };
                      target.__trivoLPMove = onMove;
                      target.__trivoLPEnd = cleanup;
                      target.addEventListener("pointermove", onMove);
                      target.addEventListener("pointerup", cleanup);
                      target.addEventListener("pointercancel", cleanup);
                      target.__trivoLPTimer = window.setTimeout(() => {
                        target.__trivoLPTimer = undefined;
                        cleanup();
                        // Spec §1 — long-press exclusively opens the app's CAB and
                        // the selection must PERSIST until the user explicitly
                        // dismisses (Back/Close/Action). Mark that long-press fired
                        // so the synthetic click that follows pointerup does NOT
                        // re-toggle (which previously dropped the selection).
                        target.__trivoLPFired = true;
                        setSelectedIds((prev) =>
                          prev.includes(msg.id) ? prev : [...prev, msg.id],
                        );
                      }, 380);
                    }}
                    onClick={(e) => {
                      const target = e.currentTarget as HTMLDivElement & {
                        __trivoLPFired?: boolean;
                      };
                      if (target.__trivoLPFired) {
                        // Suppress the synthetic click that follows a long-press so
                        // the just-opened selection bar stays on screen.
                        target.__trivoLPFired = false;
                        e.stopPropagation();
                        e.preventDefault();
                        return;
                      }
                      if (selectedIds.length > 0) {
                        e.stopPropagation();
                        setSelectedIds((prev) =>
                          prev.includes(msg.id)
                            ? prev.filter((id) => id !== msg.id)
                            : [...prev, msg.id],
                        );
                        return;
                      }
                      handleBubbleTap(msg.id);
                    }}
                    style={{
                      userSelect: "none",
                      WebkitUserSelect: "none",
                      WebkitTouchCallout: "none",
                      // Selection highlight is applied inline so it always wins over
                      // the bubble's own background utility and PERSISTS until the
                      // user explicitly dismisses the action bar.
                      ...(isSelected
                        ? {
                            backgroundColor: "hsl(var(--primary) / 0.28)",
                            borderColor: "hsl(var(--primary) / 0.65)",
                            boxShadow: "0 0 0 2px hsl(var(--primary) / 0.55)",
                          }
                        : null),
                    }}
                    className={`px-3.5 py-2 rounded-2xl border flex flex-col transition-colors ${msg.sent ? "bg-primary text-primary-foreground rounded-br-md border-primary/20" : "glass-panel-sm rounded-bl-md border-border/30"} ${isActiveMatch ? "ring-2 ring-primary" : isMatch ? "ring-1 ring-border" : ""} ${eff.isTombstone ? "opacity-70 italic" : ""}`}
                  >
                    {msg.media && !eff.isTombstone && renderMediaBubble(msg)}
                    {eff.text && (
                      <p className="text-sm leading-relaxed break-words">
                        <RichText text={eff.text} />
                      </p>
                    )}
                    {msgUrl && <LinkPreviewCard url={msgUrl} />}
                    {msg.caption && !eff.isTombstone && (
                      <p className="text-sm leading-relaxed break-words mt-2">{msg.caption}</p>
                    )}
                    {/* Block 2 — Universal translation: render the plate for ANY
                  message (sent or received) once a translation exists. */}
                    {/* Per V6 UX spec: translation plate is rendered ONLY on
                  incoming bubbles (left side). Outgoing messages already
                  ship the translated form when the master toggle is ON. */}
                    {!eff.isTombstone &&
                      !msg.sent &&
                      (msg.translatedText || msg.translating || msg.translateError) && (
                        <TranslationPlate
                          translatedText={msg.translatedText || ""}
                          sent={false}
                          translating={msg.translating}
                          error={msg.translateError && !msg.translatedText}
                          onRetry={() => {
                            setMessages((prev) =>
                              prev.map((it) =>
                                it.id === msg.id
                                  ? { ...it, translating: true, translateError: false }
                                  : it,
                              ),
                            );
                            translateIncomingMessage(msg.text).then((translatedText) => {
                              setMessages((prev) =>
                                prev.map((it) =>
                                  it.id === msg.id
                                    ? {
                                        ...it,
                                        translatedText: translatedText || null,
                                        translating: false,
                                        translateError: !translatedText,
                                      }
                                    : it,
                                ),
                              );
                            });
                          }}
                        />
                      )}
                    {reactionAgg.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {reactionAgg.map((r) => (
                          <motion.span
                            key={r.emoji}
                            initial={{ scale: 0.6, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: "spring", stiffness: 320, damping: 16 }}
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] bg-black border border-[#00FFFF]/45"
                            style={{ boxShadow: "0 0 6px rgba(0,255,255,0.35)" }}
                          >
                            <span>{r.emoji}</span>
                            {r.count > 1 && (
                              <span className="text-[#00FFFF] font-semibold">{r.count}</span>
                            )}
                          </motion.span>
                        ))}
                      </div>
                    )}
                    <div
                      className={`flex items-center gap-1 justify-end mt-1 ${msg.sent ? "text-primary-foreground/60" : "text-muted-foreground"}`}
                    >
                      {isPinnedHere && !eff.isTombstone && (
                        <Pin
                          size={10}
                          className={msg.sent ? "text-primary-foreground/70" : "text-primary"}
                        />
                      )}
                      {eff.isEdited && <span className="text-[10px] italic">{t("edited")}</span>}
                      {msg.silent && !eff.isTombstone && (
                        <BellOff
                          size={10}
                          className={
                            msg.sent ? "text-primary-foreground/70" : "text-muted-foreground"
                          }
                        />
                      )}
                      <span className="text-[10px]">{msg.time}</span>
                      {msg.sent &&
                        !eff.isTombstone &&
                        (msg.status === "pending" ? (
                          <Clock size={11} className="animate-pulse" />
                        ) : msg.status === "sent" ? (
                          <Check size={12} />
                        ) : msg.status === "delivered" ? (
                          <CheckCheck size={12} />
                        ) : (
                          <CheckCheck size={12} className="text-blue-400" />
                        ))}
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {botTyping && (
          <div className="flex justify-start">
            <div
              className="flex items-center gap-2 rounded-2xl rounded-bl-md px-3 py-2 bg-secondary/60 border border-[#00FFFF]/25"
              aria-live="polite"
            >
              <span className="text-[11px] text-[#00FFFF]">{typingLabel}</span>
              <span className="flex items-center gap-1">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[#00FFFF] animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[#00FFFF] animate-bounce"
                  style={{ animationDelay: "120ms" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[#00FFFF] animate-bounce"
                  style={{ animationDelay: "240ms" }}
                />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <AnimatePresence>
        {editingId && (
          <motion.div
            key="edit-banner"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="glass-panel rounded-none border-x-0 border-b-0 px-3 py-2 flex items-center gap-2 shrink-0"
          >
            <Pin size={14} className="text-primary rotate-45" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-primary font-semibold">
                {t("editMessage")}
              </p>
              <p className="text-xs text-muted-foreground truncate">{input}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setInput("");
              }}
              className="p-1.5 rounded-md hover:bg-secondary/50 text-muted-foreground"
              aria-label={t("cancelEdit")}
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {replyTo && !editingId && (
          <motion.div
            key="reply-banner"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="glass-panel rounded-none border-x-0 border-b-0 px-3 py-2 flex items-center gap-2 shrink-0"
          >
            <CornerUpLeft size={14} className="text-primary" />
            <div className="flex-1 min-w-0 border-l-2 border-primary/60 pl-2">
              <p className="text-[10px] uppercase tracking-wide text-primary font-semibold">
                {replyTo.sent ? "You" : name}
              </p>
              <p className="text-xs text-muted-foreground truncate">{replyTo.preview}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="p-1.5 rounded-md hover:bg-secondary/50 text-muted-foreground"
              aria-label="Cancel reply"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <MessageInput
        value={input}
        onValueChange={setInput}
        onSubmit={() => sendMessage()}
        onToggleEmoji={() => {
          setShowEmoji(!showEmoji);
          setShowAttach(false);
        }}
        onToggleAttach={() => {
          setShowAttach(!showAttach);
          setShowEmoji(false);
        }}
        onVoiceRecorded={handleVoiceRecorded}
        placeholder={t("typeMessage")}
        silent={silent}
        onToggleSilent={() => setSilent((s) => !s)}
        oneTimeView={oneTimeView}
        onToggleOneTimeView={() => setOneTimeView((v) => !v)}
        onSchedule={() => {
          if (!input.trim()) {
            toast({ title: "Type a message first" });
            return;
          }
          setShowSchedule(true);
        }}
        overlaySlot={
          <>
            {draftUrl && draftUrl !== draftPreviewDismissed && (
              <LinkPreviewCard
                url={draftUrl}
                variant="draft"
                onDismiss={() => setDraftPreviewDismissed(draftUrl)}
              />
            )}
            <UploadOverlay
              visible={uploading}
              fileName={uploadFileName ?? undefined}
              label={t("uploading") || "Uploading…"}
              cancelLabel={t("uploadCancelled") || "Cancel upload"}
              onCancel={handleCancelUpload}
              progress={uploadProgress}
              sizeLabel={uploadSizeLabel}
            />
          </>
        }
      />

      <ScheduleSheet
        open={showSchedule}
        onClose={() => setShowSchedule(false)}
        onConfirm={async (epochMs) => {
          const text = input;
          const wasSilent = silent;
          await enqueueOutbox({ chatId, text, silent: wasSilent, scheduledAt: epochMs });
          setInput("");
          toast({
            title: "Scheduled",
            description: `Will send at ${new Date(epochMs).toLocaleString()}`,
          });
        }}
      />

      <AttachmentMenu
        open={showAttach}
        onClose={() => setShowAttach(false)}
        onSelect={handleFileSelect}
      />

      <AnimatePresence>
        {showEmoji && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden trivo-emoji-picker"
          >
            <CustomEmojiPicker
              height={320}
              onSelect={(emoji) => setInput((prev) => prev + emoji)}
              onBackspace={() =>
                setInput((prev) => {
                  if (!prev) return prev;
                  // Remove last grapheme (handles emoji + ZWJ sequences)
                  const seg = (Intl as any).Segmenter
                    ? Array.from(new (Intl as any).Segmenter().segment(prev), (s: any) => s.segment)
                    : Array.from(prev);
                  seg.pop();
                  return seg.join("");
                })
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ReportMenu userId={chatId} open={showReport} onClose={() => setShowReport(false)} />
      <SecurityScanOverlay
        visible={scanOverlay}
        onComplete={() => {
          setScanOverlay(false);
          if (pendingDownload) {
            window.open(pendingDownload, "_blank");
            setPendingDownload(null);
          }
        }}
      />
      <ForwardMediaSheet
        open={forwardSheetOpen}
        media={forwardingMedia}
        text={forwardingText}
        onClose={() => {
          setForwardSheetOpen(false);
          setForwardingMedia(null);
          setForwardingText("");
        }}
        onSubmit={async (targetChatId, caption) => {
          if (!userId) return;
          if (!forwardingMedia && !forwardingText.trim()) return;
          const targetPreferences = await getChatPreferences(targetChatId);
          const msgId = generateUUIDv4();
          const payload: P2PMessage = {
            id: msgId,
            from: userId,
            to: targetChatId,
            text: forwardingMedia ? "" : forwardingText,
            timestamp: Date.now(),
            status: "sent",
            media: forwardingMedia || undefined,
            caption: forwardingMedia ? caption : undefined,
            deleteAt: getDeleteAt(Date.now(), targetPreferences.disappearingDuration || "off"),
          };
          const peerId = targetChatId;
          const sent = await sendP2PMessage(peerId, payload);
          void sent;
          const lastMessage = forwardingMedia ? caption || forwardingMedia.name : forwardingText;
          await saveChatMeta({
            friendId: targetChatId,
            friendName: targetChatId.substring(0, 8),
            lastMessage,
            lastMessageTime: Date.now(),
            unread: 0,
            started: true,
          });
          setForwardSheetOpen(false);
          setForwardingMedia(null);
          setForwardingText("");
          setSelectedIds([]);
          toast({ title: t("forwarded") });
        }}
      />
      <MuteModal
        open={muteOpen}
        onClose={() => setMuteOpen(false)}
        onMute={async (duration: string) => {
          await updateChatPreferences(chatId, {
            mutedUntil: getMuteUntil(duration as DisappearingDuration | "always"),
          });
          setChatMuted(true);
          setMuteOpen(false);
        }}
      />
      <ContactAssignSheet
        open={assignOpen}
        chatId={chatId}
        chatName={name}
        onClose={() => setAssignOpen(false)}
      />
      <DeleteMessageSheet
        open={deleteSheetOpen}
        canDeleteForEveryone={canDeleteForEveryone}
        onClose={() => setDeleteSheetOpen(false)}
        onDeleteForMe={handleDeleteForMe}
        onDeleteForEveryone={handleDeleteForEveryone}
      />

      <RoundVideoRecorder
        open={showRoundVideo}
        onClose={() => setShowRoundVideo(false)}
        onRecorded={handleRoundVideoRecorded}
      />

      <OneTimeViewer
        open={!!viewerMessage}
        url={viewerMessage?.media?.url || ""}
        mediaType={
          (viewerMessage?.media?.type === "image"
            ? "image"
            : viewerMessage?.roundVideo || viewerMessage?.media?.mimeType?.startsWith("video")
              ? "video"
              : viewerMessage?.media?.type || "file") as "image" | "video" | "audio" | "file"
        }
        onClose={() => setViewerMessage(null)}
        onConsumed={() => {
          if (viewerMessage) void purgeOneTimeMedia(viewerMessage);
        }}
      />
      <SelectiveCopySheet
        open={!!copyTarget}
        text={
          copyTarget
            ? getEffectiveText(
                messages.find((m) => m.id === copyTarget) ||
                  ({ id: "", text: "", sent: false, time: "", status: "sent" } as Message),
              ).text
            : ""
        }
        onClose={() => setCopyTarget(null)}
      />
      <DisappearingMessagesModal
        open={disappearingModalOpen}
        onClose={() => setDisappearingModalOpen(false)}
        onSelect={async (duration: DisappearingDuration) => {
          await updateChatPreferences(chatId, { disappearingDuration: duration });
          setDisappearingDuration(duration);
          setDisappearingModalOpen(false);
          const label =
            duration === "off"
              ? t("disappearingOff")
              : `${t("disappearingOn")} — ${duration.toUpperCase()}`;
          setSystemBubbles((prev) => [
            ...prev,
            {
              id: `sys-${Date.now()}`,
              text: label,
              sent: false,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              status: "sent",
              system: true,
            },
          ]);
        }}
      />
      <ChatProfileSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        peerName={name}
        messages={messages as unknown as Parameters<typeof ChatProfileSheet>[0]["messages"]}
      />
    </div>
  );
};

export default ChatRoom;
