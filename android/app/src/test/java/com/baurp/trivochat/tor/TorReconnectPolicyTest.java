package com.baurp.trivochat.tor;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Native Tor reconnect rules verified on the ordinary JVM in CI. */
public final class TorReconnectPolicyTest {
    @Test public void retriesAreBoundedAndUseBackoff() {
        assertEquals(-1L, TorReconnectPolicy.delayMs(0));
        assertEquals(3000L, TorReconnectPolicy.delayMs(1));
        assertEquals(6000L, TorReconnectPolicy.delayMs(2));
        assertEquals(12000L, TorReconnectPolicy.delayMs(3));
        assertEquals(-1L, TorReconnectPolicy.delayMs(4));
        assertEquals(-1L, TorReconnectPolicy.delayMs(Integer.MAX_VALUE));
    }

    @Test public void reconnectOnlyWithOriginalOnionIdentity() {
        assertTrue(TorReconnectPolicy.canRecover("ED25519-V3:existingkey", false));
        assertFalse(TorReconnectPolicy.canRecover("ED25519-V3:existingkey", true));
        assertFalse(TorReconnectPolicy.canRecover(null, false));
        assertFalse(TorReconnectPolicy.canRecover("", false));
        assertFalse(TorReconnectPolicy.canRecover("NEW:ED25519-V3", false));
        assertFalse(TorReconnectPolicy.canRecover("ED25519-V3:", false));
    }
}
