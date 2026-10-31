package com.baurp.trivochat;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screenshot/recents-preview protection for sensitive one-time attachments.
 * The flag belongs to the Android window, not CSS. It is removed when the
 * viewer is dismissed, paused, destroyed or when the plugin is torn down.
 * Another phone can still photograph the physical display.
 */
@CapacitorPlugin(name = "SecureView")
public class SecureViewPlugin extends Plugin {

    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean enabled = call.getBoolean("enabled", false);
        if (getActivity() == null) {
            call.reject("No active Android window");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                if (enabled) {
                    getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                } else {
                    getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
                call.resolve();
            } catch (Throwable error) {
                call.reject("Unable to change window screenshot protection", error);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() ->
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE));
        }
        super.handleOnDestroy();
    }
}
