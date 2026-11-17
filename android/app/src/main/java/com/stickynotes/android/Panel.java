package com.stickynotes.android;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.FrameLayout;

import java.util.ArrayDeque;

/**
 * A floating window over other apps holding one Scratch page: a note, or the
 * Hidden notes, Pomodoro, Settings or About panel. The Android counterpart of
 * one of the desktop app's frameless BrowserWindows.
 *
 * Moving and resizing are done here, with the finger's screen position: the
 * page only says (through Bridge.drag) that a press started on the header or
 * on the corner grip. The window can take keyboard focus only after it is
 * touched and gives it back when the user touches anywhere else, so it
 * doesn't keep the keyboard (or the Back button) from the app underneath.
 */
final class Panel {
    interface Listener {
        void onDragged(Panel panel, String mode);

        void onClosedByUser(Panel panel);
    }

    private static final String TAG = "ScratchPanel";

    final String role, id;
    final Bridge bridge;
    final WindowManager.LayoutParams lp;
    private final Context context;
    private final WindowManager wm;
    private final Listener listener;
    private final String query;
    private final Root root;
    private WebView web;
    private boolean attached = false;
    boolean resizable = false;
    int minWidthPx = 0, minHeightPx = 0;
    Rect area = new Rect(); // where the window may be, in screen pixels

    private final int slop;
    private boolean touching = false, dragging = false;
    private String dragMode = null;
    private float downX, downY;
    private int startX, startY, startW, startH;
    private final ArrayDeque<Long> crashes = new ArrayDeque<>();

    @SuppressLint("ClickableViewAccessibility")
    Panel(Context context, Listener listener, Bridge bridge, String query, Rect bounds, boolean focus) {
        this.context = context;
        this.wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        this.listener = listener;
        this.bridge = bridge;
        this.role = bridge.role;
        this.id = bridge.id;
        this.query = query;
        this.slop = ViewConfiguration.get(context).getScaledTouchSlop();
        bridge.panel = this;

        root = new Root(context);
        createWebView();

        int flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED;
        if (!focus) flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        lp = new WindowManager.LayoutParams(bounds.width(), bounds.height(),
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, flags, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = bounds.left;
        lp.y = bounds.top;
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN;
        lp.setTitle("Scratch " + role);
    }

    @SuppressLint("ClickableViewAccessibility")
    private void createWebView() {
        web = new WebView(context);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOnTouchListener((v, e) -> onTouch(e));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bridge.web = web;
        Web.setUp(web, bridge, query);
    }

    // ------------------------------------------------------------ window ---

    void show() {
        if (attached) return;
        try {
            wm.addView(root, lp);
            attached = true;
            web.onResume();
        } catch (RuntimeException e) {
            Log.e(TAG, "could not show " + role, e);
        }
    }

    void hide() {
        if (!attached) return;
        web.onPause(); // off screen: no timers, no drawing
        try {
            wm.removeView(root);
        } catch (RuntimeException ignored) {
            // already gone
        }
        attached = false;
    }

    boolean isShown() {
        return attached;
    }

    /** Put this window above the other Scratch windows. */
    void raise() {
        if (!attached) return;
        hide();
        show();
    }

    void close() {
        hide();
        bridge.kill();
        root.removeAllViews();
        web.destroy();
    }

    Rect bounds() {
        return new Rect(lp.x, lp.y, lp.x + lp.width, lp.y + lp.height);
    }

    void setBounds(Rect b) {
        lp.x = b.left;
        lp.y = b.top;
        lp.width = b.width();
        lp.height = b.height();
        update();
    }

    void setOpacity(double opacity) {
        lp.alpha = (float) opacity;
        update();
    }

    void setFocusable(boolean focusable) {
        int f = lp.flags;
        if (focusable) f &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        else f |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        if (f == lp.flags) return;
        lp.flags = f;
        update();
        if (!focusable) web.clearFocus();
    }

    private boolean updatePending = false;
    private final Runnable flushUpdate = () -> {
        updatePending = false;
        update();
    };

    private void scheduleUpdate() {
        if (updatePending) return;
        updatePending = true;
        root.postOnAnimation(flushUpdate);
    }

    /** Stop a page that can't be seen from using the CPU (its timers and drawing); start it again. */
    void pause() {
        web.onPause();
    }

    void resume() {
        web.onResume();
    }

    private void update() {
        if (!attached) return;
        try {
            wm.updateViewLayout(root, lp);
        } catch (RuntimeException e) {
            Log.w(TAG, "could not update " + role, e);
        }
    }

    // ------------------------------------------------------- move/resize ---

    /** The page saw a press start on the header ("move") or the corner grip ("resize"). */
    void armDrag(String mode) {
        if (!touching || dragging) return;
        if ("move".equals(mode) || ("resize".equals(mode) && resizable)) dragMode = mode;
    }

    private boolean onTouch(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                touching = true;
                dragging = false;
                dragMode = null;
                downX = e.getRawX();
                downY = e.getRawY();
                startX = lp.x;
                startY = lp.y;
                startW = lp.width;
                startH = lp.height;
                setFocusable(true);
                return false;
            case MotionEvent.ACTION_MOVE: {
                if (dragMode == null) return false;
                float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                if (!dragging) {
                    if (Math.hypot(dx, dy) < slop) return false;
                    dragging = true;
                    // The page stops seeing this gesture (no long-press menu mid-drag).
                    MotionEvent cancel = MotionEvent.obtain(e);
                    cancel.setAction(MotionEvent.ACTION_CANCEL);
                    web.onTouchEvent(cancel);
                    cancel.recycle();
                }
                if ("move".equals(dragMode)) {
                    lp.x = startX + Math.round(dx);
                    lp.y = startY + Math.round(dy);
                } else {
                    lp.width = Math.max(minWidthPx, Math.min(startW + Math.round(dx), area.right - lp.x));
                    lp.height = Math.max(minHeightPx, Math.min(startH + Math.round(dy), area.bottom - lp.y));
                }
                scheduleUpdate(); // at most once per frame: touch events can come faster than frames
                return true;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL: {
                touching = false;
                boolean was = dragging;
                String mode = dragMode;
                dragging = false;
                dragMode = null;
                if (was) {
                    root.removeCallbacks(flushUpdate);
                    updatePending = false;
                    update();
                    listener.onDragged(this, mode);
                }
                return was;
            }
            default:
                return dragging;
        }
    }

    void onRendererGone() {
        long now = SystemClock.elapsedRealtime();
        crashes.addLast(now);
        while (!crashes.isEmpty() && crashes.peekFirst() < now - 60_000) crashes.removeFirst();
        root.removeAllViews();
        web.destroy();
        if (crashes.size() >= 3) {
            // Dying again and again: another reload would only loop.
            listener.onClosedByUser(this);
            return;
        }
        createWebView();
    }

    /** The window's root: notices touches elsewhere and the Back button. */
    private final class Root extends FrameLayout {
        Root(Context context) {
            super(context);
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent e) {
            if (e.getActionMasked() == MotionEvent.ACTION_OUTSIDE) {
                setFocusable(false);
                return false;
            }
            return super.dispatchTouchEvent(e);
        }

        @Override
        public boolean dispatchKeyEvent(KeyEvent e) {
            if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
                if (e.getAction() == KeyEvent.ACTION_UP) setFocusable(false);
                return true;
            }
            return super.dispatchKeyEvent(e);
        }
    }
}
