// Round Video Recorder — Telegram-style 1:1 circular video capture.
//
// Web layer uses MediaRecorder with the front camera at 1:1 aspect.
// The neon-cyan progress ring traces the edge of the circular preview during
// recording. On Android the same UI shells around CameraX (see legacy/android
// TODO stubs) for hardware-accelerated MP4 encoding.

import { motion, AnimatePresence } from "framer-motion";
import { X, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";

interface RoundVideoRecorderProps {
  open: boolean;
  onClose: () => void;
  onRecorded: (file: File, durationMs: number) => void;
  /** Max duration in ms (default 60s, matches Telegram). */
  maxDurationMs?: number;
}

const PREVIEW_SIZE = 240; // px
const RING_STROKE = 4;

const RoundVideoRecorder = ({ open, onClose, onRecorded, maxDurationMs = 60_000 }: RoundVideoRecorderProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [elapsed, setElapsed] = useState(0);

  const cleanup = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setProgress(0);
    setElapsed(0);
  };

  useEffect(() => {
    if (!open) { cleanup(); return; }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 480, height: 480 },
          audio: true,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => { /* autoplay race */ });
        }
      } catch (err) {
        console.error("[RoundVideo] camera error", err);
        toast({ title: "Camera unavailable", variant: "destructive" });
        onClose();
      }
    })();
    return () => { cancelled = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const tick = () => {
    const now = performance.now();
    const dt = now - startedAtRef.current;
    setElapsed(dt);
    setProgress(Math.min(1, dt / maxDurationMs));
    if (dt >= maxDurationMs) {
      stopAndSend();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const startRecording = () => {
    if (!streamRef.current || recording) return;
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("video/mp4")
      ? "video/mp4"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
    const rec = new MediaRecorder(streamRef.current, { mimeType: mime, videoBitsPerSecond: 1_000_000 });
    recorderRef.current = rec;
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.start(250);
    startedAtRef.current = performance.now();
    setRecording(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const stopAndSend = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const duration = performance.now() - startedAtRef.current;
    rec.onstop = () => {
      const ext = rec.mimeType.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      const file = new File([blob], `round-video-${Date.now()}.${ext}`, { type: rec.mimeType });
      onRecorded(file, Math.round(duration));
      cleanup();
      onClose();
    };
    try { rec.stop(); } catch { /* ignore */ }
  };

  const cancel = () => { cleanup(); onClose(); };

  // Ring geometry
  const radius = (PREVIEW_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  const elapsedSec = (elapsed / 1000).toFixed(1);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[90] bg-black flex flex-col items-center justify-center"
          role="dialog"
          aria-label="Round video recorder"
        >
          <button
            type="button"
            onClick={cancel}
            className="absolute top-[max(env(safe-area-inset-top),16px)] right-4 p-2 rounded-full bg-white/5 text-white"
            aria-label="Close"
          >
            <X size={22} />
          </button>

          <div className="relative" style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}>
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover rounded-full"
              style={{
                // Native-equivalent of PorterDuff DST_IN circular mask:
                // CSS clip-path on the rendered video.
                clipPath: "circle(50% at 50% 50%)",
                transform: "scaleX(-1)", // mirror like a selfie
              }}
            />
            <svg
              className="absolute inset-0 pointer-events-none"
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
            >
              <circle
                cx={PREVIEW_SIZE / 2}
                cy={PREVIEW_SIZE / 2}
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={RING_STROKE}
              />
              <circle
                cx={PREVIEW_SIZE / 2}
                cy={PREVIEW_SIZE / 2}
                r={radius}
                fill="none"
                stroke="#00FFFF"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={recording ? dashOffset : circumference}
                transform={`rotate(-90 ${PREVIEW_SIZE / 2} ${PREVIEW_SIZE / 2})`}
                style={{
                  transition: "stroke-dashoffset 80ms linear",
                  filter: recording ? "drop-shadow(0 0 6px #00FFFF)" : undefined,
                }}
              />
            </svg>
          </div>

          <p className="mt-6 text-xs font-mono tabular-nums text-[#00FFFF]">
            {recording ? `${elapsedSec}s` : "Tap to record"}
          </p>

          <div className="mt-6 flex items-center gap-6">
            {!recording ? (
              <button
                type="button"
                onClick={startRecording}
                className="w-16 h-16 rounded-full bg-[#00FFFF] text-black flex items-center justify-center"
                style={{ boxShadow: "0 0 18px rgba(0,255,255,0.7)" }}
                aria-label="Start recording"
              >
                <span className="w-6 h-6 rounded-full bg-black" />
              </button>
            ) : (
              <button
                type="button"
                onClick={stopAndSend}
                className="w-16 h-16 rounded-full bg-[#00FFFF] text-black flex items-center justify-center"
                style={{ boxShadow: "0 0 22px rgba(0,255,255,0.9)" }}
                aria-label="Stop and send"
              >
                <Send size={24} />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default RoundVideoRecorder;
