package com.baurp.trivochat;

import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.yandex.mobile.ads.banner.BannerAdEventListener;
import com.yandex.mobile.ads.banner.BannerAdSize;
import com.yandex.mobile.ads.banner.BannerAdView;
import com.yandex.mobile.ads.common.AdRequest;
import com.yandex.mobile.ads.common.AdRequestError;
import com.yandex.mobile.ads.common.ImpressionData;
import com.yandex.mobile.ads.common.MobileAds;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "YandexAds")
public class YandexAdsPlugin extends Plugin {
    private static final String TAG = "YandexAdsPlugin";
    private BannerAdView bannerAdView;
    private final ExecutorService initializationExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean initialized = new AtomicBoolean(false);

    @PluginMethod
    public void initialize(PluginCall call) {
        String appId = call.getString("appId");
        if (initialized.get()) {
            JSObject result = new JSObject();
            result.put("initialized", true);
            call.resolve(result);
            return;
        }
        initializationExecutor.execute(() -> {
            try {
                MobileAds.initialize(getContext().getApplicationContext(), () -> {
                    initialized.set(true);
                    Log.i(TAG, "Yandex SDK initialized (appId=" + appId + ")");
                    JSObject result = new JSObject();
                    result.put("initialized", true);
                    call.resolve(result);
                });
            } catch (Throwable t) {
                initialized.set(false);
                Log.e(TAG, "initialize failed", t);
                call.reject("initialize failed: " + String.valueOf(t.getMessage()));
            }
        });
    }

    @PluginMethod
    public void showBanner(PluginCall call) {
        final String adUnitId = call.getString("adUnitId");
        final String position = call.getString("position", "top");
        if (adUnitId == null) { call.reject("adUnitId required"); return; }

        getActivity().runOnUiThread(() -> {
            try {
                if (bannerAdView != null) {
                    ViewGroup parent = (ViewGroup) bannerAdView.getParent();
                    if (parent != null) parent.removeView(bannerAdView);
                    bannerAdView.destroy();
                }
                bannerAdView = new BannerAdView(getContext());
                bannerAdView.setAdUnitId(adUnitId);
                bannerAdView.setAdSize(BannerAdSize.stickySize(getContext(), getContext().getResources().getDisplayMetrics().widthPixels));

                bannerAdView.setBannerAdEventListener(new BannerAdEventListener() {
                    @Override public void onAdLoaded() {
                        JSObject ret = new JSObject();
                        ret.put("success", true);
                        call.resolve(ret);
                    }
                    @Override public void onAdFailedToLoad(AdRequestError error) {
                        JSObject ret = new JSObject();
                        ret.put("success", false);
                        ret.put("code", error.getCode());
                        ret.put("description", error.getDescription());
                        call.resolve(ret);
                    }
                    @Override public void onAdClicked() {}
                    @Override public void onLeftApplication() {}
                    @Override public void onReturnedToApplication() {}
                    @Override public void onImpression(ImpressionData impressionData) {}
                });

                FrameLayout root = (FrameLayout) getBridge().getWebView().getParent();
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT);
                lp.gravity = "bottom".equals(position) ? Gravity.BOTTOM : Gravity.TOP;
                root.addView(bannerAdView, lp);

                bannerAdView.loadAd(new AdRequest.Builder().build());
            } catch (Throwable t) {
                Log.e(TAG, "showBanner failed", t);
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", t.getMessage());
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (bannerAdView != null) bannerAdView.setVisibility(android.view.View.GONE);
            call.resolve();
        });
    }

    @PluginMethod
    public void destroyBanner(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (bannerAdView != null) {
                ViewGroup parent = (ViewGroup) bannerAdView.getParent();
                if (parent != null) parent.removeView(bannerAdView);
                bannerAdView.destroy();
                bannerAdView = null;
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (bannerAdView != null) {
                bannerAdView.destroy();
                bannerAdView = null;
            }
        } catch (Throwable t) {
            Log.w(TAG, "banner cleanup failed", t);
        }
        initializationExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
