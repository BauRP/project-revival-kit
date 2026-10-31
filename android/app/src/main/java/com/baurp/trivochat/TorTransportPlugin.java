package com.baurp.trivochat;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.baurp.trivochat.tor.TorOnionService;
import com.baurp.trivochat.tor.NativeInboundQueue;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Capacitor bridge for the Tor onion transport.
 * Every blocking call (dial, probe, ADD_ONION wait) runs off the UI thread.
 */
@CapacitorPlugin(name = "TorTransport")
public class TorTransportPlugin extends Plugin {

    private static final String TAG = "TorTransportPlugin";

    private final ExecutorService io = Executors.newCachedThreadPool();

    @Override
    public void load() {
        TorOnionService.setListener(new TorOnionService.Listener() {
            @Override
            public void onFrame(String frame) {
                JSObject evt = new JSObject();
                evt.put("frame", frame);
                evt.put("receivedAt", System.currentTimeMillis());
                notifyListeners("onionMessage", evt);
            }

            @Override
            public void onStatus(TorOnionService service) {
                notifyListeners("onionStatus", statusOf(service));
            }
        });
    }

    private JSObject statusOf(TorOnionService s) {
        JSObject o = new JSObject();
        if (s == null) {
            o.put("running", false);
            o.put("bootstrapped", false);
            o.put("bootstrapPercent", 0);
            o.put("onion", null);
            o.put("socksPort", 0);
            o.put("servicePort", 0);
            o.put("lastError", "service not started");
            return o;
        }
        o.put("running", s.running);
        o.put("bootstrapped", s.bootstrapped);
        o.put("bootstrapPercent", s.bootstrapPercent);
        o.put("onion", s.onionAddress);
        o.put("socksPort", s.socksPort);
        o.put("servicePort", TorOnionService.VIRTUAL_PORT);
        o.put("lastError", s.lastError);
        return o;
    }

    /** Read a bounded batch of previously persisted sealed inbound frames. */
    @PluginMethod
    public void pendingInbound(PluginCall call) {
        io.execute(() -> {
            try {
                com.getcapacitor.JSArray entries = new com.getcapacitor.JSArray();
                for (NativeInboundQueue.Entry entry : NativeInboundQueue.pending(getContext(), 8)) {
                    JSObject item = new JSObject();
                    item.put("id", entry.id);
                    item.put("frame", entry.frame);
                    entries.put(item);
                }
                JSObject result = new JSObject();
                result.put("entries", entries);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Cannot load inbound queue", error);
            }
        });
    }

    @PluginMethod
    public void acknowledgeInbound(PluginCall call) {
        String id = call.getString("id", "");
        io.execute(() -> {
            try {
                if (!NativeInboundQueue.acknowledge(getContext(), id)) {
                    call.reject("Inbound queue entry could not be removed");
                    return;
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("Cannot acknowledge inbound entry", error);
            }
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
        String secretKey = call.getString("secretKey", null);
        Intent intent = new Intent(getContext(), TorOnionService.class);
        intent.setAction(TorOnionService.ACTION_START);
        if (secretKey != null && !secretKey.isEmpty()) {
            intent.putExtra(TorOnionService.EXTRA_SECRET_KEY, secretKey);
        }
        // A dataSync foreground service may only be started while the app is
        // visible (API 31+). The JS layer starts Tor after first paint and only
        // while the document is visible; double-check here and reject instead
        // of attempting an invalid start.
        if (getActivity() == null || getActivity().isFinishing()
                || !getActivity().getLifecycle().getCurrentState()
                        .isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) {
            call.reject("FOREGROUND_REQUIRED", "Tor can only be started while the app is open");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Throwable startFailure) {
            // ForegroundServiceStartNotAllowedException (API 31+) or a
            // SecurityException for a missing FGS type permission. A background
            // service would be killed within a minute on API 26+, so do not
            // pretend — report the rejection so the UI can offer a retry.
            Log.e(TAG, "Unable to start Tor foreground service", startFailure);
            call.reject("FOREGROUND_START_REJECTED",
                    startFailure.getClass().getSimpleName() + ": " + startFailure.getMessage());
            return;
        }


        io.execute(() -> {
            // Wait (bounded) for tor to bootstrap and publish the onion service.
            long deadline = System.currentTimeMillis() + 180_000L;
            TorOnionService svc = TorOnionService.get();
            while (System.currentTimeMillis() < deadline) {
                svc = TorOnionService.get();
                if (svc != null && svc.onionAddress != null) break;
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
            JSObject res = statusOf(svc);
            res.put("secretKey", svc == null ? null : svc.onionSecretKey);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), TorOnionService.class);
            intent.setAction(TorOnionService.ACTION_STOP);
            getContext().startService(intent);
            getContext().stopService(new Intent(getContext(), TorOnionService.class));
            call.resolve();
        } catch (Throwable stopFailure) {
            call.reject("Unable to stop Tor foreground service", stopFailure.getMessage());
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(statusOf(TorOnionService.get()));
    }

    @PluginMethod
    public void send(PluginCall call) {
        final String id = call.getString("id", "");
        final String onion = call.getString("onion", "");
        final String frame = call.getString("frame", "");
        if (onion == null || onion.isEmpty() || frame == null || frame.isEmpty()) {
            call.reject("onion and frame are required");
            return;
        }
        io.execute(() -> {
            TorOnionService svc = TorOnionService.get();
            JSObject res = new JSObject();
            if (svc == null) {
                res.put("delivered", false);
                res.put("reason", "transport not started");
                call.resolve(res);
                return;
            }
            boolean ok = svc.sendNow(onion, frame);
            res.put("delivered", ok);
            if (!ok) res.put("reason", svc.bootstrapped ? "peer offline" : "tor not bootstrapped");
            call.resolve(res);
        });
    }

    @PluginMethod
    public void probe(PluginCall call) {
        final String onion = call.getString("onion", "");
        io.execute(() -> {
            TorOnionService svc = TorOnionService.get();
            long started = System.currentTimeMillis();
            boolean reachable = svc != null && onion != null && svc.probe(onion);
            JSObject res = new JSObject();
            res.put("reachable", reachable);
            res.put("rttMs", System.currentTimeMillis() - started);
            call.resolve(res);
        });
    }

    @Override
    protected void handleOnDestroy() {
        TorOnionService.setListener(null);
        io.shutdownNow();
        super.handleOnDestroy();
    }
}
