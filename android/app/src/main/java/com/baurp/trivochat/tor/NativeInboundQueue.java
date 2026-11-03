package com.baurp.trivochat.tor;

import android.content.Context;
import android.util.AtomicFile;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/**
 * Durable, app-private queue for sealed inbound Tor frames.
 *
 * The transport must ACK a TCP frame only after an atomic disk write. The
 * WebView may be asleep or destroyed when the hidden service receives data.
 * Entries stay until JS has committed them to Dexie, then explicitly ACKs
 * removal through the Capacitor bridge. No cleartext messages are stored here.
 */
public final class NativeInboundQueue {
    private static final String TAG = "TrivoInboundQueue";
    private static final String DIR = "tor-inbox-v1";
    private static final long MAX_BYTES = 64L * 1024 * 1024;
    private static final int MAX_ENTRIES = 4096;
    private static final Object LOCK = new Object();

    public static final class Entry {
        public final String id;
        public final String frame;
        Entry(String id, String frame) {
            this.id = id;
            this.frame = frame;
        }
    }

    private NativeInboundQueue() {}

    private static File folder(Context context) throws IOException {
        File dir = new File(context.getFilesDir(), DIR);
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) {
            throw new IOException("Cannot create inbound queue");
        }
        return dir;
    }

    private static String hash(String frame) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(frame.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                result.append(Character.forDigit((b >>> 4) & 0xF, 16));
                result.append(Character.forDigit(b & 0xF, 16));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("SHA-256 unavailable", error);
        }
    }

    private static boolean safeId(String id) {
        return id != null && id.matches("[a-f0-9]{64}");
    }

    private static File[] entries(File folder) {
        File[] files = folder.listFiles((dir, name) -> name.matches("[a-f0-9]{64}\\.frame"));
        if (files == null) return new File[0];
        // Frame hashes are not chronological. Replay oldest persisted frames first.
        Arrays.sort(files, Comparator.comparingLong(File::lastModified)
                .thenComparing(File::getName));
        return files;
    }

    /** Save first, then tell the network sender the frame was received. */
    public static String store(Context context, String frame) throws IOException {
        if (frame == null || frame.isEmpty()) throw new IOException("Empty frame");
        final byte[] bytes = frame.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > Socks5Client.MAX_FRAME_BYTES) throw new IOException("Oversized frame");
        synchronized (LOCK) {
            File dir = folder(context);
            String id = hash(frame);
            File target = new File(dir, id + ".frame");
            if (target.isFile()) return id; // duplicate; safe to ACK again
            File[] pending = entries(dir);
            long total = 0;
            for (File file : pending) total += file.length();
            if (pending.length >= MAX_ENTRIES || total + bytes.length > MAX_BYTES)
                throw new IOException("Inbound queue full; sender must retry later");
            AtomicFile atomic = new AtomicFile(target);
            FileOutputStream out = null;
            try {
                out = atomic.startWrite();
                out.write(bytes);
                atomic.finishWrite(out);
            } catch (IOException error) {
                if (out != null) atomic.failWrite(out);
                throw error;
            }
            return id;
        }
    }

    public static List<Entry> pending(Context context, int maximum) throws IOException {
        synchronized (LOCK) {
            File[] files = entries(folder(context));
            List<Entry> result = new ArrayList<>();
            int cap = Math.max(1, Math.min(maximum, 8));
            for (File file : files) {
                if (result.size() >= cap) break;
                // Never allocate arbitrary lengths from a damaged queue file.
                long length = file.length();
                if (length <= 0 || length > Socks5Client.MAX_FRAME_BYTES) {
                    Log.e(TAG, "Invalid persisted Tor frame length: " + file.getName());
                    continue;
                }
                byte[] bytes = new byte[(int) length];
                try (FileInputStream in = new FileInputStream(file)) {
                    int pos = 0;
                    while (pos < bytes.length) {
                        int n = in.read(bytes, pos, bytes.length - pos);
                        if (n < 0) throw new IOException("Unexpected end of inbound frame");
                        pos += n;
                    }
                }
                String frame = new String(bytes, StandardCharsets.UTF_8);
                // Reject corrupted on-disk entries without stopping the replay
                // of unrelated sealed messages; retain the entry for diagnostics.
                if (!hash(frame).equals(file.getName().replace(".frame", ""))) {
                    Log.e(TAG, "Persisted Tor frame failed SHA-256 verification: " + file.getName());
                    continue;
                }
                result.add(new Entry(file.getName().replace(".frame", ""), frame));
            }
            return result;
        }
    }

    /** Delete only after a durable JS-side commit or explicit invalid-frame rejection. */
    public static boolean acknowledge(Context context, String id) throws IOException {
        if (!safeId(id)) throw new IOException("Invalid inbound queue ID");
        synchronized (LOCK) {
            File target = new File(folder(context), id + ".frame");
            return !target.exists() || target.delete();
        }
    }
}
