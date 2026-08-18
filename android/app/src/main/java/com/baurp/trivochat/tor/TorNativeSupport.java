package com.baurp.trivochat.tor;

import android.os.Build;
import android.util.Log;

/**
 * Deferred, crash-proof loader for the tor native runtime.
 *
 * `org.torproject.jni.TorService` (tor-android 0.4.5.7) executes
 * `System.loadLibrary("tor")` inside a STATIC initialiser. Any reference to
 * that class therefore triggers the JNI load at class-loading time, and on a
 * device whose ABI has no packaged `libtor.so` the resulting
 * UnsatisfiedLinkError / ExceptionInInitializerError kills the process before
 * a single frame is drawn.
 *
 * This helper:
 *   1. never touches tor during app start — it is only called from the
 *      explicit `start()` path of the transport service;
 *   2. loads the library itself, first, inside try/catch(Throwable), so the
 *      failure is observable and recoverable;
 *   3. only then resolves TorService, whose static block becomes a no-op
 *      because the library is already loaded (or fails in a guarded frame).
 */
public final class TorNativeSupport {

    private static final String TAG = "TorNativeSupport";

    private static volatile Boolean available = null;
    private static volatile String failure = null;

    private TorNativeSupport() {}

    /** Human-readable reason the native runtime is unusable, or null. */
    public static String failureReason() {
        return failure;
    }

    /** Best-effort ABI report, useful when diagnosing missing libtor.so. */
    public static String supportedAbis() {
        try {
            String[] abis = Build.SUPPORTED_ABIS;
            return abis == null ? "unknown" : String.join(",", abis);
        } catch (Throwable t) {
            return "unknown";
        }
    }

    /**
     * @return true when tor's native library AND its JNI facade are usable on
     *         this device. Never throws.
     */
    public static synchronized boolean ensureLoaded() {
        if (available != null) return available;

        try {
            System.loadLibrary("tor");
            Log.i(TAG, "libtor.so loaded for ABIs " + supportedAbis());
        } catch (Throwable linkFailure) {
            // Some builds of tor-android name/stage the library differently and
            // load it from their own static block; do not give up yet.
            Log.w(TAG, "Direct libtor.so load failed (" + linkFailure + "), trying JNI facade");
        }

        try {
            Class.forName("org.torproject.jni.TorService", true,
                    TorNativeSupport.class.getClassLoader());
            available = Boolean.TRUE;
            failure = null;
            Log.i(TAG, "Tor native runtime is available");
        } catch (Throwable classFailure) {
            available = Boolean.FALSE;
            failure = "Tor native runtime unavailable on this device ("
                    + supportedAbis()
                    + "): "
                    + classFailure.getClass().getSimpleName()
                    + ": "
                    + String.valueOf(classFailure.getMessage());
            Log.e(TAG, failure, classFailure);
        }

        return available;
    }
}
