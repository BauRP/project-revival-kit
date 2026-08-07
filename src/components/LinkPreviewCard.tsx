import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link2, X } from "lucide-react";
import { fetchLinkPreview, type LinkPreview } from "@/lib/link-preview";

interface LinkPreviewCardProps {
  url: string;
  /** Compact draft preview rendered above the input bar. */
  variant?: "draft" | "bubble";
  onDismiss?: () => void;
}

const LinkPreviewCard = ({ url, variant = "bubble", onDismiss }: LinkPreviewCardProps) => {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchLinkPreview(url).then((p) => {
      if (!mounted) return;
      setPreview(p);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [url]);

  if (loading && variant === "bubble") return null;
  if (!preview && !loading) return null;

  const inner = (
    <div className="flex items-stretch gap-2 rounded-lg overflow-hidden bg-black border border-[#00FFFF]/30">
      {preview?.image && (
        <img
          src={preview.image}
          alt=""
          className="w-16 h-16 object-cover shrink-0"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div className="flex-1 min-w-0 p-2 pr-3">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#00FFFF]/80 truncate">
          <Link2 size={10} />
          <span className="truncate">{preview?.siteName || (preview ? new URL(preview.url).hostname : "")}</span>
        </div>
        {preview?.title && <p className="text-xs font-semibold text-foreground truncate">{preview.title}</p>}
        {preview?.description && (
          <p className="text-[11px] text-muted-foreground line-clamp-2">{preview.description}</p>
        )}
        {!preview && loading && <p className="text-[11px] text-muted-foreground italic">Loading preview…</p>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="p-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss link preview"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );

  if (variant === "draft") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        className="px-3 pb-2"
      >
        {inner}
      </motion.div>
    );
  }
  return <div className="mt-1.5 max-w-full">{inner}</div>;
};

export default LinkPreviewCard;
