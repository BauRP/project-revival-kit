// Phase 3 §1 — Chat Profile / Media Hub. Indexes the chat's messages by
// MIME type into 5 tabs: ФОТО, ВИДЕО, ФАЙЛЫ, ССЫЛКИ, ГОЛОСОВЫЕ.
//
// Uses CSS-based tab switching (no list re-mount) so swapping tabs is
// instant even with large media counts — equivalent to ViewPager2 swap
// semantics on the web.

import { useMemo, useState } from "react";
import { X, FileText as FileIcon, Link as LinkIcon, Mic } from "lucide-react";
import DefaultAvatar from "./DefaultAvatar";
import { formatFileSize } from "@/lib/media";

type TabKey = "photo" | "video" | "file" | "link" | "voice";

interface MediaShape {
  type?: "image" | "audio" | "file" | "video";
  url?: string;
  name?: string;
  size?: number;
  mimeType?: string;
}

interface MessageShape {
  id: string;
  text?: string;
  body?: string;
  media?: MediaShape | null;
  roundVideo?: boolean;
  ts?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  peerName: string;
  messages: MessageShape[];
}

const URL_RE = /(https?:\/\/[^\s]+)/gi;

const ChatProfileSheet = ({ open, onClose, peerName, messages }: Props) => {
  const [tab, setTab] = useState<TabKey>("photo");

  const indexed = useMemo(() => {
    const photos: MessageShape[] = [];
    const videos: MessageShape[] = [];
    const files: MessageShape[] = [];
    const voices: MessageShape[] = [];
    const links: { msgId: string; url: string; ts?: number }[] = [];

    for (const m of messages) {
      const media = m.media;
      if (media?.url) {
        const mime = media.mimeType || "";
        if (media.type === "image" || mime.startsWith("image/")) photos.push(m);
        else if (m.roundVideo || media.type === "video" || mime.startsWith("video/")) videos.push(m);
        else if (media.type === "audio" || mime.startsWith("audio/")) voices.push(m);
        else files.push(m);
      }
      const text = m.text || m.body || "";
      if (text) {
        const matches = text.match(URL_RE);
        if (matches) {
          for (const url of matches) links.push({ msgId: m.id, url, ts: m.ts });
        }
      }
    }
    return { photos, videos, files, voices, links };
  }, [messages]);

  if (!open) return null;

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: "photo", label: "ФОТО", count: indexed.photos.length },
    { key: "video", label: "ВИДЕО", count: indexed.videos.length },
    { key: "file", label: "ФАЙЛЫ", count: indexed.files.length },
    { key: "link", label: "ССЫЛКИ", count: indexed.links.length },
    { key: "voice", label: "ГОЛОСОВЫЕ", count: indexed.voices.length },
  ];

  const openLink = (url: string) => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black flex flex-col">
      {/* Header */}
      <div className="header-safe-zone px-4 pb-3 flex items-center gap-3 border-b border-[#00FFFF]/20">
        <button
          onClick={onClose}
          aria-label="Закрыть"
          className="p-2 rounded-lg text-[#00FFFF] hover:bg-[#00FFFF]/10 transition-colors"
        >
          <X size={20} />
        </button>
        <h1 className="text-base font-semibold text-[#00FFFF]">Профиль чата</h1>
      </div>

      {/* Identity */}
      <div className="flex flex-col items-center pt-5 pb-4 px-4 border-b border-[#00FFFF]/10">
        <DefaultAvatar size={88} />
        <p className="mt-3 text-lg font-bold text-white">{peerName}</p>
        <p className="text-[11px] text-[#00FFFF]/60 mt-0.5">Зашифрованный чат</p>
      </div>

      {/* Tab strip — horizontal scroll */}
      <div className="overflow-x-auto scrollbar-hide border-b border-[#00FFFF]/20 bg-black shrink-0">
        <div className="flex gap-1 px-2 py-2 min-w-max">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide transition-all whitespace-nowrap ${
                  active
                    ? "bg-[#00FFFF] text-black"
                    : "text-[#00FFFF]/70 hover:bg-[#00FFFF]/10 border border-[#00FFFF]/20"
                }`}
                style={active ? { boxShadow: "0 0 6px rgba(0,255,255,0.5)" } : undefined}
              >
                {t.label} <span className="opacity-70">({t.count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body — keep all panels mounted (ViewPager2-equivalent), toggle visibility */}
      <div className="flex-1 overflow-y-auto scrollbar-hide bg-black">
        <Panel visible={tab === "photo"}>
          {indexed.photos.length === 0 ? (
            <Empty label="Нет фотографий" />
          ) : (
            <div className="grid grid-cols-3 gap-1 p-1">
              {indexed.photos.map((m) => (
                <a key={m.id} href={m.media!.url} target="_blank" rel="noopener noreferrer" className="aspect-square block">
                  <img src={m.media!.url} alt={m.media!.name || ""} className="w-full h-full object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          )}
        </Panel>

        <Panel visible={tab === "video"}>
          {indexed.videos.length === 0 ? (
            <Empty label="Нет видео" />
          ) : (
            <div className="grid grid-cols-2 gap-1 p-1">
              {indexed.videos.map((m) => (
                <video key={m.id} src={m.media!.url} controls playsInline className="w-full aspect-video object-cover bg-black" preload="metadata" />
              ))}
            </div>
          )}
        </Panel>

        <Panel visible={tab === "file"}>
          {indexed.files.length === 0 ? (
            <Empty label="Нет файлов" />
          ) : (
            <ul className="divide-y divide-[#00FFFF]/10">
              {indexed.files.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => openLink(m.media!.url!)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#00FFFF]/5 text-left transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#00FFFF]/10 border border-[#00FFFF]/30 flex items-center justify-center shrink-0">
                      <FileIcon size={18} className="text-[#00FFFF]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{m.media!.name || "Файл"}</p>
                      <p className="text-[11px] text-[#00FFFF]/60">{m.media!.size ? formatFileSize(m.media!.size) : ""}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel visible={tab === "link"}>
          {indexed.links.length === 0 ? (
            <Empty label="Нет ссылок" />
          ) : (
            <ul className="divide-y divide-[#00FFFF]/10">
              {indexed.links.map((l, idx) => (
                <li key={`${l.msgId}-${idx}`}>
                  <button
                    onClick={() => openLink(l.url)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#00FFFF]/5 text-left transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#00FFFF]/10 border border-[#00FFFF]/30 flex items-center justify-center shrink-0">
                      <LinkIcon size={18} className="text-[#00FFFF]" />
                    </div>
                    <p className="text-sm text-[#00FFFF] truncate flex-1">{l.url}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel visible={tab === "voice"}>
          {indexed.voices.length === 0 ? (
            <Empty label="Нет голосовых сообщений" />
          ) : (
            <ul className="divide-y divide-[#00FFFF]/10">
              {indexed.voices.map((m) => (
                <li key={m.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#00FFFF]/10 border border-[#00FFFF]/30 flex items-center justify-center shrink-0">
                    <Mic size={18} className="text-[#00FFFF]" />
                  </div>
                  <audio src={m.media!.url} controls className="flex-1 max-w-full" preload="none" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
};

const Panel = ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (
  <div style={{ display: visible ? "block" : "none" }}>{children}</div>
);

const Empty = ({ label }: { label: string }) => (
  <div className="flex items-center justify-center py-16">
    <p className="text-sm text-[#00FFFF]/40">{label}</p>
  </div>
);


export default ChatProfileSheet;
