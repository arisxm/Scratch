package com.stickynotes.android;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * WebView setup shared by every Scratch page. The pages are the desktop UI,
 * built into assets/web (see android/vite.config.mjs), and are served from
 * https://appassets.androidplatform.net/web/ by the app itself: module scripts
 * don't load from file:// URLs, and this keeps file access switched off.
 */
final class Web {
    private Web() {}

    static final String HOST = "appassets.androidplatform.net";
    static final String BASE = "https://" + HOST + "/web/index.html";
    private static final String TAG = "ScratchWeb";

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    static void setUp(WebView web, Bridge bridge, String query) {
        Context context = web.getContext();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100); // the system font size would otherwise break the paper layouts
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.addJavascriptInterface(bridge, "ScratchNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(context, request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                // Links to the web open in the browser, never inside a note.
                if ("https".equals(url.getScheme())) {
                    try {
                        context.startActivity(new Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception e) {
                        Log.w(TAG, "no browser for " + url);
                    }
                }
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Like the desktop app: a page whose renderer died is brought back.
                Log.e(TAG, "renderer gone, crashed=" + detail.didCrash());
                bridge.onRendererGone();
                return true;
            }
        });
        web.loadUrl(BASE + (query == null || query.isEmpty() ? "" : "?" + query));
    }

    private static final Map<String, String> TYPES = new HashMap<>();

    static {
        TYPES.put("html", "text/html");
        TYPES.put("js", "text/javascript");
        TYPES.put("mjs", "text/javascript");
        TYPES.put("css", "text/css");
        TYPES.put("json", "application/json");
        TYPES.put("png", "image/png");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("woff2", "font/woff2");
        TYPES.put("woff", "font/woff");
        TYPES.put("ttf", "font/ttf");
    }

    /** Serve /web/... from assets/web/...; anything else on our host is a 404. */
    static WebResourceResponse serve(Context context, Uri url) {
        if (!HOST.equals(url.getHost())) return null;
        String path = url.getPath();
        if (path == null || !path.startsWith("/web/") || path.contains("..")) return notFound();
        String asset = path.substring(1);
        String ext = asset.substring(asset.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.ROOT);
        String type = TYPES.containsKey(ext) ? TYPES.get(ext) : "application/octet-stream";
        try {
            InputStream in = context.getAssets().open(asset);
            boolean text = type.startsWith("text/") || type.endsWith("json") || type.endsWith("xml");
            WebResourceResponse r = new WebResourceResponse(type, text ? "utf-8" : null, in);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("Access-Control-Allow-Origin", "https://" + HOST);
            r.setResponseHeaders(headers);
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
}
