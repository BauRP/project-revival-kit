package com.baurp.trivochat.tor;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * File-backed, crash-safe FIFO queue used by {@link TorOnionService}.
 *
 * The whole point of this class is that delivery must survive the WebView
 * being destroyed and the app being swiped away: the JS/IndexedDB outbox is
 * unreachable from the background, so every frame handed to the native layer
 * is also persisted here as a single JSON document that is rewritten
 * atomically on every mutation.
 */
public final class OnionFrameQueue {

    private static final String TAG = "OnionFrameQueue";

    public static final class Entry {
        public final String id;
        public final String onion;
        public final String frame;
        public int attempts;
        public long createdAt;
        public long nextAttemptAt;

        Entry(String id, String onion, String frame, int attempts, long createdAt, long nextAttemptAt) {
            this.id = id;
            this.onion = onion;
            this.frame = frame;
            this.attempts = attempts;
            this.createdAt = createdAt;
            this.nextAttemptAt = nextAttemptAt;
        }
    }

    private final File file;
    private final LinkedHashMap<String, Entry> entries = new LinkedHashMap<>();
    private final Object lock = new Object();
    private boolean loaded = false;

    public OnionFrameQueue(Context context, String name) {
        this.file = new File(context.getFilesDir(), "trivo-onion-" + name + ".json");
    }

    private void ensureLoadedLocked() {
        if (loaded) return;
        loaded = true;
        entries.clear();
        if (!file.exists()) return;
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            long length = raf.length();
            if (length <= 0L || length > Integer.MAX_VALUE) return;
            byte[] buf = new byte[(int) length];
            raf.readFully(buf);
            String raw = new String(buf, StandardCharsets.UTF_8);
            if (raw.trim().isEmpty()) return;
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                String id = o.optString("id", "");
                if (id.isEmpty()) continue;
                entries.put(id, new Entry(
                        id,
                        o.optString("onion", ""),
                        o.optString("frame", ""),
                        o.optInt("attempts", 0),
                        o.optLong("createdAt", System.currentTimeMillis()),
                        o.optLong("nextAttemptAt", 0L)));
            }
        } catch (IOException | JSONException | OutOfMemoryError e) {
            entries.clear();
            Log.w(TAG, "queue load failed: " + e.getMessage());
        }
    }

    private void persistLocked() {
        ensureLoadedLocked();
        JSONArray arr = new JSONArray();
        for (Entry e : entries.values()) {
            JSONObject o = new JSONObject();
            try {
                o.put("id", e.id);
                o.put("onion", e.onion);
                o.put("frame", e.frame);
                o.put("attempts", e.attempts);
                o.put("createdAt", e.createdAt);
                o.put("nextAttemptAt", e.nextAttemptAt);
            } catch (JSONException ignored) {
                continue;
            }
            arr.put(o);
        }
        File tmp = new File(file.getAbsolutePath() + ".tmp");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(arr.toString().getBytes(StandardCharsets.UTF_8));
            fos.getFD().sync();
        } catch (IOException e) {
            Log.w(TAG, "queue persist failed: " + e.getMessage());
            return;
        }
        if (!tmp.renameTo(file)) {
            // renameTo can fail on some vendor FS layers — fall back to a copy.
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(arr.toString().getBytes(StandardCharsets.UTF_8));
                fos.getFD().sync();
            } catch (IOException e) {
                Log.w(TAG, "queue fallback persist failed: " + e.getMessage());
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    public void put(String id, String onion, String frame) {
        if (id == null || id.isEmpty() || frame == null) return;
        synchronized (lock) {
            ensureLoadedLocked();
            Entry existing = entries.get(id);
            long now = System.currentTimeMillis();
            entries.put(id, new Entry(
                    id,
                    onion == null ? "" : onion,
                    frame,
                    existing == null ? 0 : existing.attempts,
                    existing == null ? now : existing.createdAt,
                    0L));
            persistLocked();
        }
    }

    /** Append-only push used for inbound frames (auto-generated id). */
    public void push(String frame) {
        put("in-" + System.nanoTime() + "-" + Math.abs(frame.hashCode()), "", frame);
    }

    public boolean remove(String id) {
        synchronized (lock) {
            ensureLoadedLocked();
            boolean removed = entries.remove(id) != null;
            if (removed) persistLocked();
            return removed;
        }
    }

    public List<Entry> due(long now) {
        synchronized (lock) {
            ensureLoadedLocked();
            List<Entry> out = new ArrayList<>();
            for (Entry e : entries.values()) {
                if (e.nextAttemptAt <= now) out.add(e);
            }
            return out;
        }
    }

    public List<Entry> snapshot() {
        synchronized (lock) {
            ensureLoadedLocked();
            return new ArrayList<>(entries.values());
        }
    }

    /** Exponential-ish backoff capped at 60 s so retries stay battery friendly. */
    public void backoff(String id) {
        synchronized (lock) {
            ensureLoadedLocked();
            Entry e = entries.get(id);
            if (e == null) return;
            e.attempts += 1;
            long delay = Math.min(60_000L, 5_000L * (long) Math.max(1, e.attempts));
            e.nextAttemptAt = System.currentTimeMillis() + delay;
            persistLocked();
        }
    }

    /** Pops every entry and clears the store — used to hand frames to the WebView. */
    public List<String> drainFrames() {
        synchronized (lock) {
            ensureLoadedLocked();
            List<String> out = new ArrayList<>();
            for (Map.Entry<String, Entry> e : entries.entrySet()) out.add(e.getValue().frame);
            entries.clear();
            persistLocked();
            return out;
        }
    }

    public List<String> drainIds() {
        synchronized (lock) {
            ensureLoadedLocked();
            List<String> out = new ArrayList<>(entries.keySet());
            entries.clear();
            persistLocked();
            return out;
        }
    }

    public int size() {
        synchronized (lock) {
            ensureLoadedLocked();
            return entries.size();
        }
    }
}
