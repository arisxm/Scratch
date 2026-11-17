package com.stickynotes.android;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * The app icon. Scratch lives in a floating button over other apps, so this
 * screen only asks for what that needs (display over other apps, and
 * notifications for reminders), starts the service and gets out of the way.
 */
public final class MainActivity extends Activity {
    private static final int ASK_NOTIFICATIONS = 1;
    private boolean askedNotifications = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) askedNotifications = state.getBoolean("asked");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean("asked", askedNotifications);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!Settings.canDrawOverlays(this)) {
            showExplanation();
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && !askedNotifications
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askedNotifications = true;
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, ASK_NOTIFICATIONS);
            return;
        }
        startScratch();
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == ASK_NOTIFICATIONS) startScratch(); // reminders are optional; carry on either way
    }

    private void startScratch() {
        Intent i = new Intent(this, ScratchService.class).setAction(ScratchService.ACTION_SHOW_ALL);
        startForegroundService(i);
        finish();
        overridePendingTransition(0, 0);
    }

    private int px(float dp) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, getResources().getDisplayMetrics()));
    }

    private void showExplanation() {
        int ink = 0xFF27304A;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(px(28), px(48), px(28), px(28));

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        box.addView(icon, new LinearLayout.LayoutParams(px(112), px(112)));

        TextView title = new TextView(this);
        title.setText("Scratch");
        title.setTextColor(ink);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, px(12), 0, px(6));
        box.addView(title);

        TextView body = new TextView(this);
        body.setText("Sticky-note to-do lists that stay on top of your other apps.\n\n"
                + "Scratch shows a small floating button you can drag anywhere on the screen. "
                + "Tap it for new notes, notepads, the Pomodoro timer and settings.\n\n"
                + "To float over other apps, Scratch needs the \"Display over other apps\" permission. "
                + "On the next screen, find Scratch and turn it on, then come back.");
        body.setTextColor(0xA827304A);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        body.setLineSpacing(0, 1.15f);
        body.setGravity(Gravity.CENTER);
        box.addView(body);

        Button grant = new Button(this);
        grant.setText("Allow display over other apps");
        grant.setAllCaps(false);
        grant.setTextColor(0xFFFFFDF5);
        grant.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFF3550A8);
        bg.setCornerRadius(px(24));
        grant.setBackground(bg);
        grant.setPadding(px(24), 0, px(24), 0);
        grant.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getPackageName()))));
        LinearLayout.LayoutParams gl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(48));
        gl.topMargin = px(28);
        box.addView(grant, gl);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFFFFF3A6);
        scroll.setFillViewport(true);
        scroll.addView(box);
        setContentView(scroll);
    }
}
