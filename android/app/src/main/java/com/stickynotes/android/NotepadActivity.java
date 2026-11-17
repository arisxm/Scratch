package com.stickynotes.android;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * A notepad (drawing pad), full screen. On a phone one notepad is open at a
 * time; opening another one saves and swaps. Leaving it (the close button or
 * Back) saves the drawing and hides the notepad under Hidden notes, exactly
 * like closing a notepad window on desktop.
 */
public final class NotepadActivity extends Activity {
    static NotepadActivity current;
    private static final int PICK_IMAGE = 1;

    Bridge bridge;
    private WebView web;
    private String padId;
    private String nextPadId; // asked to open another notepad while this one saves
    private boolean closing = false;
    private boolean fullscreen = false;
    private ValueCallback<Uri[]> fileCallback;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable closeAnyway = this::finishClose;

    static boolean isShowing(String id) {
        return current != null && id != null && id.equals(current.padId) && !current.isFinishing();
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (ScratchService.instance == null || ScratchService.instance.notepads == null) {
            // Opened from Recents after Scratch was stopped: start it, it will show the notepad under Hidden notes.
            startForegroundService(new Intent(this, ScratchService.class));
            finish();
            return;
        }
        current = this;
        getWindow().setStatusBarColor(0xFFF4EDD8);
        getWindow().setNavigationBarColor(0xFFF4EDD8);
        load(getIntent().getStringExtra(ScratchService.EXTRA_ID));
    }

    private void load(String id) {
        ScratchService svc = ScratchService.instance;
        if (svc == null || id == null || svc.notepads.get(id) == null) {
            finish();
            return;
        }
        padId = id;
        closing = false;
        if (web != null) {
            bridge.kill();
            web.destroy();
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#fffdf5"));
        bridge = new Bridge("notepad", id, false);
        bridge.activity = this;
        bridge.web = web;
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(Intent.createChooser(pick, "Insert a picture"), PICK_IMAGE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        Web.setUp(web, bridge, "view=notepad&id=" + id);
        setContentView(web);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String id = intent.getStringExtra(ScratchService.EXTRA_ID);
        if (id == null || id.equals(padId)) return;
        nextPadId = id;
        requestClose(); // save this one first, then load the next (see finishClose)
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_IMAGE || fileCallback == null) return;
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        fileCallback.onReceiveValue(uri != null ? new Uri[] {uri} : null);
        fileCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (fullscreen) {
            setFullScreen(false);
            return;
        }
        requestClose();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // The page saves a changed drawing when its window loses focus.
        if (bridge != null) bridge.eval("window.dispatchEvent(new Event('blur'))");
        if (web != null) web.onPause(); // in the background: no drawing work
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(closeAnyway);
        if (current == this) {
            current = null;
            ScratchService svc = ScratchService.instance;
            if (svc != null && padId != null && !isChangingConfigurations()) svc.onNotepadClosed(padId);
        }
        if (web != null) {
            bridge.kill();
            web.destroy();
        }
        super.onDestroy();
    }

    /** Ask the page to save, then close (it answers with notepad:close); close anyway after 3 s. */
    private void requestClose() {
        if (closing) return;
        closing = true;
        bridge.emit("notepad:flush", null);
        main.postDelayed(closeAnyway, 3000);
    }

    private void finishClose() {
        main.removeCallbacks(closeAnyway);
        ScratchService svc = ScratchService.instance;
        if (nextPadId != null) {
            String next = nextPadId;
            nextPadId = null;
            if (svc != null) svc.onNotepadClosed(padId);
            load(next);
            return;
        }
        finish();
    }

    /** The notepad was deleted (from Hidden notes): close without saving. */
    void discard() {
        String id = padId;
        padId = null;
        if (id != null) finish();
    }

    void onRendererGone() {
        if (padId != null) load(padId);
    }

    // ------------------------------------------------------------ IPC ---

    void handle(String channel, Object a0, int callId) {
        ScratchService svc = ScratchService.instance;
        if (svc == null || padId == null) {
            bridge.resolve(callId, null);
            return;
        }
        switch (channel) {
            case "notepad:load":
                bridge.resolve(callId, svc.notepadLoad(padId));
                return;
            case "notepad:save": {
                if (!(a0 instanceof JSONObject)) {
                    bridge.resolve(callId, false);
                    return;
                }
                JSONObject d = (JSONObject) a0;
                svc.notepads.saveDrawing(padId, Bridge.bytes(J.get(d, "image")), J.get(d, "width"), J.get(d, "height"),
                        J.get(d, "paper"), (ok) -> bridge.resolve(callId, ok));
                return;
            }
            case "notepad:rename":
                svc.notepads.rename(padId, a0);
                return;
            case "notepad:export":
                bridge.resolve(callId, exportPng(Bridge.bytes(a0)));
                return;
            case "notepad:copy":
                copyPng(Bridge.bytes(a0));
                return;
            case "notepad:set-fullscreen":
                if (a0 instanceof Boolean) setFullScreen((Boolean) a0);
                bridge.resolve(callId, fullscreen);
                return;
            case "notepad:minimize":
                moveTaskToBack(true);
                return;
            case "notepad:toggle-maximize":
                return; // already as big as the screen
            case "notepad:close":
                finishClose();
                return;
            default:
                bridge.resolve(callId, null);
        }
    }

    private String fileName() {
        JSONObject pad = ScratchService.instance.notepads.get(padId);
        String title = pad == null ? "" : pad.optString("title").replaceAll("[\\\\/:*?\"<>|]+", " ").trim();
        if (!title.isEmpty()) return title + ".png";
        return "Notepad " + new SimpleDateFormat("yyyy-MM-dd HHmm", Locale.ROOT).format(new Date()) + ".png";
    }

    /** "Save as picture": into Pictures/Scratch, where the Gallery finds it. */
    private String exportPng(byte[] png) {
        if (!NotepadStore.isPng(png)) return "failed";
        String name = fileName();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Scratch");
                v.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return "failed";
                try (OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) return "failed";
                    out.write(png);
                }
                v.clear();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                Toast.makeText(this, "Saved to Pictures/Scratch", Toast.LENGTH_SHORT).show();
            } else {
                File dir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Scratch");
                if (!dir.isDirectory() && !dir.mkdirs()) return "failed";
                File f = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write(png);
                }
                Toast.makeText(this, "Saved to " + f.getPath(), Toast.LENGTH_LONG).show();
            }
            return "saved";
        } catch (Exception e) {
            return "failed";
        }
    }

    private void copyPng(byte[] png) {
        if (!NotepadStore.isPng(png)) return;
        try {
            Uri uri = ImageProvider.put(this, png);
            ClipboardManager cm = getSystemService(ClipboardManager.class);
            cm.setPrimaryClip(ClipData.newUri(getContentResolver(), "Drawing", uri));
        } catch (Exception e) {
            Toast.makeText(this, "Couldn't copy the picture", Toast.LENGTH_SHORT).show();
        }
    }

    private void setFullScreen(boolean flag) {
        fullscreen = flag;
        View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = decor.getWindowInsetsController();
            if (c != null) {
                if (flag) {
                    c.hide(WindowInsets.Type.systemBars());
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    c.show(WindowInsets.Type.systemBars());
                }
            }
        } else {
            decor.setSystemUiVisibility(flag
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    : 0);
        }
        if (bridge != null) bridge.emit("notepad:fullscreen-changed", flag);
    }
}
