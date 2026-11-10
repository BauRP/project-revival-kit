import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause } from "lucide-react";
import TranscriptionPlate from "./TranscriptionPlate";
import { canReadWaveformLocally, readBoundedWaveformBytes } from "@/lib/waveform-policy";

interface AudioWaveformPlayerProps {
  src: string;
  name?: string;
  sent?: boolean;
}

const BAR_COUNT = 32;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const CANVAS_HEIGHT = 36;

const AudioWaveformPlayer = ({ src, name, sent }: AudioWaveformPlayerProps) => {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Use the browser's timeupdate event (~4 updates/s) rather than one React
  // render per animation frame for every visible voice message.

  // Decode only local, size-bounded audio. Downloading a remote link here
  // would disclose a private voice-message URL outside the Tor transport.
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let context: AudioContext | null = null;
    const fallback = Array.from({ length: BAR_COUNT },
      (_, i) => 0.22 + (i % 5) * 0.11);
    const generatePeaks = async () => {
      try {
        if (!canReadWaveformLocally(src, window.location.origin)) {
          setPeaks(fallback);
          return;
        }
        const response = await fetch(src, { signal: controller.signal });
        const data = await readBoundedWaveformBytes(response);
        if (!data || disposed) {
          if (!disposed) setPeaks(fallback);
          return;
        }
        const AudioContextType = window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextType) throw new Error("Audio decoder unavailable");
        context = new AudioContextType();
        const buffer = await context.decodeAudioData(data);
        if (disposed) return;
        const channel = buffer.getChannelData(0);
        if (!channel.length) { setPeaks(fallback); return; }
        const points: number[] = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          const from = Math.floor((i * channel.length) / BAR_COUNT);
          const to = Math.max(from + 1, Math.floor(((i + 1) * channel.length) / BAR_COUNT));
          // Sampling up to 1024 points per bar avoids O(duration*sampleRate)
          // work on the WebView renderer for long voice messages.
          const stride = Math.max(1, Math.floor((to - from) / 1024));
          let total = 0, count = 0;
          for (let p = from; p < to; p += stride) {
            total += Math.abs(channel[p]);
            count++;
          }
          points.push(count ? total / count : 0);
        }
        const max = Math.max(...points, 0.01);
        setPeaks(points.map(p => Math.max(0.08, p / max)));
      } catch {
        if (!disposed) setPeaks(fallback);
      } finally {
        if (context) void context.close().catch(() => undefined);
      }
    };
    void generatePeaks();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [src]);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, CANVAS_HEIGHT);

    const progress = duration > 0 ? currentTime / duration : 0;

    const primaryColor = sent
      ? "hsla(0, 0%, 100%, 0.9)"
      : getComputedStyle(document.documentElement).getPropertyValue("--primary")
        ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()})`
        : "#6366f1";

    const inactiveColor = sent ? "hsla(0, 0%, 100%, 0.3)" : "hsla(0, 0%, 60%, 0.3)";

    for (let i = 0; i < peaks.length; i++) {
      const x = i * (BAR_WIDTH + BAR_GAP);
      const barHeight = Math.max(4, peaks[i] * (CANVAS_HEIGHT - 4));
      const y = (CANVAS_HEIGHT - barHeight) / 2;
      const barProgress = i / peaks.length;

      ctx.fillStyle = barProgress <= progress ? primaryColor : inactiveColor;
      ctx.beginPath();
      ctx.roundRect(x, y, BAR_WIDTH, barHeight, 1.5);
      ctx.fill();
    }
  }, [peaks, currentTime, duration, sent]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // A rejected play() promise (no codec, device audio restriction) is not
    // a successful playback and must never leave a phantom "playing" state.
    void audio.play().catch(() => setPlaying(false));
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const canvasWidth = BAR_COUNT * (BAR_WIDTH + BAR_GAP);

  return (
    <div className="flex flex-col gap-1 min-w-[200px] w-full">
      <div className="flex items-center gap-2.5">
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
          onEnded={() => {
            setPlaying(false);
            setCurrentTime(0);
          }}
        />
        <button
          onClick={handlePlayPause}
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
            sent
              ? "bg-primary-foreground/20 hover:bg-primary-foreground/30"
              : "bg-primary/15 hover:bg-primary/25"
          }`}
        >
          {playing ? (
            <Pause size={16} className={sent ? "text-primary-foreground" : "text-primary"} />
          ) : (
            <Play
              size={16}
              className={`${sent ? "text-primary-foreground" : "text-primary"} ml-0.5`}
            />
          )}
        </button>
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={CANVAS_HEIGHT}
            className="w-full"
            style={{ height: CANVAS_HEIGHT }}
          />
          <div className="flex items-center justify-between">
            <span
              className={`text-[10px] ${sent ? "text-primary-foreground/60" : "text-muted-foreground"}`}
            >
              {formatTime(playing ? currentTime : 0)}
            </span>
            <span
              className={`text-[10px] ${sent ? "text-primary-foreground/60" : "text-muted-foreground"}`}
            >
              {duration > 0 ? formatTime(duration) : "--:--"}
            </span>
          </div>
        </div>
      </div>
      {/* Phase 3 §2 — STT plate, only for incoming voice messages. */}
      {!sent && <TranscriptionPlate audioUrl={src} />}
    </div>
  );
};

export default AudioWaveformPlayer;
