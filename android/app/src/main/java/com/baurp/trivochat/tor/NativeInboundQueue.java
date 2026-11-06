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

    private static File[] entries(File folder) throws IOException {
        File[] files = folder.listFiles();
        if (files == null) throw new IOException("Cannot enumerate inbound queue");
        String[] names = new String[files.length];
        for (int i = 0; i < files.length; i++) names[i] = files[i].getName();
        String[] basenames = NativeInboundQueueFiles.candidateBaseNames(names);
        File[] result = new File[basenames.length];
        for (int i = 0; i < basenames.length; i++) {
            File base = new File(folder, basenames[i]);
            // Android's AtomicFile can leave a legacy .bak after abrupt
            // termination. Reading base directly would silently ignore an
            // otherwise recoverable, previously ACKed sealed frame.
            File backup = new File(base.getPath() + ".bak");
            if (backup.exists()) {
                try (FileInputStream ignored = new AtomicFile(base).openRead()) {
                    // openRead restores a legacy backup before returning.
                } catch (IOException failure) {
                    // Preserve the backup for a later recovery attempt;
                    // never discard private messages to unblock the queue.
                    Log.e(TAG, "Unable to recover atomic inbound backup " + base.getName(), failure);
                }
            }
            result[i] = base;
        }
        // Frame hashes are not chronological. Replay oldest persisted frames first.
        Arrays.sort(result, Comparator.comparingLong(File::lastModified)
                .thenComparing(File::getName));
        return result;
    }

    /** Save first, then tell the network sender the frame was received. */
    public static String store(Context context, String frame) throws IOException {
        if (frame == null || frame.isEmpty()) throw new IOException("Empty frame");
        final byte[] bytes = frame.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > Socks5Client.MAX_FRAME_BYTES) throw new IOException("Oversized frame");
        synchronized (LOCK) {
            File dir = folder(context);
            // Recover legacy atomic backups BEFORE testing duplicate data,
            // enforcing queue limits or deciding that an entry is new.
            File[] pending = entries(dir);
            String id = hash(frame);
            File target = new File(dir, id + ".frame");
            // A hash-derived filename is not evidence that its on-disk bytes
            // survived a crash, disk error or truncated atomic replacement.
            // Only ACK a duplicate if the persisted content still matches.
            boolean existing = target.isFile();
            if (existing && target.length() == bytes.length) {
                boolean identical = true;
                try (FileInputStream in = new FileInputStream(target)) {
                    byte[] buffer = new byte[8192];
                    int offset = 0;
                    while (offset < bytes.length) {
                        int size = in.read(buffer, 0, Math.min(buffer.length, bytes.length - offset));
                        if (size <= 0) { identical = false; break; }
                        for (int i = 0; i < size; i++) {
                            if (buffer[i] != bytes[offset + i]) {
                                identical = false; break;
                            }
                        }
                        if (!identical) break;
                        offset += size;
                    }
                    if (offset != bytes.length) identical = false;
                } catch (IOException ignored) {
                    identical = false;
                }
                if (identical) return id;
            }
            long total = 0;
            for (File file : pending) {
                File legacy = new File(file.getPath() + ".bak");
                total += file.isFile() ? file.length() : legacy.length();
            }
            // Replacing a corrupted entry should not count twice against the
            // queue budget. AtomicFile commits the new bytes before TCP ACK.
            File legacyTarget = new File(target.getPath() + ".bak");
            boolean reserved = existing || legacyTarget.isFile();
            long replacedLength = existing ? target.length() :
                    (legacyTarget.isFile() ? legacyTarget.length() : 0L);
            int prospectiveEntries = pending.length + (reserved ? 0 : 1);
            if (prospectiveEntries > MAX_ENTRIES ||
                total - replacedLength + bytes.length > MAX_BYTES)
                throw new IOException("Inbound queue full; sender must retry later");
            if (existing) Log.w(TAG, "Replacing damaged inbound frame " + id);
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
            // Some platform AtomicFile implementations log a failed rename
            // instead of throwing. Verify committed bytes before transport
            // emits the TCP ACK: otherwise a power/storage error could lose
            // a message permanently.
            if (!target.isFile() || target.length() != bytes.length ||
                    !matchesCommittedBytes(atomic, bytes))
                throw new IOException("Inbound atomic commit could not be verified");
            return id;
        }
    }

    private static boolean matchesCommittedBytes(AtomicFile atomic, byte[] bytes) {
        try (FileInputStream in = atomic.openRead()) {
            byte[] buffer = new byte[8192];
            int offset = 0;
            while (offset < bytes.length) {
                int n = in.read(buffer, 0, Math.min(buffer.length, bytes.length - offset));
                if (n <= 0) return false;
                for (int i = 0; i < n; i++) {
                    if (buffer[i] != bytes[offset + i]) return false;
                }
                offset += n;
            }
            return in.read() == -1;
        } catch (IOException failure) {
            Log.e(TAG, "Unable to verify inbound atomic commit", failure);
            return false;
        }
    }

    public static List<Entry> pending(Context context, int maximum, int offset) throws IOException {
        if (offset < 0 || offset > MAX_ENTRIES)
            throw new IOException("Invalid inbound queue page offset");
        synchronized (LOCK) {
            File[] files = entries(folder(context));
            List<Entry> result = new ArrayList<>();
            int cap = Math.max(1, Math.min(maximum, 8));
            int validBefore = 0;
            for (File file : files) {
                if (result.size() >= cap) break;
                // Never allocate arbitrary lengths from a damaged queue file.
                long length = file.length();
                if (length <= 0 || length > Socks5Client.MAX_FRAME_BYTES) {
                    Log.e(TAG, "Invalid persisted Tor frame length: " + file.getName());
                    continue;
                }
                byte[] bytes = new byte[(int) length];
                try (FileInputStream in = new AtomicFile(file).openRead()) {
                    int pos = 0;
                    while (pos < bytes.length) {
                        int n = in.read(bytes, pos, bytes.length - pos);
                        if (n <= 0) throw new IOException("Unexpected end of inbound frame");
                        pos += n;
                    }
                } catch (IOException readError) {
                    // Never let one truncated/corrupted file stall every
                    // later inbound message after a crash or storage error.
                    Log.e(TAG, "Skipping unreadable Tor queue entry: " + file.getName(), readError);
                    continue;
                }
                String frame = new String(bytes, StandardCharsets.UTF_8);
                // Reject corrupted on-disk entries without stopping the replay
                // of unrelated sealed messages; retain the entry for diagnostics.
                if (!hash(frame).equals(file.getName().replace(".frame", ""))) {
                    Log.e(TAG, "Persisted Tor frame failed SHA-256 verification: " + file.getName());
                    continue;
                }
                // Page through valid frames so one persistently unprocessable
                // entry cannot keep all later frames behind the first batch.
                if (validBefore++ < offset) continue;
                result.add(new Entry(file.getName().replace(".frame", ""), frame));
            }
            return result;
        }
    }

    /** Count raw pending entries, including corrupted frames. Identity
     * transfer must not assume the queue is empty when decoding fails. */
    public static int count(Context context) throws IOException {
        synchronized (LOCK) {
            return entries(folder(context)).length;
        }
    }

    /** Account deletion: erase every queued sealed frame, including atomic
     * write remnants. This must never be called on ordinary Tor shutdown.
     */
    public static void clear(Context context) throws IOException {
        synchronized (LOCK) {
            File dir = folder(context);
            File[] files = dir.listFiles();
            if (files == null) throw new IOException("Cannot list native inbox");
            for (File file : files) {
                if (!file.isFile() || !file.delete())
                    throw new IOException("Cannot erase native inbound queue file");
            }
        }
    }

    /** Delete only after a durable JS-side commit or explicit invalid-frame rejection. */
    public static boolean acknowledge(Context context, String id) throws IOException {
        if (!safeId(id)) throw new IOException("Invalid inbound queue ID");
        synchronized (LOCK) {
            File target = new File(folder(context), id + ".frame");
            AtomicFile atomic = new AtomicFile(target);
            // Deleting only the base would allow an old legacy .bak to
            // resurrect the acknowledged frame on the next replay.
            atomic.delete();
            return !target.exists() &&
                    !new File(target.getPath() + ".bak").exists() &&
                    !new File(target.getPath() + ".new").exists();
        }
    }
}
