import { AnimatePresence, motion } from "framer-motion";
import { Clock, X } from "lucide-react";
import { useState } from "react";

interface ScheduleSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (epochMs: number) => void;
}

const presets = [
  { label: "+5 min", ms: 5 * 60_000 },
  { label: "+30 min", ms: 30 * 60_000 },
  { label: "+1 hour", ms: 60 * 60_000 },
  { label: "Tomorrow 9:00", ms: -1 }, // computed
];

const tomorrowAt9 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
};

const ScheduleSheet = ({ open, onClose, onConfirm }: ScheduleSheetProps) => {
  const [custom, setCustom] = useState("");

  const fire = (ts: number) => {
    if (ts <= Date.now() + 1000) return;
    onConfirm(ts);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            initial={{ y: 32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="fixed left-0 right-0 z-50 px-4"
            style={{ bottom: "calc(var(--bottom-nav-offset, 60px) + 76px)" }}
            role="dialog"
            aria-label="Schedule message"
          >
            <div className="mx-auto w-full max-w-2xl glass-panel neon-border rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-foreground">
                  <Clock size={18} className="text-primary" />
                  <span className="text-sm font-semibold">Schedule message</span>
                </div>
                <button onClick={onClose} className="p-1 text-muted-foreground" aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => fire(p.ms === -1 ? tomorrowAt9() : Date.now() + p.ms)}
                    className="px-3 py-2.5 rounded-xl bg-secondary/60 hover:bg-secondary text-sm text-foreground text-left transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Custom date &amp; time</label>
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    className="glass-input flex-1 py-2 px-3 text-sm"
                  />
                  <button
                    onClick={() => {
                      if (!custom) return;
                      const ts = new Date(custom).getTime();
                      if (Number.isFinite(ts)) fire(ts);
                    }}
                    disabled={!custom}
                    className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm disabled:opacity-40"
                  >
                    Set
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ScheduleSheet;
