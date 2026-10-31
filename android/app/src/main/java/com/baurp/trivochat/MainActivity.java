package com.baurp.trivochat;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * Trivo Chat Elite — launcher activity.
 *
 * Defensive contract:
 *  - Plugin registration happens BEFORE super.onCreate() (Capacitor 8 rule) but
 *    every single registration is individually wrapped in a Throwable guard.
 *    A missing optional SDK (e.g. Tor transport classes stripped by R8 or absent
 *    from a build flavour) raises NoClassDefFoundError here, which would
 *    otherwise abort onCreate and surface as
 *    "Trivo Chat Elite keeps stopping" before a single pixel is drawn.
 *  - DOM storage / database storage are explicitly enabled on the WebView so
 *    localStorage and IndexedDB are usable; the JS layer additionally falls
 *    back to in-memory storage if the container still blocks them.
 *  - No runtime permission is requested here. Permissions are requested lazily
 *    by the corresponding Capacitor plugin when the user opens the camera,
 *    the gallery picker or the microphone.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "TrivoMain";

    /** Installed once; keeps background-thread crashes out of the process killer. */
    private static void installGlobalExceptionHandler() {
        try {
            final Thread.UncaughtExceptionHandler previous =
                    Thread.getDefaultUncaughtExceptionHandler();
            if (previous instanceof TrivoExceptionHandler) return;
            Thread.setDefaultUncaughtExceptionHandler(new TrivoExceptionHandler(previous));
            Log.i(TAG, "Global uncaught exception handler installed");
        } catch (Throwable t) {
            Log.e(TAG, "Unable to install global exception handler", t);
        }
    }

    private static final class TrivoExceptionHandler implements Thread.UncaughtExceptionHandler {
        private final Thread.UncaughtExceptionHandler delegate;

        TrivoExceptionHandler(Thread.UncaughtExceptionHandler delegate) {
            this.delegate = delegate;
        }

        @Override
        public void uncaughtException(Thread thread, Throwable throwable) {
            Log.e(TAG, "Uncaught exception on thread '" + thread.getName() + "'", throwable);
            boolean isMainThread = android.os.Looper.getMainLooper() != null
                    && android.os.Looper.getMainLooper().getThread() == thread;
            if (isMainThread && delegate != null) {
                // Main-thread failures must still reach the platform handler so
                // ANR/crash reporting stays intact.
                delegate.uncaughtException(thread, throwable);
                return;
            }
            // Background failures (Tor workers, executors) are logged and swallowed
            // so the WebView keeps running and can surface a diagnostic screen.
            Log.e(TAG, "Background thread failure contained; app continues");
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        installGlobalExceptionHandler();
        Log.i(TAG, "onCreate: registering optional native plugins");
        /*
         * Resolve optional plugin classes by name INSIDE the guard. Passing
         * a class literal as an argument would resolve the class before the
         * helper's try block is entered; a missing/transitively broken SDK
         * could therefore throw NoClassDefFoundError and terminate the process
         * before BridgeActivity drew its first frame.
         */
        registerPluginSafely("com.baurp.trivochat.TorTransportPlugin", "TorTransport");
        Log.i(TAG, "onCreate: plugin registration finished, entering BridgeActivity.onCreate()");

        try {
            super.onCreate(savedInstanceState);
            Log.i(TAG, "onCreate: BridgeActivity.onCreate() completed, hardening WebView");
            configureWebView();
            configureSystemBars();
            Log.i(TAG, "onCreate: native shell ready");
        } catch (Throwable fatal) {
            Log.e(TAG, "Fatal native launch failure", fatal);
            renderNativeDiagnostic(fatal);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (getBridge() == null) {
            Log.w(TAG, "Ignoring new intent because the Capacitor bridge is unavailable");
            setIntent(intent);
            return;
        }
        try {
            super.onNewIntent(intent);
        } catch (Throwable intentFailure) {
            Log.e(TAG, "Unable to deliver intent to Capacitor", intentFailure);
        }
    }

    private void registerPluginSafely(String className, String label) {
        try {
            Class<?> rawClass = Class.forName(className, false, getClassLoader());
            if (!Plugin.class.isAssignableFrom(rawClass)) {
                Log.e(TAG, "Optional plugin '" + label + "' does not extend Capacitor Plugin");
                return;
            }
            @SuppressWarnings("unchecked")
            Class<? extends Plugin> pluginClass = (Class<? extends Plugin>) rawClass;
            registerPlugin(pluginClass);
            Log.i(TAG, "Optional plugin '" + label + "' registered");
        } catch (Throwable t) {
            Log.e(TAG, "Optional plugin '" + label + "' not registered", t);
        }
    }

    private void configureWebView() {
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) return;
            WebSettings settings = webView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
        } catch (Throwable t) {
            Log.e(TAG, "WebView hardening skipped: " + t);
        }
    }

    /** Keep the entire WebView between Android system bars, including gesture navigation,
     * three-button navigation and display cutouts. Insets update on rotation and nav changes.
     * This is intentionally applied to the native WebView, not guessed from device size.
     */
    private void configureSystemBars() {
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) return;
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
                androidx.core.graphics.Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            ViewCompat.requestApplyInsets(webView);
        } catch (Throwable t) {
            Log.e(TAG, "System bar inset handling unavailable", t);
        }
    }

    /**
     * Last-resort native recovery surface for failures that happen before
     * React and its ErrorBoundary exist. This deliberately uses only Android
     * framework widgets, so it remains available if Capacitor, an optional native plugin, or
     * the packaged web assets fail during BridgeActivity initialization.
     */
    private void renderNativeDiagnostic(Throwable fatal) {
        try {
            StringWriter traceWriter = new StringWriter();
            fatal.printStackTrace(new PrintWriter(traceWriter));

            FrameLayout root = new FrameLayout(this);
            root.setBackgroundColor(0xFF08090D);

            ScrollView scroll = new ScrollView(this);
            scroll.setFillViewport(true);

            TextView report = new TextView(this);
            int padding = Math.round(24 * getResources().getDisplayMetrics().density);
            report.setPadding(padding, padding, padding, padding);
            report.setGravity(Gravity.START);
            report.setTextColor(0xFFE8ECF5);
            report.setTextSize(14);
            report.setText(
                    "Trivo Chat Elite — Emergency Diagnostics\n\n"
                            + "The native application shell could not be initialized. "
                            + "Your local keys and messages were not deleted.\n\n"
                            + "Technical reason:\n"
                            + fatal.getClass().getName()
                            + ": "
                            + String.valueOf(fatal.getMessage())
                            + "\n\nStack trace:\n"
                            + traceWriter);

            scroll.addView(report, new ScrollView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT));
            root.addView(scroll, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
            setContentView(root);
        } catch (Throwable diagnosticFailure) {
            Log.e(TAG, "Unable to render native diagnostics", diagnosticFailure);
        }
    }
}
