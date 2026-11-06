package com.baurp.trivochat.tor;

import static org.junit.Assert.assertArrayEquals;

import org.junit.Test;

/** Runs on the JVM in CI, no emulator or Android runtime required. */
public final class NativeInboundQueueFilesTest {
    private static final String A = "a".repeat(64) + ".frame";
    private static final String B = "b".repeat(64) + ".frame";

    @Test public void recognizesCommittedAndRecoverableBackupOnce() {
        assertArrayEquals(new String[] { A, B },
                NativeInboundQueueFiles.candidateBaseNames(new String[] {
                        B + ".bak", A, B, A + ".bak"
                }));
    }

    @Test public void neverReplaysUncommittedNewFile() {
        assertArrayEquals(new String[0],
                NativeInboundQueueFiles.candidateBaseNames(new String[] {
                        A + ".new", B + ".new", "pending.tmp",
                        "lost.frame", "x".repeat(64) + ".frame.tmp"
                }));
    }

    @Test public void rejectsPathTraversalAndUntrustedNames() {
        assertArrayEquals(new String[] { B },
                NativeInboundQueueFiles.candidateBaseNames(new String[] {
                        "../" + A, A + ".bak.bak", A.toUpperCase(),
                        B, "not-a-hash.frame", null
                }));
    }

    @Test public void countsBackupOnlyFramesWithoutDuplicatingIds() {
        assertArrayEquals(new String[] { A },
                NativeInboundQueueFiles.candidateBaseNames(new String[] {
                        A + ".bak", A + ".bak", A + ".new"
                }));
    }
}
