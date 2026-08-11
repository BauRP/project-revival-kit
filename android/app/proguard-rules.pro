# ============================================================
# Trivo Chat Elite — R8 / ProGuard shield
# Preserves bridge, Tor transport, and encryption entry points
# ============================================================

# --- App core -------------------------------------------------
-keep class com.baurp.trivochat.** { *; }
-keepclassmembers class com.baurp.trivochat.** { *; }

# --- Capacitor bridge ----------------------------------------
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
-keepclassmembers class * {
  @com.getcapacitor.PluginMethod <methods>;
}

# --- Cordova compatibility -----------------------------------
-keep class org.apache.cordova.** { *; }

# --- WebView / JS interface ----------------------------------
# R8 must never rename or strip the JS↔native bridge entry points: doing so
# makes the WebView call into a missing method and the app dies on launch.
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep public class * extends android.webkit.WebView
-keep public class * extends android.webkit.WebViewClient
-keep public class * extends android.webkit.WebChromeClient

# --- Capacitor plugin surface (reflection-driven) -------------
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    public <init>(...);
    <methods>;
}
-keep class com.getcapacitor.JSObject { *; }
-keep class com.getcapacitor.PluginCall { *; }

# --- Web assets / WebWorker runtime --------------------------
# Keep AssetManager-driven classes used to serve the bundled JS + workers.
-keep class com.getcapacitor.WebViewLocalServer { *; }
-keep class com.getcapacitor.BridgeWebViewClient { *; }
-dontwarn com.getcapacitor.**


-keep class org.webrtc.** { *; }
-keep class com.cloudwebrtc.** { *; }

# --- Tor daemon / control bridge / JNI ------------------------
-keep class org.torproject.** { *; }
-keep class net.freehaven.tor.control.** { *; }
-keep class info.guardianproject.** { *; }
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
-dontwarn org.torproject.**
-dontwarn net.freehaven.tor.control.**

# --- Encryption / BouncyCastle / TweetNaCl -------------------
-keep class org.bouncycastle.** { *; }
-keep class com.iwebpp.crypto.** { *; }
-keep class javax.crypto.** { *; }
-dontwarn org.bouncycastle.**

# --- Kotlin / Coroutines -------------------------------------
-keep class kotlin.** { *; }
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**

# --- Generic safety nets -------------------------------------
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}
-keepclassmembers enum * { *; }

# Suppress noisy warnings
-dontwarn org.codehaus.mojo.**
-dontwarn java.beans.**
-dontwarn javax.naming.**

# --- Tor Android (Guardian Project) ---------------------------
-keep class info.guardianproject.** { *; }
-keep class org.torproject.jni.** { *; }
-dontwarn info.guardianproject.**
-dontwarn org.torproject.jni.**

# --- jtorctl (Tor Control Connection) -------------------------
-keep class net.freehaven.tor.control.** { *; }
-dontwarn net.freehaven.tor.control.**

# --- AndroidX LocalBroadcastManager --------------------------
-keep class androidx.localbroadcastmanager.content.LocalBroadcastManager { *; }
