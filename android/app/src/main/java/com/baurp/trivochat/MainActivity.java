package com.baurp.trivochat;

import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;

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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /*
         * Resolve optional plugin classes by name INSIDE the guard. Passing
         * a class literal as an argument would resolve the class before the
         * helper's try block is entered; a missing/transitively broken SDK
         * could therefore throw NoClassDefFoundError and terminate the process
         * before BridgeActivity drew its first frame.
         */
        registerPluginSafely("com.baurp.trivochat.TorTransportPlugin", "TorTransport");

        try {
            super.onCreate(savedInstanceState);
            configureWebView();
        } catch (Throwable fatal) {
            Log.e(TAG, "Fatal native launch failure", fatal);
            renderNativeDiagnostic(fatal);
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

    /**
     * Last-resort native recovery surface for failures that happen before
     * React and its ErrorBoundary exist. This deliberately uses only Android
     * framework widgets, so it remains available if Capacitor, an ads SDK, or
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
