import { useEffect, useRef, useState } from "react";

/**
 * Phase 2 §2 — Spoiler text.
 *
 * Renders a span that initially hides its children behind a Pure-Black overlay
 * with an animated "noise/particle" effect. A single tap reveals the content.
 *
 * Markup convention: text wrapped in ||...|| is treated as a spoiler. See
 * {@link parseSpoilers} for the splitter helper used by the chat bubble.
 */
export const SpoilerText = ({ text }: { text: string }) => {
  const [revealed, setRevealed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Lightweight neon-cyan particle drift painted onto a small canvas. Pure
  // CSS can't reproduce the moving-noise feel without dropping a heavy
  // background-image so we keep this self-contained.
  useEffect(() => {
    if (revealed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let cancelled = false;
    const PARTICLES = 28;
    const dots = Array.from({ length: PARTICLES }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.004,
      vy: (Math.random() - 0.5) * 0.004,
      r: 0.6 + Math.random() * 1.2,
    }));
    const draw = () => {
      if (cancelled) return;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0 || d.x > 1) d.vx *= -1;
        if (d.y < 0 || d.y > 1) d.vy *= -1;
        ctx.beginPath();
        ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,255,255,0.55)";
        ctx.shadowColor = "rgba(0,255,255,0.9)";
        ctx.shadowBlur = 4;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [revealed]);

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
      className="relative inline-block align-baseline cursor-pointer rounded-sm"
      style={{
        padding: revealed ? 0 : "0 2px",
      }}
      role="button"
      aria-label={revealed ? "Spoiler revealed" : "Tap to reveal spoiler"}
    >
      <span style={{ visibility: revealed ? "visible" : "hidden" }}>{text}</span>
      {!revealed && (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="absolute inset-0 w-full h-full rounded-sm"
          style={{ border: "1px solid rgba(0,255,255,0.35)" }}
        />
      )}
    </span>
  );
};

/**
 * Splits a string into spoiler / plain segments based on the ||spoiler||
 * delimiter. Returns a list ready to render.
 */
export const parseSpoilers = (input: string): Array<{ type: "text" | "spoiler"; value: string }> => {
  const parts: Array<{ type: "text" | "spoiler"; value: string }> = [];
  const re = /\|\|([^|]+)\|\|/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: input.slice(last, m.index) });
    parts.push({ type: "spoiler", value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < input.length) parts.push({ type: "text", value: input.slice(last) });
  if (parts.length === 0) parts.push({ type: "text", value: input });
  return parts;
};

/** Renders a string with inline spoilers. Safe for use inside <p>. */
export const RichText = ({ text }: { text: string }) => {
  const parts = parseSpoilers(text);
  return (
    <>
      {parts.map((p, i) =>
        p.type === "spoiler" ? <SpoilerText key={i} text={p.value} /> : <span key={i}>{p.value}</span>,
      )}
    </>
  );
};
