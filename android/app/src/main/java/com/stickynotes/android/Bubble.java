package com.stickynotes.android;

import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The floating Scratch button: a small round icon over every app, movable
 * anywhere on the screen, which docks to the nearest side when let go. A tap
 * opens the menu of features (the desktop launcher pad, ⋯ menu and tray menu
 * in one). It is the Android counterpart of the desktop "note pad" launcher.
 */
final class Bubble {
    interface Host {
        void onBubbleAction(String action);

        void onBubbleMoved(Rect bounds);

        int hiddenCount();

        boolean notesShown();

        Rect workArea();
    }

    private static final int INK = 0xFF27304A;
    private static final int DANGER = 0xFFB0443B;
    private static final int PAPER = 0xFFFFFDF5;
    // The logo has its own transparent margin and soft shadow, so the window needs only a small edge.
    private static final int SIZE_DP = 58, SHADOW_DP = 2;

    private final Context context;
    private final Host host;
    private final WindowManager wm;
    private final float density;
    private final FrameLayout bubbleRoot;
    private final WindowManager.LayoutParams blp;
    private FrameLayout menuRoot;
    private WindowManager.LayoutParams mlp;
    private long menuClosedAt = 0;
    private ValueAnimator snap;
    private boolean shown = false;

    @SuppressLint("ClickableViewAccessibility")
    Bubble(Context context, Host host, Rect saved) {
        this.context = context;
        this.host = host;
        this.wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        this.density = context.getResources().getDisplayMetrics().density;

        int size = px(SIZE_DP), pad = px(SHADOW_DP);
        bubbleRoot = new FrameLayout(context);
        bubbleRoot.setPadding(pad, pad, pad, pad);
        bubbleRoot.setClipToPadding(false);
        IconView icon = new IconView(context); // just the Scratch logo, no background
        icon.setContentDescription("Scratch");
        bubbleRoot.addView(icon, new FrameLayout.LayoutParams(size, size));

        blp = new WindowManager.LayoutParams(size + 2 * pad, size + 2 * pad,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        blp.gravity = Gravity.TOP | Gravity.START;
        blp.setTitle("Scratch bubble");
        Rect area = host.workArea();
        if (saved != null) {
            blp.x = saved.left;
            blp.y = saved.top;
        } else {
            blp.x = area.right - blp.width + pad / 2; // right edge, a third of the way down
            blp.y = area.top + area.height() / 3;
        }
        clampAndDock(false);

        final int slop = ViewConfiguration.get(context).getScaledTouchSlop();
        final float[] down = new float[2];
        final int[] start = new int[2];
        final boolean[] dragging = {false};
        icon.setOnTouchListener((v, e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    if (snap != null) snap.cancel();
                    down[0] = e.getRawX();
                    down[1] = e.getRawY();
                    start[0] = blp.x;
                    start[1] = blp.y;
                    dragging[0] = false;
                    v.setScaleX(0.92f);
                    v.setScaleY(0.92f);
                    v.setAlpha(1f);
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    float dx = e.getRawX() - down[0], dy = e.getRawY() - down[1];
                    if (!dragging[0] && Math.hypot(dx, dy) > slop) {
                        dragging[0] = true;
                        closeMenu();
                        closeTarget.appear();
                    }
                    if (dragging[0]) {
                        blp.x = start[0] + Math.round(dx);
                        blp.y = start[1] + Math.round(dy);
                        // Near the close target: the logo snaps onto it.
                        boolean over = closeTarget.contains(blp.x + blp.width / 2, blp.y + blp.height / 2);
                        closeTarget.setHot(over);
                        if (over) {
                            blp.x = closeTarget.centerX() - blp.width / 2;
                            blp.y = closeTarget.centerY() - blp.height / 2;
                        }
                        scheduleUpdate(); // once per frame, however many touch events arrive
                    }
                    return true;
                }
                case MotionEvent.ACTION_UP:
                    v.setScaleX(1f);
                    v.setScaleY(1f);
                    if (dragging[0]) {
                        boolean quit = closeTarget.isHot();
                        closeTarget.disappear();
                        if (quit) host.onBubbleAction("quit"); // dropped on ×: close Scratch, like Quit Scratch
                        else clampAndDock(true);
                    } else {
                        v.performClick();
                        toggleMenu();
                    }
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    v.setScaleX(1f);
                    v.setScaleY(1f);
                    closeTarget.disappear();
                    if (dragging[0]) clampAndDock(true);
                    return true;
                default:
                    return true;
            }
        });
    }

    private int px(float dp) {
        return Math.round(dp * density);
    }

    void show() {
        if (shown) return;
        try {
            closeTarget.attach(); // first, so the logo is drawn above it
            wm.addView(bubbleRoot, blp);
            shown = true;
        } catch (RuntimeException e) {
            android.util.Log.e("ScratchBubble", "could not show the bubble (overlay permission?)", e);
        }
    }

    void remove() {
        closeMenu();
        if (snap != null) snap.cancel();
        closeTarget.detach();
        if (!shown) return;
        try {
            wm.removeView(bubbleRoot);
        } catch (RuntimeException ignored) {
            // already gone
        }
        shown = false;
    }

    /** Put the bubble (and its close target, just below it) above notes that were just opened. */
    void raise() {
        if (!shown) return;
        try {
            wm.removeView(bubbleRoot);
            closeTarget.detach();
            closeTarget.attach();
            wm.addView(bubbleRoot, blp);
        } catch (RuntimeException ignored) {
            // not attached
        }
    }

    // ------------------------------------------------------ close target ---

    private final CloseTarget closeTarget = new CloseTarget();

    /**
     * The round × at the bottom of the screen while the logo is dragged.
     * Dropping the logo on it closes Scratch. It never takes touches; it is
     * just drawn, below the logo.
     */
    private final class CloseTarget {
        private static final int CIRCLE_DP = 60, WINDOW_DP = 92, BOTTOM_DP = 36, CATCH_DP = 64;
        private FrameLayout root;
        private CloseView view;
        private WindowManager.LayoutParams lp;
        private boolean attached = false, visible = false, hot = false;

        private void build() {
            if (root != null) return;
            root = new FrameLayout(context);
            view = new CloseView(context, px(CIRCLE_DP));
            root.addView(view, new FrameLayout.LayoutParams(px(WINDOW_DP), px(WINDOW_DP)));
            view.setAlpha(0f);
            view.setVisibility(View.INVISIBLE);
            int side = px(WINDOW_DP);
            lp = new WindowManager.LayoutParams(side, side,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START;
            lp.setTitle("Scratch close target");
        }

        /** Bottom centre of the usable screen (it may have rotated since last time). */
        private void place() {
            Rect area = host.workArea();
            lp.x = area.centerX() - lp.width / 2;
            lp.y = area.bottom - lp.height - px(BOTTOM_DP) + (lp.height - px(CIRCLE_DP)) / 2;
        }

        void attach() {
            build();
            if (attached) return;
            place();
            try {
                wm.addView(root, lp);
                attached = true;
            } catch (RuntimeException e) {
                android.util.Log.w("ScratchBubble", "no close target", e);
            }
        }

        void detach() {
            if (!attached) return;
            try {
                wm.removeView(root);
            } catch (RuntimeException ignored) {
                // already gone
            }
            attached = false;
        }

        int centerX() {
            return lp.x + lp.width / 2;
        }

        int centerY() {
            return lp.y + lp.height / 2;
        }

        boolean contains(int x, int y) {
            return visible && Math.hypot(x - centerX(), y - centerY()) < px(CATCH_DP);
        }

        boolean isHot() {
            return hot;
        }

        void appear() {
            if (!attached) return;
            place();
            try {
                wm.updateViewLayout(root, lp);
            } catch (RuntimeException ignored) {
                // not attached
            }
            visible = true;
            hot = false;
            view.setHot(false);
            view.animate().cancel();
            view.setVisibility(View.VISIBLE);
            view.setTranslationY(px(24));
            view.animate().alpha(1f).translationY(0f).setDuration(160).setInterpolator(new DecelerateInterpolator()).start();
        }

        void disappear() {
            if (!visible) return;
            visible = false;
            hot = false;
            view.animate().cancel();
            view.animate().alpha(0f).translationY(px(24)).setDuration(140)
                    .withEndAction(() -> view.setVisibility(View.INVISIBLE)).start();
        }

        void setHot(boolean on) {
            if (on == hot) return;
            hot = on;
            view.setHot(on);
            view.animate().scaleX(on ? 1.18f : 1f).scaleY(on ? 1.18f : 1f).setDuration(120).start();
            if (on) view.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);
        }
    }

    /** A round × button, ink-coloured, red when the logo is over it. */
    private static final class CloseView extends View {
        private final Paint circle = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint cross = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final int diameter;

        CloseView(Context c, int diameter) {
            super(c);
            this.diameter = diameter;
            float d = c.getResources().getDisplayMetrics().density;
            circle.setColor(0xD927304A);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(1.5f * d);
            ring.setColor(0x66FFFDF5);
            cross.setStyle(Paint.Style.STROKE);
            cross.setStrokeWidth(2.6f * d);
            cross.setStrokeCap(Paint.Cap.ROUND);
            cross.setColor(PAPER);
            setContentDescription("Drop here to close Scratch");
        }

        void setHot(boolean hot) {
            circle.setColor(hot ? 0xF0C4473C : 0xD927304A);
            invalidate();
        }

        @Override
        protected void onDraw(Canvas c) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f, r = diameter / 2f;
            c.drawCircle(cx, cy, r, circle);
            c.drawCircle(cx, cy, r - ring.getStrokeWidth() / 2, ring);
            float a = r * 0.34f;
            c.drawLine(cx - a, cy - a, cx + a, cy + a, cross);
            c.drawLine(cx - a, cy + a, cx + a, cy - a, cross);
        }
    }

    Rect bounds() {
        return new Rect(blp.x, blp.y, blp.x + blp.width, blp.y + blp.height);
    }

    private boolean updatePending = false;
    private final Runnable flushUpdate = () -> {
        updatePending = false;
        update();
    };

    private void scheduleUpdate() {
        if (updatePending) return;
        updatePending = true;
        bubbleRoot.postOnAnimation(flushUpdate);
    }

    private void update() {
        if (!shown) return;
        try {
            wm.updateViewLayout(bubbleRoot, blp);
        } catch (RuntimeException ignored) {
            // not attached
        }
    }

    /** Keep the bubble on screen and slide it to the nearest left or right side. */
    void clampAndDock(boolean animate) {
        Rect area = host.workArea();
        int pad = px(SHADOW_DP) / 2; // the shadow margin may hang off the edge
        int minX = area.left - pad, maxX = area.right - blp.width + pad;
        int y = Math.max(area.top, Math.min(blp.y, area.bottom - blp.height));
        int centre = blp.x + blp.width / 2;
        int x = centre < (area.left + area.right) / 2 ? minX : maxX;
        if (!animate || !shown) {
            blp.x = x;
            blp.y = y;
            update();
            host.onBubbleMoved(bounds());
            return;
        }
        final int fromX = blp.x, fromY = blp.y;
        snap = ValueAnimator.ofFloat(0f, 1f);
        snap.setDuration(220);
        snap.setInterpolator(new DecelerateInterpolator());
        snap.addUpdateListener(a -> {
            float t = (float) a.getAnimatedValue();
            blp.x = Math.round(fromX + (x - fromX) * t);
            blp.y = Math.round(fromY + (y - fromY) * t);
            update();
        });
        snap.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(android.animation.Animator animation) {
                host.onBubbleMoved(bounds());
            }
        });
        snap.start();
    }

    // -------------------------------------------------------------- menu ---

    boolean isMenuOpen() {
        return menuRoot != null;
    }

    void toggleMenu() {
        if (menuRoot != null) {
            closeMenu();
            return;
        }
        // The tap that closed the menu (a touch outside it) was on the bubble: leave it closed.
        if (SystemClock.uptimeMillis() - menuClosedAt < 300) return;
        openMenu();
    }

    void closeMenu() {
        if (menuRoot == null) return;
        try {
            wm.removeView(menuRoot);
        } catch (RuntimeException ignored) {
            // already gone
        }
        menuRoot = null;
        menuClosedAt = SystemClock.uptimeMillis();
    }

    /** Rebuild the open menu (e.g. the hidden count changed). */
    void refreshMenu() {
        if (menuRoot == null) return;
        closeMenu();
        menuClosedAt = 0;
        openMenu();
    }

    @SuppressLint("ClickableViewAccessibility")
    void openMenu() {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(PAPER);
        bg.setCornerRadius(px(14));
        bg.setStroke(Math.max(1, px(0.5f)), 0x24503C0A);
        card.setBackground(bg);
        card.setElevation(px(8));
        card.setPadding(0, px(6), 0, px(6));
        card.setClipToOutline(true);

        int hidden = host.hiddenCount();
        boolean notesShown = host.notesShown();
        addItem(card, "note", "Sticky note", null, INK, "note");
        addItem(card, "notepad", "Notepad", null, INK, "notepad");
        addItem(card, "timer", "Pomodoro", null, INK, "timer");
        addItem(card, "hidden", "Hidden notes", hidden > 0 ? String.valueOf(hidden) : null, INK, "hidden");
        addDivider(card);
        addItem(card, notesShown ? "eye-off" : "eye", notesShown ? "Hide notes for now" : "Show notes", null, INK, "toggle");
        addItem(card, "collapse", "Collapse all", null, INK, "collapse");
        addItem(card, "expand", "Expand all", null, INK, "expand");
        addDivider(card);
        addItem(card, "settings", "Settings", null, INK, "settings");
        addItem(card, "about", "About Scratch", null, INK, "about");
        addItem(card, "quit", "Quit Scratch", null, DANGER, "quit");

        int pad = px(10);
        FrameLayout root = new FrameLayout(context) {
            @Override
            public boolean dispatchTouchEvent(MotionEvent e) {
                if (e.getActionMasked() == MotionEvent.ACTION_OUTSIDE) {
                    post(Bubble.this::closeMenu); // not while this window is dispatching
                    return true;
                }
                return super.dispatchTouchEvent(e);
            }
        };
        root.setPadding(pad, pad, pad, pad);
        root.setClipToPadding(false);
        int width = px(236);
        root.addView(card, new FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.measure(View.MeasureSpec.makeMeasureSpec(width + 2 * pad, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        int w = root.getMeasuredWidth(), h = root.getMeasuredHeight();

        Rect area = host.workArea();
        Rect b = bounds();
        boolean onLeft = b.centerX() < (area.left + area.right) / 2;
        int x = onLeft ? b.right - px(4) : b.left - w + px(4);
        int y = b.centerY() - h / 2;
        x = Math.max(area.left, Math.min(x, area.right - w));
        y = Math.max(area.top, Math.min(y, area.bottom - h));

        mlp = new WindowManager.LayoutParams(w, Math.min(h, area.height()),
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        mlp.gravity = Gravity.TOP | Gravity.START;
        mlp.x = x;
        mlp.y = y;
        mlp.windowAnimations = android.R.style.Animation_Dialog;
        mlp.setTitle("Scratch menu");
        try {
            wm.addView(root, mlp);
            menuRoot = root;
        } catch (RuntimeException e) {
            android.util.Log.e("ScratchBubble", "could not open the menu", e);
        }
    }

    private void addItem(LinearLayout card, String glyph, String label, String badge, int color, String action) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(px(16), 0, px(16), 0);
        row.setMinimumHeight(px(46));
        row.setBackground(new RippleDrawable(ColorStateList.valueOf(0x1F503C0A), null, new android.graphics.drawable.ColorDrawable(Color.WHITE)));
        row.setClickable(true);
        row.setContentDescription(label);

        ImageView icon = new ImageView(context);
        icon.setImageDrawable(new Glyph(glyph, color));
        row.addView(icon, new LinearLayout.LayoutParams(px(22), px(22)));

        TextView text = new TextView(context);
        text.setText(label);
        text.setTextColor(color);
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        text.setSingleLine(true);
        text.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tl.leftMargin = px(14);
        row.addView(text, tl);

        if (badge != null) {
            TextView count = new TextView(context);
            count.setText(badge);
            count.setTextColor(PAPER);
            count.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            count.setGravity(Gravity.CENTER);
            count.setPadding(px(7), 0, px(7), 0);
            GradientDrawable pill = new GradientDrawable();
            pill.setColor(INK);
            pill.setCornerRadius(px(10));
            count.setBackground(pill);
            count.setMinWidth(px(22));
            row.addView(count, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(20)));
        }

        row.setOnClickListener(v -> {
            closeMenu();
            host.onBubbleAction(action);
        });
        card.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private void addDivider(LinearLayout card) {
        View line = new View(context);
        line.setBackgroundColor(0x1A27304A);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, px(1)));
        lp.topMargin = px(5);
        lp.bottomMargin = px(5);
        lp.leftMargin = px(14);
        lp.rightMargin = px(14);
        card.addView(line, lp);
    }

    /**
     * The button: only the Scratch logo, no background. The logo is scaled
     * once, when the view gets its size, so drawing it is a plain copy.
     */
    private static final class IconView extends View {
        private final Paint image = new Paint(Paint.FILTER_BITMAP_FLAG);
        private final Bitmap source;
        private Bitmap scaled;

        IconView(Context c) {
            super(c);
            source = BitmapFactory.decodeResource(c.getResources(), R.mipmap.ic_launcher);
        }

        @Override
        protected void onSizeChanged(int w, int h, int oldW, int oldH) {
            int side = Math.min(w, h);
            if (source == null || side <= 0) return;
            if (scaled != null && scaled != source) scaled.recycle();
            scaled = Bitmap.createScaledBitmap(source, side, side, true);
        }

        @Override
        protected void onDraw(Canvas c) {
            if (scaled == null) return;
            c.drawBitmap(scaled, (getWidth() - scaled.getWidth()) / 2f, (getHeight() - scaled.getHeight()) / 2f, image);
        }
    }
}
