package com.baurp.trivochat;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.baurp.trivochat.tor.TorOnionService;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;
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

    @PluginMethod
    public void start(PluginCall call) {
        String secretKey = call.getString("secretKey", null);
        Intent intent = new Intent(getContext(), TorOnionService.class);
        intent.setAction(TorOnionService.ACTION_START);
        if (secretKey != null && !secretKey.isEmpty()) {
            intent.putExtra(TorOnionService.EXTRA_SECRET_KEY, secretKey);
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Throwable startFailure) {
            // Android 12+ (and strictly enforced on API 34/36) throws
            // ForegroundServiceStartNotAllowedException when the process is not in a
            // valid state to promote a service to the foreground (e.g. cold-started
            // from the background). Degrade to a background start instead of failing.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    && startFailure instanceof android.app.ForegroundServiceStartNotAllowedException) {
                Log.w(TAG, "Foreground start not allowed, retrying as background service",
                        startFailure);
                try {
                    getContext().startService(intent);
                } catch (Throwable backgroundFailure) {
                    Log.e(TAG, "Background Tor service start failed", backgroundFailure);
                    call.reject(
                            "Tor transport cannot start while the app is in the background",
                            backgroundFailure.getMessage());
                    return;
                }
            } else {
                Log.e(TAG, "Unable to start Tor foreground service", startFailure);
                call.reject("Unable to start Tor foreground service", startFailure.getMessage());
                return;
            }
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
            if (!ok && id != null && !id.isEmpty()) {
                // Hand it to the native outbox so retries continue in background.
                svc.enqueue(id, onion, frame);
            }
            res.put("delivered", ok);
            if (!ok) res.put("reason", svc.bootstrapped ? "peer offline" : "tor not bootstrapped");
            call.resolve(res);
        });
    }

    @PluginMethod
    public void enqueue(PluginCall call) {
        final String id = call.getString("id", "");
        final String onion = call.getString("onion", "");
        final String frame = call.getString("frame", "");
        io.execute(() -> {
            TorOnionService svc = TorOnionService.get();
            JSObject res = new JSObject();
            if (svc == null || id == null || id.isEmpty()) {
                res.put("queued", false);
                call.resolve(res);
                return;
            }
            svc.enqueue(id, onion, frame);
            res.put("queued", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void dequeue(PluginCall call) {
        final String id = call.getString("id", "");
        io.execute(() -> {
            TorOnionService svc = TorOnionService.get();
            JSObject res = new JSObject();
            res.put("removed", svc != null && id != null && svc.dequeue(id));
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

    @PluginMethod
    public void drainInbound(PluginCall call) {
        io.execute(() -> {
            TorOnionService svc = TorOnionService.get();
            JSArray arr = new JSArray();
            if (svc != null) {
                List<String> frames = svc.drainInbox();
                for (String f : frames) arr.put(f);
            }
            JSObject res = new JSObject();
            res.put("frames", arr);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void drainDelivered(PluginCall call) {
        io.execute(() -> {
            TorOnionService svc = TorOnionService.get();
            JSArray arr = new JSArray();
            if (svc != null) {
                List<String> ids = svc.drainDeliveredIds();
                for (String id : ids) arr.put(id);
            }
            JSObject res = new JSObject();
            res.put("ids", arr);
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
