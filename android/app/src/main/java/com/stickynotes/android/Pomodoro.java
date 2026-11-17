package com.stickynotes.android;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

/**
 * Pomodoro: a focus session, then a break. A port of electron/pomodoro.js.
 * It lives in the service, so the countdown keeps going while its panel is
 * closed. The service also sets an alarm for endsAt, because a Handler timer
 * doesn't run while the phone sleeps; check() finishes the phase if it is due.
 */
final class Pomodoro {
    interface Listener {
        void onChange();

        void onFinish(String phase);
    }

    static final long MINUTE = 60_000;

    long focusMs = Schema.FOCUS_DEFAULT * MINUTE;
    long breakMs = Schema.BREAK_DEFAULT * MINUTE;
    boolean autoFocus = false;
    String phase = "focus"; // focus | break
    String status = "idle"; // idle | running | paused
    long remainingMs = focusMs;
    long totalMs = focusMs;
    long endsAt = 0;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable finishTask = this::check;
    private final Listener listener;

    Pomodoro(Listener listener) {
        this.listener = listener;
    }

    private long durationOf(String p) {
        return "focus".equals(p) ? focusMs : breakMs;
    }

    JSONObject snapshot() {
        boolean running = "running".equals(status);
        long remaining = running ? Math.max(0, endsAt - System.currentTimeMillis()) : remainingMs;
        return J.obj(
                "phase", phase,
                "status", status,
                "remainingMs", remaining,
                "endsAt", running ? endsAt : null,
                "durationMs", totalMs);
    }

    /** An idle timer picks new lengths up straight away; a session under way keeps its length. */
    void setDurations(long focus, long brk) {
        focusMs = focus;
        breakMs = brk;
        if ("idle".equals(status)) {
            remainingMs = durationOf(phase);
            totalMs = remainingMs;
        }
        listener.onChange();
    }

    void start() {
        if ("running".equals(status)) return;
        status = "running";
        endsAt = System.currentTimeMillis() + remainingMs;
        arm();
        listener.onChange();
    }

    void pause() {
        if (!"running".equals(status)) return;
        remainingMs = Math.max(0, endsAt - System.currentTimeMillis());
        disarm();
        endsAt = 0;
        status = "paused";
        listener.onChange();
    }

    void reset() {
        enter("focus");
        listener.onChange();
    }

    void skip() {
        enter("focus".equals(phase) ? "break" : "focus");
        listener.onChange();
    }

    boolean isRunning() {
        return "running".equals(status);
    }

    private void enter(String p) {
        disarm();
        endsAt = 0;
        phase = p;
        status = "idle";
        remainingMs = durationOf(p);
        totalMs = remainingMs;
    }

    private void arm() {
        disarm();
        handler.postDelayed(finishTask, Math.max(0, endsAt - System.currentTimeMillis()));
    }

    private void disarm() {
        handler.removeCallbacks(finishTask);
    }

    /** Finish the running phase if its time has come (timer, alarm, or the screen coming back on). */
    void check() {
        if (!"running".equals(status)) return;
        long now = System.currentTimeMillis();
        if (now < endsAt) {
            arm();
            return;
        }
        String finished = phase;
        if ("focus".equals(finished)) {
            enter("break");
            status = "running"; // the break starts on its own
            endsAt = now + remainingMs;
            arm();
        } else {
            enter("focus"); // wait for the user, unless autoFocus is on
            if (autoFocus) {
                status = "running";
                endsAt = now + remainingMs;
                arm();
            }
        }
        listener.onFinish(finished);
        listener.onChange();
    }
}
