package com.baurp.trivochat.tor;

/**
 * Bounded recovery of a native Tor service binding after a daemon crash.
 * Pure Java so the backoff and exhaustion rules run in ordinary JVM CI.
 * A failed Keystore identity is NOT a reason to retry with another onion.
 */
final class TorReconnectPolicy {
    static final int MAX_ATTEMPTS = 3;
    private static final long BASE_DELAY_MS = 3_000L;
    private static final long MAX_DELAY_MS = 12_000L;

    private TorReconnectPolicy() { }

    /** Attempt numbers are 1-based. -1 means stop instead of looping. */
    static long delayMs(int attempt) {
        if (attempt < 1 || attempt > MAX_ATTEMPTS) return -1L;
        return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (1L << (attempt - 1)));
    }

    /** Service must still have the original verified Tor identity. */
    static boolean canRecover(String originalSecretKey, boolean shuttingDown) {
        return !shuttingDown && originalSecretKey != null
                && originalSecretKey.startsWith("ED25519-V3:")
                && originalSecretKey.length() > "ED25519-V3:".length();
    }
}
