package com.baurp.trivochat.tor;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Pure JVM filename policy for Android AtomicFile's committed base and
 * recoverable legacy backup. A .new file alone is an unfinished write, NOT a
 * durably accepted frame: the sender must retry it.
 */
final class NativeInboundQueueFiles {
    private NativeInboundQueueFiles() {}

    static String[] candidateBaseNames(String[] names) {
        Set<String> found = new HashSet<>();
        for (String name : names) {
            if (name == null) continue;
            String base = name.endsWith(".bak")
                    ? name.substring(0, name.length() - 4) : name;
            if (base.matches("[a-f0-9]{64}\\.frame") &&
                    (name.equals(base) || name.equals(base + ".bak"))) {
                found.add(base);
            }
        }
        String[] bases = found.toArray(new String[0]);
        Arrays.sort(bases);
        return bases;
    }
}
