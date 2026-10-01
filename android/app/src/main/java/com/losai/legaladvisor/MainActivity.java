package com.losai.legaladvisor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try { configureSystemBars(); } catch (RuntimeException ignored) { }
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(248, 245, 238));
        webView.setWebViewClient(new WebViewClient());
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            try {
                int top = 0, bottom = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    top = bars.top; bottom = bars.bottom;
                } else {
                    top = insets.getSystemWindowInsetTop(); bottom = insets.getSystemWindowInsetBottom();
                }
                view.setPadding(0, top, 0, bottom);
            } catch (RuntimeException ignored) { }
            return insets;
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.loadUrl("https://ai-los.vercel.app/");
        setContentView(webView);
    }

    private void configureSystemBars() {
        Window window = getWindow();
        int cream = Color.rgb(248, 245, 238);
        window.setStatusBarColor(cream);
        window.setNavigationBarColor(cream);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsAppearance(
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        } else {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
