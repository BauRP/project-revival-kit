package com.baurp.trivochat.tor;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.baurp.trivochat.MainActivity;
import com.baurp.trivochat.R;

import net.freehaven.tor.control.TorControlConnection;

import org.torproject.jni.TorService;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Persistent Tor transport.
 *
 * Responsibilities:
 *   1. Keep a real tor daemon alive (guardianproject tor-android) inside a
 *      foreground service so Android never kills the circuit.
 *   2. Publish this device's v3 Onion Service (ADD_ONION over the control
 *      port) with a key that is handed back to JS and restored on next boot,
 *      so the .onion address is the device's stable identity.
 *   3. Accept inbound streams on the hidden service port and buffer every
 *      frame for the WebView (delivered live when it is awake).
 *   4. No native queue: Dexie (JS) is the single outbox; retries and
 *      DELIVERED_ACK handling live in src/lib/onion-engine.ts.
 */
public class TorOnionService extends Service {

    private static final String TAG = "TorOnionService";
    public static final String CHANNEL_ID = "trivo_tor_transport";
    public static final int NOTIFICATION_ID = 0x7107;

    public static final String EXTRA_SECRET_KEY = "secretKey";
    public static final String ACTION_START = "com.baurp.trivochat.tor.START";
    public static final String ACTION_STOP = "com.baurp.trivochat.tor.STOP";

    /** Virtual port every Trivo onion service listens on. */
    public static final int VIRTUAL_PORT = 8443;
    private static final int DIAL_TIMEOUT_MS = 90_000;

    public interface Listener {
        void onFrame(String frame);

        void onStatus(TorOnionService service);
    }

    private static volatile TorOnionService instance;
    private static volatile Listener listener;

    public static TorOnionService get() {
        return instance;
    }

    public static void setListener(Listener l) {
        listener = l;
    }

    // ── Published state (read by the Capacitor plugin) ──────────
    public volatile boolean running = false;
    public volatile boolean bootstrapped = false;
    public volatile int bootstrapPercent = 0;
    public volatile String onionAddress = null;
    public volatile String onionSecretKey = null;
    public volatile int socksPort = 0;
    public volatile int localServicePort = 0;
    public volatile String lastError = null;

    private volatile boolean initFailed = false;

    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final AtomicBoolean listenerLoopRunning = new AtomicBoolean(false);

    private ServerSocket serverSocket;
    private TorControlConnection control;
    private PowerManager.WakeLock wakeLock;
    private String requestedSecretKey = null;
    private boolean torBound = false;
    private boolean localReceiverRegistered = false;
    private boolean systemReceiverRegistered = false;
    private TorService torServiceInstance = null;

    // ── Lifecycle ───────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        try {
            createChannel();
            acquireWakeLock();
            registerTorStatusReceiver();
        } catch (Throwable startupFailure) {
            lastError = "Tor service initialization failed: "
                    + startupFailure.getClass().getSimpleName()
                    + ": "
                    + String.valueOf(startupFailure.getMessage());
            initFailed = true;
            Log.e(TAG, lastError, startupFailure);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            startForegroundCompat("Starting Tor…");
        } catch (Throwable notificationFailure) {
            lastError = "Unable to enter foreground mode: "
                    + notificationFailure.getClass().getSimpleName()
                    + ": "
                    + String.valueOf(notificationFailure.getMessage());
            Log.e(TAG, lastError, notificationFailure);
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        try {
            if (intent != null && ACTION_STOP.equals(intent.getAction())) {
                shutdown();
                stopSelf(startId);
                return START_NOT_STICKY;
            }
            if (intent != null && intent.hasExtra(EXTRA_SECRET_KEY)) {
                String key = intent.getStringExtra(EXTRA_SECRET_KEY);
                if (key != null && !key.isEmpty()) requestedSecretKey = key;
            }
            if (initFailed) {
                updateNotification("Tor transport unavailable");
                return START_NOT_STICKY;
            }
            bindTor();
            return START_STICKY;
        } catch (Throwable startupFailure) {
            lastError = "Tor startup failed: "
                    + startupFailure.getClass().getSimpleName()
                    + ": "
                    + String.valueOf(startupFailure.getMessage());
            Log.e(TAG, lastError, startupFailure);
            updateNotification("Tor transport unavailable");
            return START_NOT_STICKY;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        shutdown();
        instance = null;
        super.onDestroy();
    }

    private void shutdown() {
        running = false;
        bootstrapped = false;
        listenerLoopRunning.set(false);
        closeServerSocket();
        try {
            if (control != null && onionAddress != null) {
                control.delOnion(onionAddress.replace(".onion", ""));
            }
        } catch (Exception ignored) {
            // tor is going away anyway
        }
        control = null;
        if (torBound) {
            try {
                unbindService(torConnection);
            } catch (Exception ignored) {
                // already unbound
            }
            torBound = false;
        }
        try {
            stopService(new Intent(this, TorService.class));
        } catch (Exception ignored) {
            // nothing to do
        }
        releaseWakeLock();
        unregisterTorStatusReceiver();
        publishStatus();
        stopForeground(true);
    }

    // ── Notification ────────────────────────────────────────────

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "P2P Tor Onion Network", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Presence and Connectivity Check");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    /** Fixed, privacy-preserving notification copy (no onion address is shown). */
    private static final String NOTIFICATION_TITLE = "P2P Tor Onion Network:";
    private static final String NOTIFICATION_BODY = "Presence and Connectivity Check";

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(NOTIFICATION_TITLE)
                .setContentText(NOTIFICATION_BODY)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setSilent(true)
                .setContentIntent(pi)
                .build();
    }

    private void startForegroundCompat(String text) {
        Notification notification = buildNotification(text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = getSystemService(PowerManager.class);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "trivo:tor-transport");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        } catch (Exception e) {
            Log.w(TAG, "wakelock unavailable: " + e.getMessage());
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
            // nothing to do
        }
        wakeLock = null;
    }

    // ── Tor daemon ──────────────────────────────────────────────

    private final ServiceConnection torConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            try {
                torBound = true;
                running = true;
                if (binder instanceof TorService.LocalBinder) {
                    torServiceInstance = ((TorService.LocalBinder) binder).getService();
                }
                updateNotification("Bootstrapping Tor circuits…");
                publishStatus();
            } catch (Throwable connectionFailure) {
                torBound = false;
                running = false;
                torServiceInstance = null;
                lastError = "tor service connection failed: "
                        + connectionFailure.getClass().getSimpleName()
                        + ": "
                        + String.valueOf(connectionFailure.getMessage());
                Log.e(TAG, lastError, connectionFailure);
                publishStatus();
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            try {
                torBound = false;
                running = false;
                bootstrapped = false;
                torServiceInstance = null;
                publishStatus();
            } catch (Throwable disconnectionFailure) {
                Log.e(TAG, "tor service disconnect handling failed", disconnectionFailure);
            }
        }
    };

    private final BroadcastReceiver torStatusReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String status = intent.getStringExtra(TorService.EXTRA_STATUS);
            if (status == null) return;
            if (TorService.STATUS_ON.equals(status)) {
                bootstrapped = true;
                bootstrapPercent = 100;
                workers.execute(TorOnionService.this::onTorReady);
            } else if (TorService.STATUS_STARTING.equals(status)) {
                bootstrapPercent = Math.max(bootstrapPercent, 25);
                publishStatus();
            } else if (TorService.STATUS_STOPPING.equals(status)
                    || TorService.STATUS_OFF.equals(status)) {
                bootstrapped = false;
                bootstrapPercent = 0;
                publishStatus();
            }
        }
    };

    private void registerTorStatusReceiver() {
        IntentFilter filter = new IntentFilter(TorService.ACTION_STATUS);
        try {
            LocalBroadcastManager.getInstance(this).registerReceiver(torStatusReceiver, filter);
            localReceiverRegistered = true;
        } catch (Throwable localFailure) {
            Log.w(TAG, "local Tor status receiver unavailable", localFailure);
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(torStatusReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(torStatusReceiver, filter);
            }
            systemReceiverRegistered = true;
        } catch (Throwable systemFailure) {
            Log.w(TAG, "system Tor status receiver unavailable", systemFailure);
        }
    }

    private void unregisterTorStatusReceiver() {
        if (localReceiverRegistered) {
            try {
                LocalBroadcastManager.getInstance(this).unregisterReceiver(torStatusReceiver);
            } catch (Throwable ignored) {
                // Receiver may already have been detached by process teardown.
            }
            localReceiverRegistered = false;
        }
        if (systemReceiverRegistered) {
            try {
                unregisterReceiver(torStatusReceiver);
            } catch (Throwable ignored) {
                // Receiver may already have been detached by process teardown.
            }
            systemReceiverRegistered = false;
        }
    }

    private void bindTor() {
        if (torBound) return;
        // Deferred JNI load: never resolve TorService (whose static block calls
        // System.loadLibrary("tor")) before an explicit start request, and never
        // outside a Throwable guard.
        if (!TorNativeSupport.ensureLoaded()) {
            lastError = TorNativeSupport.failureReason();
            Log.e(TAG, "Refusing to bind tor: " + lastError);
            updateNotification("Tor transport unavailable");
            publishStatus();
            return;
        }
        try {
            Intent intent = new Intent(this, TorService.class);
            bindService(intent, torConnection, BIND_AUTO_CREATE);
        } catch (Throwable bindFailure) {
            lastError = "tor bind failed: "
                    + bindFailure.getClass().getSimpleName()
                    + ": "
                    + String.valueOf(bindFailure.getMessage());
            Log.e(TAG, lastError, bindFailure);
            publishStatus();
        }
    }

    /** Runs once tor reports STATUS_ON: read SOCKS port, open listener, ADD_ONION. */
    private void onTorReady() {
        try {
            if (torServiceInstance != null) {
                control = torServiceInstance.getTorControlConnection();
            }
            if (control == null) {
                lastError = "tor control connection unavailable";
                publishStatus();
                return;
            }
            socksPort = parseSocksPort(control.getInfo("net/listeners/socks"));
            openLocalListener();
            publishOnionService();
            updateNotification(onionAddress == null
                    ? "Connected to Tor"
                    : "Online · " + shortOnion(onionAddress));
            lastError = null;
            publishStatus();

        } catch (Exception e) {
            lastError = "tor ready failed: " + e.getMessage();
            Log.e(TAG, lastError, e);
            publishStatus();
        }
    }

    private static String shortOnion(String onion) {
        return onion.length() > 14 ? onion.substring(0, 10) + "…onion" : onion;
    }

    private static int parseSocksPort(String info) {
        // Format: "127.0.0.1:9050" (quoted, possibly space-separated list).
        if (info == null) return 9050;
        String cleaned = info.replace("\"", "").trim();
        String first = cleaned.split("\\s+")[0];
        int idx = first.lastIndexOf(':');
        if (idx < 0) return 9050;
        try {
            return Integer.parseInt(first.substring(idx + 1).trim());
        } catch (NumberFormatException e) {
            return 9050;
        }
    }

    private void publishOnionService() throws IOException {
        Map<Integer, String> portLines = new HashMap<>();
        portLines.put(VIRTUAL_PORT, "127.0.0.1:" + localServicePort);

        String keyArg = (requestedSecretKey == null || requestedSecretKey.isEmpty())
                ? "NEW:ED25519-V3"
                : requestedSecretKey;

        Map<String, String> reply = control.addOnion(keyArg, portLines);
        if (reply == null) throw new IOException("ADD_ONION returned no reply");

        String serviceId = firstNonEmpty(
                reply.get("ServiceID"), reply.get("serviceID"), reply.get("onionAddress"));
        String privateKey = firstNonEmpty(
                reply.get("PrivateKey"), reply.get("privateKey"));

        if (serviceId == null) {
            // Some jtorctl builds key the map by the raw reply token.
            for (Map.Entry<String, String> e : reply.entrySet()) {
                String v = e.getValue();
                if (v != null && v.matches("[a-z2-7]{56}")) {
                    serviceId = v;
                    break;
                }
            }
        }
        if (serviceId == null) throw new IOException("ADD_ONION did not return a service id");

        onionAddress = serviceId.endsWith(".onion")
                ? serviceId.toLowerCase(Locale.US)
                : serviceId.toLowerCase(Locale.US) + ".onion";
        if (privateKey != null && !privateKey.isEmpty()) {
            onionSecretKey = privateKey.startsWith("ED25519-V3:")
                    ? privateKey
                    : "ED25519-V3:" + privateKey;
        } else if (requestedSecretKey != null) {
            onionSecretKey = requestedSecretKey;
        }
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) {
            if (v != null && !v.isEmpty()) return v;
        }
        return null;
    }

    // ── Inbound listener ────────────────────────────────────────

    private void openLocalListener() throws IOException {
        closeServerSocket();
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        localServicePort = serverSocket.getLocalPort();
        if (listenerLoopRunning.compareAndSet(false, true)) {
            workers.execute(this::acceptLoop);
        }
    }

    private void closeServerSocket() {
        listenerLoopRunning.set(false);
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
            // nothing to do
        }
        serverSocket = null;
    }

    private void acceptLoop() {
        while (listenerLoopRunning.get() && serverSocket != null && !serverSocket.isClosed()) {
            try {
                final Socket client = serverSocket.accept();
                client.setSoTimeout(120_000);
                workers.execute(() -> handleInbound(client));
            } catch (IOException e) {
                if (listenerLoopRunning.get()) {
                    Log.w(TAG, "accept failed: " + e.getMessage());
                }
            }
        }
        listenerLoopRunning.set(false);
    }

    private void handleInbound(Socket client) {
        try {
            String frame = Socks5Client.readFrame(client);
            Socks5Client.ack(client);
            Listener l = listener;
            boolean handedToWebView = false;
            if (l != null) {
                try {
                    l.onFrame(frame);
                    handedToWebView = true;
                } catch (Exception e) {
                    handedToWebView = false;
                }
            }
            if (!handedToWebView) {
                // No JS layer alive: the frame is dropped. The sender keeps it in
                // its Dexie outbox and retries until it receives a DELIVERED_ACK.
                Log.i(TAG, "inbound frame dropped: WebView not attached");
            }
        } catch (IOException e) {
            Log.w(TAG, "inbound frame rejected: " + e.getMessage());
        } finally {
            Socks5Client.closeQuietly(client);
        }
    }

    // ── Outbound ────────────────────────────────────────────────

    /**
     * Immediate delivery attempt. `onion` is "<host>.onion" or
     * "<host>.onion:<port>".
     */
    public boolean sendNow(String onion, String frame) {
        if (!bootstrapped || socksPort <= 0 || onion == null || frame == null) return false;
        String host = onion;
        int port = VIRTUAL_PORT;
        int idx = onion.lastIndexOf(':');
        if (idx > 0) {
            host = onion.substring(0, idx);
            try {
                port = Integer.parseInt(onion.substring(idx + 1));
            } catch (NumberFormatException ignored) {
                port = VIRTUAL_PORT;
            }
        }
        return Socks5Client.sendFrame(socksPort, host, port, frame, DIAL_TIMEOUT_MS);
    }

    public boolean probe(String onion) {
        if (!bootstrapped || socksPort <= 0 || onion == null) return false;
        String host = onion;
        int port = VIRTUAL_PORT;
        int idx = onion.lastIndexOf(':');
        if (idx > 0) {
            host = onion.substring(0, idx);
            try {
                port = Integer.parseInt(onion.substring(idx + 1));
            } catch (NumberFormatException ignored) {
                port = VIRTUAL_PORT;
            }
        }
        return Socks5Client.probe(socksPort, host, port, DIAL_TIMEOUT_MS);
    }

    private void publishStatus() {
        Listener l = listener;
        if (l != null) {
            try {
                l.onStatus(this);
            } catch (Exception ignored) {
                // plugin detached
            }
        }
    }
}
