package com.losai.legaladvisor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.net.Uri;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;
    private FrameLayout root;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        // Keep a system-bar failure from taking down the whole WebView activity on
        // OEM builds that implement edge-to-edge differently.
        try { configureSystemBars(false); } catch (RuntimeException ignored) { }
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(248, 245, 238));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(248, 245, 238));
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if ("ai-los.vercel.app".equalsIgnoreCase(uri.getHost()) && "https".equalsIgnoreCase(uri.getScheme())) return false;
                if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                }
                return true;
            }
        });
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                int topTypes = WindowInsets.Type.statusBars() | WindowInsets.Type.displayCutout();
                top = insets.getInsets(topTypes).top;
                bottom = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && insets.getDisplayCutout() != null) {
                    top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                }
                bottom = insets.getSystemWindowInsetBottom();
            }
            // Apply the system-bar space to the native container. Padding the WebView
            // itself is unreliable on edge-to-edge WebView implementations.
            view.setPadding(0, top, 0, bottom);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        webView.addJavascriptInterface(new ThemeBridge(), "LegalAdvisorNative");
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.requestApplyInsets();
        webView.loadUrl("https://ai-los.vercel.app/");
    }

    private void configureSystemBars(boolean darkTheme) {
        Window window = getWindow();
        int surface = darkTheme ? Color.rgb(9, 17, 14) : Color.rgb(248, 245, 238);
        // Android 15+ manages these surfaces as part of enforced edge-to-edge.
        // Setting their colors there can throw on some vendor implementations.
        if (Build.VERSION.SDK_INT < 35) {
            window.setStatusBarColor(surface);
            window.setNavigationBarColor(surface);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int lightBars = darkTheme ? 0 : WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(lightBars,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        }
        int flags = window.getDecorView().getSystemUiVisibility();
        flags = darkTheme ? flags & ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
                          : flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        window.getDecorView().setSystemUiVisibility(flags);
    }

    private final class ThemeBridge {
        @JavascriptInterface public void setDarkMode(boolean dark) {
            runOnUiThread(() -> {
                int surface = dark ? Color.rgb(9, 17, 14) : Color.rgb(248, 245, 238);
                webView.setBackgroundColor(surface);
                try { configureSystemBars(dark); } catch (RuntimeException ignored) { }
            });
        }
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
