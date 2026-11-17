package com.stickynotes.android;

import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The Java half of window.sticky (web/bridge.js). One per page. It plays the
 * part of Electron's ipcRenderer/ipcMain: every message is handed to the
 * service on the main thread, tagged with which page sent it (its role and,
 * for a note or notepad, its id), so a page can only touch its own data.
 */
final class Bridge {
    final String role; // note | manager | timer | settings | about | notepad
    final String id; // note or notepad id; null for the other pages
    final boolean overlay;
    WebView web;
    Panel panel; // set for pages in a floating window
    NotepadActivity activity; // set for the notepad page
    private boolean dead = false;
    private final Handler main = new Handler(Looper.getMainLooper());

    Bridge(String role, String id, boolean overlay) {
        this.role = role;
        this.id = id;
        this.overlay = overlay;
    }

    // ------------------------------------------------- from the page (JS) ---

    @JavascriptInterface
    public void invoke(String channel, String args, int callId) {
        main.post(() -> route(channel, args, callId));
    }

    @JavascriptInterface
    public void send(String channel, String args) {
        main.post(() -> route(channel, args, 0));
    }

    @JavascriptInterface
    public void drag(String mode) {
        main.post(() -> {
            if (panel != null && !dead) panel.armDrag(mode);
        });
    }

    @JavascriptInterface
    public String info() {
        return J.obj("overlay", overlay, "lowEnd", ScratchService.lowEnd).toString();
    }

    private void route(String channel, String args, int callId) {
        if (dead) return;
        ScratchService svc = ScratchService.instance;
        if (svc == null) {
            if (callId > 0) reject(callId, "Scratch is not running");
            return;
        }
        try {
            svc.handle(this, channel, J.parseArray(args), callId);
        } catch (RuntimeException e) {
            android.util.Log.e("ScratchBridge", "error handling " + channel, e);
            if (callId > 0) reject(callId, String.valueOf(e.getMessage()));
        }
    }

    // -------------------------------------------------- to the page (JS) ---

    void resolve(int callId, Object value) {
        if (callId <= 0) return;
        eval("window.__scratch&&__scratch.resolve(" + callId + "," + J.js(value) + ")");
    }

    void reject(int callId, String error) {
        if (callId <= 0) return;
        eval("window.__scratch&&__scratch.resolve(" + callId + ",null," + J.js(error) + ")");
    }

    void emit(String channel, Object value) {
        eval("window.__scratch&&__scratch.emit(" + J.js(channel) + "," + J.js(value) + ")");
    }

    void eval(String script) {
        if (dead || web == null) return;
        web.evaluateJavascript(script, null);
    }

    void onRendererGone() {
        if (panel != null) panel.onRendererGone();
        else if (activity != null) activity.onRendererGone();
    }

    void kill() {
        dead = true;
    }

    // ------------------------------------------------------------- bytes ---

    static JSONObject bytes(byte[] data) {
        return J.obj("__bytes", Base64.encodeToString(data, Base64.NO_WRAP));
    }

    static byte[] bytes(Object v) {
        if (!(v instanceof JSONObject)) return null;
        String b64 = J.str((JSONObject) v, "__bytes", null);
        if (b64 == null) return null;
        try {
            return Base64.decode(b64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    static Object arg(JSONArray args, int i) {
        return args == null ? null : J.at(args, i);
    }
}
