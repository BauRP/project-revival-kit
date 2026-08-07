import type { MediaAttachment } from "@/lib/media";

interface MediaClusterProps {
  items: MediaAttachment[];
  onOpen?: (item: MediaAttachment) => void;
}

/**
 * Phase 2 §3 — Photo album / media cluster.
 *
 * Groups 2–10 images into a compact CSS grid (2x2, 3x3, …) with a single
 * cohesive bubble. Each tile keeps the original href so external image
 * viewers still work.
 */
const MediaCluster = ({ items, onOpen }: MediaClusterProps) => {
  const count = items.length;
  if (count === 0) return null;
  if (count === 1) {
    const m = items[0];
    return (
      <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
        <img src={m.url} alt={m.name} className="rounded-xl max-w-full max-h-[240px] object-cover" loading="lazy" />
      </a>
    );
  }
  // 2: side-by-side; 3: 1+2; 4: 2x2; 5–6: 2 rows of 3; 7+: 3-col masonry-ish.
  const cols = count === 2 ? 2 : count <= 4 ? 2 : 3;
  return (
    <div
      className="grid gap-0.5 rounded-xl overflow-hidden border border-[#00FFFF]/20 max-w-full"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, width: 240 }}
    >
      {items.slice(0, 9).map((m, i) => {
        const extra = i === 8 && count > 9 ? count - 9 : 0;
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen?.(m); }}
            className="relative aspect-square overflow-hidden bg-black"
          >
            <img src={m.url} alt={m.name} className="w-full h-full object-cover" loading="lazy" />
            {extra > 0 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[#00FFFF] text-lg font-bold">
                +{extra}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default MediaCluster;
