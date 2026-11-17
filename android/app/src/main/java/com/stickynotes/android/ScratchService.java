package com.stickynotes.android;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.WindowMetrics;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The Android counterpart of electron/main.js: a foreground service that owns
 * all data (notes, settings, notepads), keeps the Pomodoro and the deadline
 * reminders running, and shows the floating windows: the Scratch bubble and
 * its menu, one window per visible note, and the Hidden notes, Pomodoro,
 * Settings and About panels. Notepads open full screen in NotepadActivity.
 *
 * Pages talk to it through Bridge, using the desktop IPC channel names, and
 * the code below follows main.js closely so the two stay easy to compare.
 */
public final class ScratchService extends Service implements Panel.Listener, Pomodoro.Listener, Bubble.Host {
    static ScratchService instance;
    /** A phone with little memory or few cores: Scratch does less at once and draws more simply. */
    static boolean lowEnd = false;

    static boolean detectLowEnd(Context c) {
        android.app.ActivityManager am = c.getSystemService(android.app.ActivityManager.class);
        if (am == null) return false;
        if (am.isLowRamDevice()) return true;
        android.app.ActivityManager.MemoryInfo mem = new android.app.ActivityManager.MemoryInfo();
        am.getMemoryInfo(mem);
        return mem.totalMem <= 3L * 1024 * 1024 * 1024 || Runtime.getRuntime().availableProcessors() <= 4;
    }

    static final String ACTION_SHOW_ALL = "com.stickynotes.android.SHOW_ALL";
    static final String ACTION_REVEAL = "com.stickynotes.android.REVEAL";
    static final String ACTION_TIMER = "com.stickynotes.android.TIMER";
    static final String ACTION_TICK = "com.stickynotes.android.TICK";
    static final String ACTION_QUIT = "com.stickynotes.android.QUIT";
    static final String EXTRA_ID = "id";

    private static final String TAG = "Scratch";
    private static final String CH_RUNNING = "running", CH_ALERTS = "alerts", CH_ALERTS_QUIET = "alerts-quiet";
    private static final int NOTIFY_RUNNING = 1;

    // Window geometry in dp, as on desktop (the numbers match src/styles).
    private static final int NOTE_MIN_W = 230, NOTE_MIN_H = 200, NOTE_COLLAPSED_H = 68;
    private static final int[] MANAGER_SIZE = {404, 500}, TIMER_SIZE = {236, 416}, SETTINGS_SIZE = {372, 600}, ABOUT_SIZE = {300, 392};
    private static final int CASCADE_STEP = 28;
    private static final long REMINDER_CHECK_MS = 30_000;

    // From electron/about.js.
    private static final String[] DEVELOPERS = {"Arian Samin Islam", "Samin Yeasar Khan", "Sk. MD. Rashid Assef Shibly"};
    private static final String PUBLISHER = "Arian, Sadif & Shibly";

    Store store;
    NotepadStore notepads;
    private Pomodoro pomodoro;
    private Bubble bubble;
    private Handler main;
    private Context ui; // for windows, dialogs and screen metrics
    private float density = 1;
    private double uiScale = 1;
    private boolean notesShown = true; // "Hide notes for now" in the bubble menu
    private final Map<String, Panel> noteWindows = new LinkedHashMap<>();
    private final Map<String, Integer> popoverShift = new HashMap<>();
    private Panel managerWin, timerWin, settingsWin, aboutWin;
    private int notifyId = 100;
    private long scheduledWake = -1;
    private boolean started = false;

    private final Runnable reminderLoop = new Runnable() {
        @Override
        public void run() {
            checkReminders();
            main.postDelayed(this, REMINDER_CHECK_MS);
        }
    };

    // Screen off: pause every page. Screen on: resume them, and catch up on
    // timers that may have been asleep.
    private final BroadcastReceiver screenOn = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) {
                for (Panel p : allPanels()) p.pause();
                return;
            }
            for (Panel p : allPanels()) if (p.isShown()) p.resume();
            pomodoro.check();
            checkReminders();
        }
    };

    private List<Panel> allPanels() {
        List<Panel> out = new ArrayList<>(noteWindows.values());
        for (Panel p : new Panel[] {managerWin, timerWin, settingsWin, aboutWin}) if (p != null) out.add(p);
        return out;
    }

    /**
     * Open the saved notes one at a time rather than all at once: each is a
     * web page, and starting many together is what froze slower phones.
     */
    private void openNotesOneByOne(List<String> ids, int i) {
        if (instance != this) return;
        if (i >= ids.size()) {
            bubble.raise(); // keep the button above the notes
            return;
        }
        JSONObject note = store.getNote(ids.get(i));
        if (note != null && !J.bool(note, "hidden")) createNoteWindow(note, false);
        main.postDelayed(() -> openNotesOneByOne(ids, i + 1), lowEnd ? 450 : 150);
    }

    // ------------------------------------------------------------ lifecycle ---

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        main = new Handler(Looper.getMainLooper());
        // Windows over other apps are added through a window context: a
        // Service is not a visual context (Android 11+ checks this).
        Display display = getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
        if (Build.VERSION.SDK_INT >= 31) {
            ui = createWindowContext(display, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null);
        } else if (Build.VERSION.SDK_INT == 30) {
            ui = createDisplayContext(display).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null);
        } else {
            ui = this;
        }
        density = ui.getResources().getDisplayMetrics().density;
        createChannels();
        goForeground();
        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "no permission to draw over other apps; stopping");
            stopSelf();
            return;
        }
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        lowEnd = detectLowEnd(this);
        Log.i(TAG, "low-end phone mode: " + lowEnd);
        boot();
    }

    private void boot() {
        store = new Store(new File(getFilesDir(), "sticky-notes.json"));
        store.load();
        notepads = new NotepadStore(getFilesDir());
        notepads.load();
        // A notepad is open only while its screen is: any left "open" by a
        // stopped app waits under Hidden notes, like a closed one.
        for (JSONObject pad : notepads.pads) {
            if (!J.bool(pad, "hidden") && !NotepadActivity.isShowing(pad.optString("id"))) notepads.setHidden(pad, true);
        }
        JSONObject st = store.settings();
        uiScale = J.num(st, "scale", 1);
        pomodoro = new Pomodoro(this);
        pomodoro.autoFocus = J.bool(st, "pomodoroAutoFocus");
        JSONObject lengths = st.optJSONObject("pomodoroLengths");
        pomodoro.setDurations(lengths.optInt("focusMin", Schema.FOCUS_DEFAULT) * Pomodoro.MINUTE,
                lengths.optInt("breakMin", Schema.BREAK_DEFAULT) * Pomodoro.MINUTE);
        if (J.bool(st, "startCollapsed")) {
            JSONArray notes = store.notes();
            for (int i = 0; i < notes.length(); i++) J.put(notes.optJSONObject(i), "collapsed", true);
            store.save();
        }

        JSONObject savedBubble = Schema.sanitizeBounds(J.get(st, "launcherBounds"));
        bubble = new Bubble(ui, this, savedBubble == null ? null
                : new Rect(px(savedBubble.optInt("x")), px(savedBubble.optInt("y")), 0, 0));
        JSONArray notes = store.notes();
        List<String> visible = new ArrayList<>();
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.optJSONObject(i);
            if (!J.bool(note, "hidden")) visible.add(note.optString("id"));
        }
        if (store.isFirstRun && store.notes().length() == 0) {
            // A slower phone starts with animations off (Settings can turn them on).
            if (lowEnd) J.put(st, "animations", false);
            firstRunNote();
        }
        bubble.show();
        openNotesOneByOne(visible, 0);
        reportRecovery();

        IntentFilter screen = new IntentFilter(Intent.ACTION_SCREEN_ON);
        screen.addAction(Intent.ACTION_SCREEN_OFF);
        registerReceiver(screenOn, screen);
        main.postDelayed(reminderLoop, 4000); // let the notes appear before any notification
        started = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        goForeground(); // every start through startForegroundService() must confirm it
        if (!started) return START_NOT_STICKY;
        String action = intent == null ? null : intent.getAction();
        if (ACTION_QUIT.equals(action)) {
            quit();
        } else if (ACTION_REVEAL.equals(action)) {
            JSONObject note = store.getNote(intent.getStringExtra(EXTRA_ID));
            if (note != null) revealNote(note);
        } else if (ACTION_TIMER.equals(action)) {
            openTimer();
        } else if (ACTION_TICK.equals(action)) {
            scheduledWake = -1; // that alarm is used up; set the next one even if it's for the same time
            pomodoro.check();
            checkReminders();
        } else if (ACTION_SHOW_ALL.equals(action)) {
            showAllNotes();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (started) {
            main.removeCallbacksAndMessages(null); // the reminder loop and any notes still waiting to open
            try {
                unregisterReceiver(screenOn);
            } catch (RuntimeException ignored) {
                // not registered
            }
            store.flush();
            notepads.saveIndexSync();
            closeAllWindows();
            bubble.remove();
        }
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (!started) return;
        // Rotation or a new screen size: keep every window on screen.
        main.postDelayed(() -> {
            density = ui.getResources().getDisplayMetrics().density;
            reclampAll();
            bubble.closeMenu();
            bubble.clampAndDock(false);
        }, 250);
    }

    private void quit() {
        store.flush();
        notepads.saveIndexSync();
        if (NotepadActivity.current != null) NotepadActivity.current.finish();
        AlarmManager am = getSystemService(AlarmManager.class);
        if (am != null) am.cancel(tickIntent());
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void closeAllWindows() {
        for (Panel p : new ArrayList<>(noteWindows.values())) p.close();
        noteWindows.clear();
        for (Panel p : new Panel[] {managerWin, timerWin, settingsWin, aboutWin}) if (p != null) p.close();
        managerWin = timerWin = settingsWin = aboutWin = null;
    }

    // ---------------------------------------------------------- geometry ---

    int px(double dp) {
        return (int) Math.round(dp * density);
    }

    private int dp(int px) {
        return (int) Math.round(px / density);
    }

    /** Base size in dp -> window size in pixels, at the Size setting. */
    private int sc(double baseDp) {
        return px(baseDp * uiScale);
    }

    /** The part of the screen windows may use: below the status bar, above the navigation bar. */
    @Override
    public Rect workArea() {
        WindowManager wm = ui.getSystemService(WindowManager.class);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowMetrics m = wm.getMaximumWindowMetrics();
            Insets in = m.getWindowInsets().getInsetsIgnoringVisibility(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Rect b = m.getBounds();
            return new Rect(b.left + in.left, b.top + in.top, b.right - in.right, b.bottom - in.bottom);
        }
        DisplayMetrics dm = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(dm);
        return new Rect(0, dimen("status_bar_height"), dm.widthPixels, dm.heightPixels - dimen("navigation_bar_height"));
    }

    private int dimen(String name) {
        int id = ui.getResources().getIdentifier(name, "dimen", "android");
        return id > 0 ? ui.getResources().getDimensionPixelSize(id) : 0;
    }

    /** Keep a rectangle fully inside the work area (clampToWorkArea in main.js). */
    private Rect clamp(Rect b) {
        Rect wa = workArea();
        int w = Math.min(b.width(), wa.width()), h = Math.min(b.height(), wa.height());
        int x = Math.max(wa.left, Math.min(b.left, wa.right - w));
        int y = Math.max(wa.top, Math.min(b.top, wa.bottom - h));
        return new Rect(x, y, x + w, y + h);
    }

    // ---------------------------------------------------------- notes ---

    private String noteLabel(JSONObject note) {
        String title = note.optString("title").trim();
        if (!title.isEmpty()) return title;
        try {
            if ("monthly".equals(note.optString("mode"))) {
                Date d = new SimpleDateFormat("yyyy-MM", Locale.ROOT).parse(note.optString("month"));
                return new SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(d);
            }
            Date d = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).parse(note.optString("date"));
            return new SimpleDateFormat("d MMM", Locale.getDefault()).format(d);
        } catch (Exception e) {
            return "Note";
        }
    }

    private JSONObject toRenderer(JSONObject n) {
        return J.obj(
                "id", n.optString("id"),
                "title", n.optString("title"),
                "color", n.optString("color"),
                "mode", n.optString("mode"),
                "date", n.optString("date"),
                "month", n.optString("month"),
                "tasks", n.optJSONArray("tasks"),
                "collapsed", J.bool(n, "collapsed"),
                "opacity", J.num(n, "opacity", 1),
                "historyOpen", J.bool(n, "historyOpen"),
                "ticker", J.bool(store.settings(), "ticker"));
    }

    private Rect windowBoundsFor(JSONObject note) {
        JSONObject b = note.optJSONObject("bounds");
        int w = sc(Math.max(b.optInt("width"), NOTE_MIN_W));
        int h = sc(J.bool(note, "collapsed") ? NOTE_COLLAPSED_H : Math.max(b.optInt("height"), NOTE_MIN_H));
        int x = px(b.optInt("x")), y = px(b.optInt("y"));
        return clamp(new Rect(x, y, x + w, y + h));
    }

    /** Window pixels -> note bounds in dp, with the size stored at scale 1 (baseBounds in main.js). */
    private JSONObject baseBounds(Rect r) {
        return Schema.bounds(dp(r.left), dp(r.top),
                (int) Math.round(dp(r.width()) / uiScale), (int) Math.round(dp(r.height()) / uiScale));
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return s;
        }
    }

    private Panel createNoteWindow(JSONObject note, boolean focus) {
        String id = note.optString("id");
        Panel existing = noteWindows.get(id);
        if (existing != null) {
            if (notesShown) existing.show();
            existing.raise();
            if (focus) existing.setFocusable(true);
            return existing;
        }
        Rect bounds = windowBoundsFor(note);
        JSONObject nb = note.optJSONObject("bounds");
        J.put(nb, "x", dp(bounds.left));
        J.put(nb, "y", dp(bounds.top));

        Bridge bridge = new Bridge("note", id, true);
        Panel p = new Panel(ui, this, bridge, "view=note&id=" + enc(id) + "&fresh=" + (focus ? "1" : "0"), bounds, focus);
        p.resizable = !J.bool(note, "collapsed");
        p.minWidthPx = sc(NOTE_MIN_W);
        p.minHeightPx = sc(NOTE_MIN_H);
        p.area = workArea();
        p.lp.alpha = (float) J.num(note, "opacity", 1);
        noteWindows.put(id, p);
        if (notesShown) p.show();
        return p;
    }

    private Rect nextNotePosition() {
        Rect wa = workArea();
        int visible = 0;
        JSONArray notes = store.notes();
        for (int i = 0; i < notes.length(); i++) if (!J.bool(notes.optJSONObject(i), "hidden")) visible++;
        int step = px((visible % 6) * CASCADE_STEP);
        int w = sc(Schema.DEFAULT_NOTE_W), h = sc(Schema.DEFAULT_NOTE_H);
        int x = wa.left + (wa.width() - w) / 2 - px(CASCADE_STEP * 2) + step;
        int y = wa.top + px(56) + step;
        return clamp(new Rect(x, y, x + w, y + h));
    }

    private JSONObject newNote(String mode, String title, JSONArray tasks) {
        JSONObject st = store.settings();
        String fixed = Schema.COLORS.contains(st.optString("newNoteColor")) ? st.optString("newNoteColor") : null;
        int cursor = st.optInt("colorCursor");
        String pick = fixed != null ? fixed : Schema.COLORS.get(cursor % Schema.COLORS.size());
        if (fixed == null) J.put(st, "colorCursor", (cursor + 1) % Schema.COLORS.size());
        Rect at = nextNotePosition();
        JSONObject opts = J.obj("mode", mode, "title", title, "tasks", tasks, "color", pick,
                "bounds", Schema.bounds(dp(at.left), dp(at.top), Schema.DEFAULT_NOTE_W, Schema.DEFAULT_NOTE_H));
        JSONObject note = Schema.createNote(opts);
        store.addNote(note);
        if (!notesShown) showAllNotes();
        createNoteWindow(note, true);
        bubble.raise();
        return note;
    }

    private void pushNote(JSONObject note) {
        Panel p = noteWindows.get(note.optString("id"));
        if (p != null) p.bridge.emit("note:changed", toRenderer(note));
    }

    // A collapsed note's window is only as tall as its strip; it grows while
    // the colour palette is open (setPopoverHeight in main.js).
    private void setPopoverHeight(JSONObject note, Object height) {
        String id = note.optString("id");
        Panel p = noteWindows.get(id);
        if (p == null || !J.bool(note, "collapsed")) return;
        Rect cur = p.bounds();
        if (height == null) {
            Integer shift = popoverShift.remove(id);
            int s = shift == null ? 0 : shift;
            p.setBounds(new Rect(cur.left, cur.top + s, cur.right, cur.top + s + sc(NOTE_COLLAPSED_H)));
            return;
        }
        if (!J.isNum(height)) return;
        int want = (int) Math.round(Math.max(sc(NOTE_COLLAPSED_H), Math.min(px(((Number) height).doubleValue() * uiScale), sc(600))));
        if (want <= cur.height()) return;
        Rect next = clamp(new Rect(cur.left, cur.top, cur.right, cur.top + want));
        Integer prev = popoverShift.get(id);
        popoverShift.put(id, (prev == null ? 0 : prev) + (cur.top - next.top));
        p.setBounds(next);
    }

    private void setCollapsed(JSONObject note, boolean collapsed) {
        String id = note.optString("id");
        Integer shiftObj = popoverShift.remove(id);
        int shift = shiftObj == null ? 0 : shiftObj;
        J.put(note, "collapsed", collapsed);
        Panel p = noteWindows.get(id);
        if (p != null) {
            Rect grown = p.bounds();
            Rect cur = new Rect(grown.left, grown.top + shift, grown.right, grown.bottom + shift);
            if (collapsed) {
                p.setBounds(new Rect(cur.left, cur.top, cur.right, cur.top + sc(NOTE_COLLAPSED_H)));
            } else {
                JSONObject b = note.optJSONObject("bounds");
                Rect next = clamp(new Rect(cur.left, cur.top, cur.right, cur.top + sc(Math.max(b.optInt("height"), NOTE_MIN_H))));
                p.setBounds(next);
                J.put(note, "bounds", baseBounds(next));
            }
            p.resizable = !collapsed;
        }
        store.save();
    }

    private void hideNote(JSONObject note) {
        J.put(note, "hidden", true);
        J.put(note, "hiddenAt", System.currentTimeMillis());
        store.save();
        Panel p = noteWindows.remove(note.optString("id"));
        if (p != null) p.close();
        broadcastHidden();
    }

    private void reopenNote(JSONObject note, boolean focus) {
        J.put(note, "hidden", false);
        J.put(note, "hiddenAt", null);
        store.save();
        if (!notesShown) showAllNotes();
        createNoteWindow(note, focus);
        broadcastHidden();
    }

    private void setAllOpacity(Object value) {
        Double v = Schema.cleanOpacity(value);
        if (v == null) return;
        JSONArray notes = store.notes();
        for (int i = 0; i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            J.put(n, "opacity", v);
            Panel p = noteWindows.get(n.optString("id"));
            if (p != null) p.setOpacity(v);
            pushNote(n);
        }
        store.save();
        broadcastSettings();
    }

    private void setAllCollapsed(boolean collapsed) {
        JSONArray notes = store.notes();
        for (int i = 0; i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (J.bool(n, "hidden") || J.bool(n, "collapsed") == collapsed) continue;
            setCollapsed(n, collapsed);
            pushNote(n);
        }
    }

    private void showAllNotes() {
        notesShown = true;
        for (Panel p : noteWindows.values()) p.show();
        reclampAll();
        bubble.raise();
    }

    private void hideAllNotesForNow() {
        notesShown = false;
        for (Panel p : noteWindows.values()) p.hide();
    }

    private void reclampAll() {
        Rect wa = workArea();
        for (Map.Entry<String, Panel> e : noteWindows.entrySet()) {
            Panel p = e.getValue();
            p.area = wa;
            Rect safe = clamp(p.bounds());
            p.setBounds(safe);
            JSONObject note = store.getNote(e.getKey());
            if (note != null) {
                JSONObject b = note.optJSONObject("bounds");
                J.put(b, "x", dp(safe.left));
                J.put(b, "y", dp(safe.top));
            }
        }
        for (Panel p : new Panel[] {managerWin, timerWin, settingsWin, aboutWin}) {
            if (p != null) p.setBounds(clamp(p.bounds()));
        }
        store.save();
    }

    private void revealNote(JSONObject note) {
        if (J.bool(note, "hidden")) {
            reopenNote(note, true);
            return;
        }
        if (!notesShown) showAllNotes();
        createNoteWindow(note, true);
    }

    /** Delete notes and notepads after one confirmation (deleteNotes/deleteHiddenItems in main.js). */
    private void deleteItems(List<JSONObject> notes, List<JSONObject> pads, boolean all, java.util.function.Consumer<Integer> done) {
        int total = notes.size() + pads.size();
        if (total == 0) {
            done.accept(0);
            return;
        }
        boolean one = total == 1;
        int tasks = 0;
        for (JSONObject n : notes) tasks += n.optJSONArray("tasks").length();
        String title, message, yes;
        if (pads.isEmpty()) {
            String what = one ? "“" + noteLabel(notes.get(0)) + "”" : all ? "all " + total + " hidden notes" : total + " notes";
            String lost = tasks > 0 ? (one ? "Its " : "Their ") + tasks + " task" + (tasks == 1 ? "" : "s") + " will be removed. " : "";
            title = "Delete " + what + "?";
            message = lost + "This can't be undone.";
            yes = one ? "Delete note" : "Delete " + total + " notes";
        } else {
            String what = one ? "“" + notepadLabel(pads.get(0)) + "”" : all ? "all " + total + " hidden items" : total + " items";
            String drawings = one ? "Its drawing" : pads.size() == 1 ? "A notepad drawing" : pads.size() + " notepad drawings";
            String lost = tasks > 0 ? drawings + " and " + tasks + " task" + (tasks == 1 ? "" : "s") : drawings;
            title = "Delete " + what + "?";
            message = lost + " will be removed. This can't be undone.";
            yes = one ? "Delete notepad" : "Delete " + total + " items";
        }
        Dialogs.confirm(ui, title, message, yes, (ok) -> {
            if (!ok) {
                done.accept(0);
                return;
            }
            int deleted = 0;
            for (JSONObject n : notes) {
                String id = n.optString("id");
                if (store.getNote(id) == null) continue;
                store.deleteNote(id);
                Panel p = noteWindows.remove(id);
                if (p != null) p.close();
                deleted++;
            }
            for (JSONObject pad : pads) {
                String id = pad.optString("id");
                if (notepads.get(id) == null) continue;
                if (NotepadActivity.isShowing(id)) NotepadActivity.current.discard();
                notepads.remove(id);
                deleted++;
            }
            broadcastHidden();
            done.accept(deleted);
        });
    }

    private void noteMenu(JSONObject note) {
        boolean daily = "daily".equals(note.optString("mode"));
        boolean collapsed = J.bool(note, "collapsed");
        boolean anyDone = false;
        JSONArray tasks = note.optJSONArray("tasks");
        for (int i = 0; i < tasks.length(); i++) if (J.bool(tasks.optJSONObject(i), "done")) anyDone = true;
        List<String> items = new ArrayList<>();
        List<Runnable> actions = new ArrayList<>();
        items.add((daily ? "✓  " : "      ") + "Daily list");
        actions.add(() -> {
            J.put(note, "mode", "daily");
            store.save();
            pushNote(note);
        });
        items.add((daily ? "      " : "✓  ") + "Monthly goals");
        actions.add(() -> {
            J.put(note, "mode", "monthly");
            store.save();
            pushNote(note);
        });
        items.add(collapsed ? "Expand" : "Collapse");
        actions.add(() -> {
            setCollapsed(note, !J.bool(note, "collapsed"));
            pushNote(note);
        });
        if (anyDone) {
            items.add("Clear completed history");
            actions.add(() -> {
                JSONArray kept = new JSONArray();
                JSONArray all = note.optJSONArray("tasks");
                for (int i = 0; i < all.length(); i++) if (!J.bool(all.optJSONObject(i), "done")) kept.put(all.optJSONObject(i));
                J.put(note, "tasks", kept);
                store.save();
                pushNote(note);
            });
        }
        items.add("Hide note");
        actions.add(() -> hideNote(note));
        items.add("Delete note…");
        actions.add(() -> {
            List<JSONObject> list = new ArrayList<>();
            list.add(note);
            deleteItems(list, new ArrayList<>(), false, (n) -> {});
        });
        Dialogs.menu(ui, noteLabel(note), items.toArray(new String[0]), (which) -> {
            if (store.getNote(note.optString("id")) != null) actions.get(which).run();
        });
    }

    private void firstRunNote() {
        long now = System.currentTimeMillis();
        String[] lines = {
                "Type in the box above and press Enter to add a task",
                "Tap the circle to check a task off",
                "Drag this note by its top strip",
                "Long-press the top strip for more options",
                "Tap the floating Scratch button for a new note",
        };
        JSONArray tasks = new JSONArray();
        for (int i = 0; i < lines.length; i++) {
            tasks.put(J.obj("id", "welcome-" + i, "text", lines[i], "done", false, "createdAt", now + i));
        }
        newNote("daily", "Start here", tasks);
    }

    private void reportRecovery() {
        if (store.loadedFrom != null && store.loadedFrom.equals(store.bak)) {
            Dialogs.message(ui, "Scratch restored your notes from a backup.",
                    "Your notes file couldn't be read, so Scratch opened the most recent backup. Your last few changes may be missing.");
        } else if (store.loadedFrom == null && !store.isFirstRun) {
            Dialogs.message(ui, "Scratch couldn't read your notes.",
                    "Your notes file is damaged and no usable backup was found, so Scratch started with no notes."
                            + (store.unreadableFile != null ? "\n\nThe damaged file was kept as " + store.unreadableFile.getName() + "." : ""));
        }
    }

    // ------------------------------------------------- paper panels ---

    private Panel createPaperWindow(String role, int[] size, String boundsKey) {
        JSONObject saved = Schema.sanitizeBounds(J.get(store.settings(), boundsKey));
        int w = sc(size[0]), h = sc(size[1]);
        Rect wa = workArea();
        int x = saved != null ? px(saved.optInt("x")) : wa.left + (wa.width() - w) / 2;
        int y = saved != null ? px(saved.optInt("y")) : wa.top + (wa.height() - h) / 2;
        Rect bounds = clamp(new Rect(x, y, x + w, y + h));
        Bridge bridge = new Bridge(role, null, true);
        Panel p = new Panel(ui, this, bridge, "view=" + role, bounds, true);
        p.area = wa;
        p.show();
        bubble.raise();
        return p;
    }

    private void focusPanel(Panel p) {
        p.show();
        p.raise();
        p.setFocusable(true);
    }

    private void openManager() {
        if (managerWin != null) focusPanel(managerWin);
        else managerWin = createPaperWindow("manager", MANAGER_SIZE, "managerBounds");
    }

    private void openTimer() {
        if (timerWin != null) focusPanel(timerWin);
        else timerWin = createPaperWindow("timer", TIMER_SIZE, "timerBounds");
    }

    private void openSettings() {
        if (settingsWin != null) focusPanel(settingsWin);
        else settingsWin = createPaperWindow("settings", SETTINGS_SIZE, "settingsBounds");
    }

    private void openAbout() {
        if (aboutWin != null) focusPanel(aboutWin);
        else aboutWin = createPaperWindow("about", ABOUT_SIZE, "aboutBounds");
    }

    private void closePanel(Panel p) {
        if (p == null) return;
        p.close();
        if (p == managerWin) managerWin = null;
        if (p == timerWin) timerWin = null;
        if (p == settingsWin) settingsWin = null;
        if (p == aboutWin) aboutWin = null;
    }

    private static String boundsKeyFor(String role) {
        switch (role) {
            case "manager": return "managerBounds";
            case "timer": return "timerBounds";
            case "settings": return "settingsBounds";
            case "about": return "aboutBounds";
            default: return null;
        }
    }

    // Panel.Listener
    @Override
    public void onDragged(Panel p, String mode) {
        Rect safe = clamp(p.bounds());
        p.setBounds(safe);
        if ("note".equals(p.role)) {
            JSONObject note = store.getNote(p.id);
            if (note == null) return;
            if ("resize".equals(mode)) {
                J.put(note, "bounds", baseBounds(safe));
            } else {
                JSONObject b = note.optJSONObject("bounds");
                J.put(b, "x", dp(safe.left));
                J.put(b, "y", dp(safe.top));
            }
        } else {
            String key = boundsKeyFor(p.role);
            if (key != null) J.put(store.settings(), key, Schema.bounds(dp(safe.left), dp(safe.top), dp(safe.width()), dp(safe.height())));
        }
        store.save();
    }

    @Override
    public void onClosedByUser(Panel p) {
        if ("note".equals(p.role)) {
            Panel removed = noteWindows.remove(p.id);
            if (removed != null) removed.close();
            Dialogs.message(ui, "A Scratch note keeps closing unexpectedly.",
                    "Your notes are safe. Show it again from Hidden notes, or restart Scratch.");
            JSONObject note = store.getNote(p.id);
            if (note != null) hideNote(note);
        } else {
            closePanel(p);
        }
    }

    // ------------------------------------------------- hidden notes ---

    private String notepadLabel(JSONObject pad) {
        String t = pad.optString("title").trim();
        return t.isEmpty() ? "Untitled notepad" : t;
    }

    private JSONArray hiddenItems() {
        List<JSONObject> items = new ArrayList<>();
        JSONArray notes = store.notes();
        for (int i = 0; i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (!J.bool(n, "hidden")) continue;
            JSONArray tasks = n.optJSONArray("tasks");
            int done = 0;
            JSONArray preview = new JSONArray();
            for (int k = 0; k < tasks.length(); k++) {
                JSONObject t = tasks.optJSONObject(k);
                if (J.bool(t, "done")) done++;
                else if (preview.length() < 2) preview.put(t.optString("text"));
            }
            items.add(J.obj(
                    "id", n.optString("id"),
                    "label", noteLabel(n),
                    "untitled", n.optString("title").trim().isEmpty(),
                    "color", n.optString("color"),
                    "mode", n.optString("mode"),
                    "total", tasks.length(),
                    "done", done,
                    "preview", preview,
                    "hiddenAt", J.get(n, "hiddenAt")));
        }
        for (JSONObject p : notepads.pads) {
            if (!J.bool(p, "hidden")) continue;
            items.add(J.obj(
                    "id", p.optString("id"),
                    "kind", "notepad",
                    "label", notepadLabel(p),
                    "untitled", p.optString("title").trim().isEmpty(),
                    "paper", p.optString("paper"),
                    "preview", new JSONArray(),
                    "hiddenAt", J.get(p, "hiddenAt")));
        }
        items.sort((a, b) -> Double.compare(J.num(b, "hiddenAt", 0), J.num(a, "hiddenAt", 0)));
        JSONArray out = new JSONArray();
        for (JSONObject o : items) out.put(o);
        return out;
    }

    @Override
    public int hiddenCount() {
        int n = 0;
        JSONArray notes = store.notes();
        for (int i = 0; i < notes.length(); i++) if (J.bool(notes.optJSONObject(i), "hidden")) n++;
        for (JSONObject p : notepads.pads) if (J.bool(p, "hidden")) n++;
        return n;
    }

    void broadcastHidden() {
        if (!started) return;
        if (managerWin != null) managerWin.bridge.emit("hidden:changed", hiddenItems());
        bubble.refreshMenu();
    }

    private Set<String> idSet(Object v) {
        Set<String> ids = new HashSet<>();
        if (v instanceof JSONArray) {
            JSONArray a = (JSONArray) v;
            for (int i = 0; i < a.length(); i++) if (J.at(a, i) instanceof String) ids.add((String) J.at(a, i));
        }
        return ids;
    }

    private List<JSONObject> hiddenNotesByIds(Set<String> ids) {
        List<JSONObject> out = new ArrayList<>();
        JSONArray notes = store.notes();
        for (int i = 0; i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (J.bool(n, "hidden") && ids.contains(n.optString("id"))) out.add(n);
        }
        return out;
    }

    private List<JSONObject> hiddenPadsByIds(Set<String> ids) {
        List<JSONObject> out = new ArrayList<>();
        for (JSONObject p : notepads.pads) if (J.bool(p, "hidden") && ids.contains(p.optString("id"))) out.add(p);
        return out;
    }

    // ------------------------------------------------------- notepads ---

    private void newNotepad() {
        openNotepad(notepads.create());
    }

    private void openNotepad(JSONObject pad) {
        notepads.setHidden(pad, false);
        broadcastHidden();
        Intent i = new Intent(this, NotepadActivity.class)
                .putExtra(EXTRA_ID, pad.optString("id"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
    }

    /** The notepad screen closed: the notepad waits under Hidden notes, like a closed window on desktop. */
    void onNotepadClosed(String id) {
        JSONObject pad = notepads.get(id);
        if (pad == null || J.bool(pad, "hidden")) return;
        notepads.setHidden(pad, true);
        broadcastHidden();
    }

    // ------------------------------------------------------- settings ---

    private JSONObject settingsSnapshot() {
        JSONObject st = store.settings();
        JSONArray notes = store.notes();
        Object opacity = null;
        if (notes.length() > 0) {
            double first = J.num(notes.optJSONObject(0), "opacity", 1);
            boolean same = true;
            for (int i = 1; i < notes.length(); i++) if (J.num(notes.optJSONObject(i), "opacity", 1) != first) same = false;
            if (same) opacity = first;
        }
        JSONArray scales = new JSONArray();
        for (double s : Schema.SCALES) scales.put(Double.valueOf(s)); // put(double) throws a checked exception
        JSONArray colors = new JSONArray(Schema.COLORS);
        JSONObject lengths = st.optJSONObject("pomodoroLengths");
        return J.obj(
                "alwaysOnTop", J.bool(st, "alwaysOnTop"),
                "reminders", J.bool(st, "reminders"),
                "ticker", J.bool(st, "ticker"),
                "scale", J.num(st, "scale", 1),
                "animations", J.bool(st, "animations"),
                "startCollapsed", J.bool(st, "startCollapsed"),
                "newNoteColor", st.optString("newNoteColor"),
                "notifySound", J.bool(st, "notifySound"),
                "newNoteMode", st.optString("newNoteMode"),
                "reminderHour", st.optInt("reminderHour"),
                "pomodoroAutoFocus", J.bool(st, "pomodoroAutoFocus"),
                "pomodoroNotify", J.bool(st, "pomodoroNotify"),
                "focusMin", lengths.optInt("focusMin"),
                "breakMin", lengths.optInt("breakMin"),
                "openAtLogin", J.bool(st, "openAtLogin"),
                "startupSupported", true,
                "opacity", opacity,
                "scales", scales,
                "colors", colors,
                "limits", J.obj(
                        "focusMin", new JSONArray(java.util.Arrays.asList(Schema.FOCUS_LIMITS[0], Schema.FOCUS_LIMITS[1])),
                        "breakMin", new JSONArray(java.util.Arrays.asList(Schema.BREAK_LIMITS[0], Schema.BREAK_LIMITS[1]))));
    }

    private List<Bridge> allBridges() {
        List<Bridge> out = new ArrayList<>();
        for (Panel p : noteWindows.values()) out.add(p.bridge);
        for (Panel p : new Panel[] {managerWin, timerWin, settingsWin, aboutWin}) if (p != null) out.add(p.bridge);
        if (NotepadActivity.current != null && NotepadActivity.current.bridge != null) out.add(NotepadActivity.current.bridge);
        return out;
    }

    void broadcastSettings() {
        if (!started) return;
        JSONObject snap = settingsSnapshot();
        for (Bridge b : allBridges()) b.emit("settings:changed", snap);
    }

    private void setScale(Object value) {
        Double next = Schema.cleanScale(value);
        if (next == null || next == uiScale) return;
        uiScale = next;
        J.put(store.settings(), "scale", next);
        popoverShift.clear();
        for (Map.Entry<String, Panel> e : noteWindows.entrySet()) {
            JSONObject note = store.getNote(e.getKey());
            if (note == null) continue;
            Panel p = e.getValue();
            Rect cur = p.bounds();
            JSONObject copy = J.copy(note);
            JSONObject b = copy.optJSONObject("bounds");
            J.put(b, "x", dp(cur.left));
            J.put(b, "y", dp(cur.top));
            p.setBounds(windowBoundsFor(copy));
            p.minWidthPx = sc(NOTE_MIN_W);
            p.minHeightPx = sc(NOTE_MIN_H);
        }
        Object[][] fixed = {{managerWin, MANAGER_SIZE}, {timerWin, TIMER_SIZE}, {settingsWin, SETTINGS_SIZE}, {aboutWin, ABOUT_SIZE}};
        for (Object[] f : fixed) {
            Panel p = (Panel) f[0];
            int[] size = (int[]) f[1];
            if (p == null) continue;
            Rect cur = p.bounds();
            p.setBounds(clamp(new Rect(cur.left, cur.top, cur.left + sc(size[0]), cur.top + sc(size[1]))));
        }
        reclampAll();
        broadcastSettings();
    }

    private void setPomodoroLengths(Object v) {
        if (!(v instanceof JSONObject)) return;
        JSONObject in = (JSONObject) v;
        JSONObject cur = store.settings().optJSONObject("pomodoroLengths");
        Integer f = Schema.cleanMinutes("focusMin", J.get(in, "focusMin"));
        Integer b = Schema.cleanMinutes("breakMin", J.get(in, "breakMin"));
        JSONObject next = J.obj("focusMin", f != null ? f : cur.optInt("focusMin"), "breakMin", b != null ? b : cur.optInt("breakMin"));
        J.put(store.settings(), "pomodoroLengths", next);
        store.save();
        pomodoro.setDurations(next.optInt("focusMin") * Pomodoro.MINUTE, next.optInt("breakMin") * Pomodoro.MINUTE);
        broadcastSettings();
    }

    private void setSetting(String key, Object v) {
        JSONObject st = store.settings();
        switch (key) {
            case "alwaysOnTop":
            case "openAtLogin":
            case "ticker":
            case "reminders":
            case "animations":
            case "startCollapsed":
            case "notifySound":
            case "pomodoroAutoFocus":
            case "pomodoroNotify":
                if (!(v instanceof Boolean)) return;
                J.put(st, key, v);
                pomodoro.autoFocus = J.bool(st, "pomodoroAutoFocus");
                store.save();
                if ("ticker".equals(key)) {
                    JSONArray notes = store.notes();
                    for (int i = 0; i < notes.length(); i++) if (!J.bool(notes.optJSONObject(i), "hidden")) pushNote(notes.optJSONObject(i));
                }
                if ("reminders".equals(key) && Boolean.TRUE.equals(v)) checkReminders();
                broadcastSettings();
                return;
            case "opacity":
                setAllOpacity(v);
                return;
            case "scale":
                setScale(v);
                return;
            case "newNoteColor": {
                String c = Schema.cleanNewNoteColor(v);
                if (c == null) return;
                J.put(st, key, c);
                break;
            }
            case "newNoteMode": {
                String m = Schema.cleanNewNoteMode(v);
                if (m == null) return;
                J.put(st, key, m);
                break;
            }
            case "reminderHour": {
                Integer h = Schema.cleanHour(v);
                if (h == null) return;
                J.put(st, key, h);
                break;
            }
            default:
                return;
        }
        store.save();
        broadcastSettings();
    }

    private void resetSettings() {
        Dialogs.confirm(ui, "Restore the default settings?", "Your notes, tasks and window positions are not changed.",
                "Restore defaults", (ok) -> {
                    if (!ok) return;
                    JSONObject d = Schema.defaultSettings();
                    setScale(J.num(d, "scale", 1));
                    setAllOpacity(1);
                    setPomodoroLengths(d.optJSONObject("pomodoroLengths"));
                    JSONObject st = store.settings();
                    for (String k : new String[] {"alwaysOnTop", "ticker", "reminders", "animations", "startCollapsed", "newNoteColor",
                            "notifySound", "newNoteMode", "reminderHour", "pomodoroAutoFocus", "pomodoroNotify"}) {
                        J.put(st, k, J.get(d, k));
                    }
                    pomodoro.autoFocus = J.bool(st, "pomodoroAutoFocus");
                    JSONArray notes = store.notes();
                    for (int i = 0; i < notes.length(); i++) if (!J.bool(notes.optJSONObject(i), "hidden")) pushNote(notes.optJSONObject(i));
                    store.save();
                    broadcastSettings();
                });
    }

    // ------------------------------------------------------- pomodoro ---

    private int sessionsToday() {
        JSONObject p = store.settings().optJSONObject("pomodoro");
        return p != null && Schema.localDateKey().equals(J.get(p, "date")) ? p.optInt("count") : 0;
    }

    private JSONObject timerSnapshot() {
        JSONObject s = pomodoro.snapshot();
        JSONObject lengths = store.settings().optJSONObject("pomodoroLengths");
        J.put(s, "sessionsToday", sessionsToday());
        J.put(s, "focusMin", lengths.optInt("focusMin"));
        J.put(s, "breakMin", lengths.optInt("breakMin"));
        return s;
    }

    @Override
    public void onChange() {
        if (!started) return;
        if (timerWin != null) timerWin.bridge.emit("timer:changed", timerSnapshot());
        scheduleWake();
    }

    @Override
    public void onFinish(String phase) {
        JSONObject st = store.settings();
        long breakMin = Math.max(1, Math.round(pomodoro.breakMs / 60_000.0));
        if ("focus".equals(phase)) {
            J.put(st, "pomodoro", J.obj("date", Schema.localDateKey(), "count", sessionsToday() + 1));
            store.save();
        }
        if (!J.bool(st, "pomodoroNotify")) return;
        // The sound is played here, not by the notification: it then rings even
        // when Scratch's notifications are off or the notification volume is down.
        if (J.bool(st, "notifySound")) playPomodoroSound();
        if ("focus".equals(phase)) {
            notify("Focus session finished", "Nice work. Take a " + breakMin + "-minute break.", ACTION_TIMER, null, true);
        } else {
            notify("Break is over", pomodoro.autoFocus ? "The next focus session has started." : "Ready for the next focus session?", ACTION_TIMER, null, true);
        }
    }

    private android.media.Ringtone chime;
    private final Runnable stopChime = () -> {
        if (chime != null) chime.stop();
    };

    /** The phone's notification sound, on the alarm stream (like a kitchen timer), for at most 6 s. */
    private void playPomodoroSound() {
        try {
            android.net.Uri uri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION);
            if (uri == null) uri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM);
            if (uri == null) return;
            main.removeCallbacks(stopChime);
            if (chime != null) chime.stop();
            chime = android.media.RingtoneManager.getRingtone(this, uri);
            if (chime == null) return;
            chime.setAudioAttributes(new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            // The phone may be asleep (the session ended on an alarm): stay awake while it plays.
            android.os.PowerManager pm = getSystemService(android.os.PowerManager.class);
            if (pm != null) pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "Scratch:pomodoro-sound").acquire(7000);
            chime.play();
            main.postDelayed(stopChime, 6000);
        } catch (RuntimeException e) {
            Log.w(TAG, "could not play the Pomodoro sound", e);
        }
    }

    // ------------------------------------------------------ reminders ---

    private void checkReminders() {
        if (!started) return;
        JSONObject st = store.settings();
        if (J.bool(st, "reminders")) {
            List<Reminders.Due> due = Reminders.due(store.notes(), System.currentTimeMillis(), st.optInt("reminderHour", 9));
            if (!due.isEmpty()) {
                for (Reminders.Due d : due) J.put(d.task, "reminded", true);
                store.save();
                if (due.size() > 3) {
                    // e.g. the phone was off for a few days: one summary instead of a pile
                    StringBuilder names = new StringBuilder();
                    for (int i = 0; i < 3; i++) names.append(due.get(i).task.optString("text")).append('\n');
                    names.append("and ").append(due.size() - 3).append(" more");
                    notify(due.size() + " tasks need attention", names.toString(), ACTION_SHOW_ALL, null);
                } else {
                    for (Reminders.Due d : due) {
                        notify(d.late ? "Task overdue" : "Task due now", d.task.optString("text") + "\n" + noteLabel(d.note),
                                ACTION_REVEAL, d.note.optString("id"));
                    }
                }
                // The notes' "reminded" flags changed under them.
                for (Reminders.Due d : due) pushNote(d.note);
            }
        }
        scheduleWake();
    }

    private PendingIntent tickIntent() {
        Intent i = new Intent(this, ScratchService.class).setAction(ACTION_TICK);
        return PendingIntent.getForegroundService(this, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Wake the phone for the next Pomodoro end or deadline; Handler timers don't run while it sleeps. */
    private void scheduleWake() {
        AlarmManager am = getSystemService(AlarmManager.class);
        if (am == null) return;
        long now = System.currentTimeMillis();
        long next = 0;
        if (pomodoro.isRunning()) next = pomodoro.endsAt;
        JSONObject st = store.settings();
        if (J.bool(st, "reminders")) {
            long r = Reminders.next(store.notes(), now, st.optInt("reminderHour", 9));
            if (r > 0 && (next == 0 || r < next)) next = r;
        }
        if (next == scheduledWake) return; // already set (the reminder check runs every 30 s)
        scheduledWake = next;
        PendingIntent pi = tickIntent();
        if (next == 0) {
            am.cancel(pi);
            return;
        }
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
        }
    }

    // --------------------------------------------------- notifications ---

    private void createChannels() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel running = new NotificationChannel(CH_RUNNING, "Scratch is running", NotificationManager.IMPORTANCE_MIN);
        running.setDescription("Keeps the Scratch button and your notes on screen.");
        running.setShowBadge(false);
        NotificationChannel alerts = new NotificationChannel(CH_ALERTS, "Reminders and Pomodoro", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Deadlines that arrive, and finished focus sessions and breaks.");
        NotificationChannel quiet = new NotificationChannel(CH_ALERTS_QUIET, "Reminders and Pomodoro (silent)", NotificationManager.IMPORTANCE_HIGH);
        quiet.setDescription("Used when \"Notification sound\" is off in Scratch's settings.");
        quiet.setSound(null, null);
        quiet.enableVibration(false);
        nm.createNotificationChannel(running);
        nm.createNotificationChannel(alerts);
        nm.createNotificationChannel(quiet);
    }

    private PendingIntent serviceIntent(int code, String action, String id) {
        Intent i = new Intent(this, ScratchService.class).setAction(action);
        if (id != null) i.putExtra(EXTRA_ID, id);
        return PendingIntent.getForegroundService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void goForeground() {
        Notification n = new Notification.Builder(this, CH_RUNNING)
                .setSmallIcon(R.drawable.ic_stat_scratch)
                .setContentTitle("Scratch")
                .setContentText("Tap to show your notes")
                .setContentIntent(serviceIntent(2, ACTION_SHOW_ALL, null))
                .addAction(new Notification.Action.Builder(null, "Quit", serviceIntent(3, ACTION_QUIT, null)).build())
                .setOngoing(true)
                .setShowWhen(false)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFY_RUNNING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFY_RUNNING, n);
        }
    }

    private void notify(String title, String body, String action, String id) {
        notify(title, body, action, id, false);
    }

    /** `quiet`: the caller plays its own sound (Pomodoro), so the notification must not. */
    private void notify(String title, String body, String action, String id, boolean quiet) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        boolean sound = !quiet && J.bool(store.settings(), "notifySound");
        int nid = ++notifyId;
        Notification n = new Notification.Builder(this, sound ? CH_ALERTS : CH_ALERTS_QUIET)
                .setSmallIcon(R.drawable.ic_stat_scratch)
                .setContentTitle(title)
                .setContentText(body.replace('\n', ' '))
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(serviceIntent(nid, action, id))
                .setAutoCancel(true)
                .setCategory(ACTION_TIMER.equals(action) ? Notification.CATEGORY_ALARM : Notification.CATEGORY_REMINDER)
                .build();
        nm.notify(nid, n);
    }

    // ---------------------------------------------------------- bubble ---

    @Override
    public void onBubbleAction(String action) {
        switch (action) {
            case "note":
                newNote(store.settings().optString("newNoteMode", "daily"), null, null);
                break;
            case "notepad":
                newNotepad();
                break;
            case "timer":
                openTimer();
                break;
            case "hidden":
                openManager();
                break;
            case "toggle":
                if (notesShown) hideAllNotesForNow();
                else showAllNotes();
                break;
            case "collapse":
                if (!notesShown) showAllNotes();
                setAllCollapsed(true);
                break;
            case "expand":
                if (!notesShown) showAllNotes();
                setAllCollapsed(false);
                break;
            case "settings":
                openSettings();
                break;
            case "about":
                openAbout();
                break;
            case "quit":
                quit();
                break;
            default:
                break;
        }
    }

    @Override
    public void onBubbleMoved(Rect b) {
        if (store == null) return;
        J.put(store.settings(), "launcherBounds", Schema.bounds(dp(b.left), dp(b.top), dp(b.width()), dp(b.height())));
        store.save();
    }

    @Override
    public boolean notesShown() {
        return notesShown;
    }

    // ------------------------------------------------------------- IPC ---

    /** Every message from a page (ipcMain handlers in main.js). Runs on the main thread. */
    void handle(Bridge from, String channel, JSONArray args, int callId) {
        Object a0 = Bridge.arg(args, 0), a1 = Bridge.arg(args, 1);
        JSONObject note = "note".equals(from.role) ? store.getNote(from.id) : null;
        String role = from.role;
        switch (channel) {
            // ---- the note's own window
            case "note:get":
                from.resolve(callId, note != null ? toRenderer(note) : null);
                return;
            case "note:update": {
                if (note == null) return;
                JSONObject clean = Schema.sanitizeNotePatch(a0);
                if (clean.length() == 0) return;
                if (clean.has("tasks")) Reminders.carryReminded(note.optJSONArray("tasks"), clean.optJSONArray("tasks"));
                for (Iterator<String> it = clean.keys(); it.hasNext(); ) {
                    String k = it.next();
                    J.put(note, k, J.get(clean, k));
                }
                J.put(note, "updatedAt", System.currentTimeMillis());
                if (clean.has("opacity")) {
                    Panel p = noteWindows.get(from.id);
                    if (p != null) p.setOpacity(J.num(note, "opacity", 1));
                }
                store.save();
                if (clean.has("tasks")) scheduleWake();
                return;
            }
            case "note:popover-height":
                if (note != null) setPopoverHeight(note, a0);
                return;
            case "note:set-collapsed":
                if (note == null || !(a0 instanceof Boolean)) {
                    from.resolve(callId, false);
                    return;
                }
                setCollapsed(note, (Boolean) a0);
                // Let the window finish changing size before the page relays out.
                main.postDelayed(() -> from.resolve(callId, true), 30);
                return;
            case "note:resize":
                return; // done natively (Panel), see bridge.js
            case "note:hide":
                if (note != null) hideNote(note);
                return;
            case "note:context-menu":
                if (note != null) noteMenu(note);
                return;

            // ---- app-wide
            case "app:new-note": {
                Object mode = a0 instanceof JSONObject ? J.get((JSONObject) a0, "mode") : null;
                newNote(mode != null && Schema.MODES.contains(mode) ? (String) mode : store.settings().optString("newNoteMode", "daily"), null, null);
                return;
            }
            case "app:menu":
                bubble.openMenu();
                return;
            case "app:open-manager":
                openManager();
                return;
            case "app:open-timer":
                openTimer();
                return;
            case "app:open-settings":
                openSettings();
                return;
            case "app:new-notepad":
            case "app:open-notepad":
                newNotepad();
                return;
            case "app:hidden-count":
                from.resolve(callId, hiddenCount());
                return;
            case "window:close":
                if (from.panel != null && ("manager".equals(role) || "timer".equals(role) || "about".equals(role) || "settings".equals(role))) {
                    closePanel(from.panel);
                }
                return;

            // ---- Hidden notes (only that panel)
            case "hidden:list":
                from.resolve(callId, "manager".equals(role) ? hiddenItems() : new JSONArray());
                return;
            case "hidden:restore": {
                if (!"manager".equals(role)) {
                    from.resolve(callId, 0);
                    return;
                }
                Set<String> ids = idSet(a0);
                List<JSONObject> notes = hiddenNotesByIds(ids);
                for (JSONObject n : notes) reopenNote(n, false);
                List<JSONObject> pads = hiddenPadsByIds(ids);
                // One notepad screen at a time on a phone: open the first one chosen.
                for (JSONObject p : pads) notepads.setHidden(p, false);
                if (!pads.isEmpty()) openNotepad(pads.get(0));
                for (int i = 1; i < pads.size(); i++) notepads.setHidden(pads.get(i), true);
                broadcastHidden();
                from.resolve(callId, notes.size() + Math.min(1, pads.size()));
                return;
            }
            case "hidden:delete": {
                if (!"manager".equals(role)) {
                    from.resolve(callId, 0);
                    return;
                }
                Set<String> ids = idSet(a0);
                List<JSONObject> notes = hiddenNotesByIds(ids);
                List<JSONObject> pads = hiddenPadsByIds(ids);
                int chosen = notes.size() + pads.size();
                deleteItems(notes, pads, chosen > 1 && chosen == hiddenCount(), (n) -> from.resolve(callId, n));
                return;
            }

            // ---- About
            case "about:get": {
                String webview = "";
                android.content.pm.PackageInfo wv = WebView.getCurrentWebViewPackage();
                if (wv != null && wv.versionName != null) webview = " · WebView " + wv.versionName.split("\\.")[0];
                from.resolve(callId, J.obj(
                        "name", "Scratch",
                        "version", BuildConfig.VERSION_NAME,
                        "publisher", PUBLISHER,
                        "developers", new JSONArray(java.util.Arrays.asList(DEVELOPERS)),
                        "license", "MIT License",
                        "repository", null,
                        "year", 2026,
                        "runtime", "Android " + Build.VERSION.RELEASE + webview));
                return;
            }
            case "about:open-repository":
                return; // no public repository yet (REPOSITORY_URL is empty in about.js)

            // ---- Settings (only that panel may change things)
            case "settings:get":
                from.resolve(callId, settingsSnapshot());
                return;
            case "settings:set":
                if ("settings".equals(role) && a0 instanceof String) setSetting((String) a0, a1);
                return;
            case "settings:action":
                if (!"settings".equals(role)) return;
                if ("show-all".equals(a0)) showAllNotes();
                else if ("reset".equals(a0)) resetSettings();
                else if ("open-data".equals(a0)) {
                    Dialogs.message(ui, "Where your notes are kept",
                            "Scratch saves your notes on this phone only, in its private app storage:\n\n"
                                    + store.file.getPath() + "\n\nNothing leaves your phone.");
                }
                return;

            // ---- Pomodoro
            case "timer:get":
                from.resolve(callId, timerSnapshot());
                return;
            case "timer:set-lengths":
                if ("timer".equals(role) || "settings".equals(role)) setPomodoroLengths(a0);
                return;
            case "timer:command":
                if (!"timer".equals(role)) return;
                if ("start".equals(a0)) pomodoro.start();
                else if ("pause".equals(a0)) pomodoro.pause();
                else if ("reset".equals(a0)) pomodoro.reset();
                else if ("skip".equals(a0)) pomodoro.skip();
                return;

            // ---- a floating page's <input type=date|time|month>
            case "x:pick": {
                if (!(a0 instanceof JSONObject)) {
                    from.resolve(callId, null);
                    return;
                }
                JSONObject req = (JSONObject) a0;
                if (from.panel != null) from.panel.setFocusable(false); // the dialog takes the keyboard
                Dialogs.pick(ui, J.str(req, "type", "date"), J.str(req, "value", ""), (value) -> from.resolve(callId, value));
                return;
            }

            default:
                if (channel.startsWith("notepad:") && from.activity != null) {
                    from.activity.handle(channel, a0, callId);
                }
        }
    }

    // Used by NotepadActivity.
    JSONObject notepadLoad(String id) {
        JSONObject pad = notepads.get(id);
        if (pad == null) return null;
        byte[] image = notepads.readImage(id);
        return J.obj(
                "id", id,
                "title", pad.optString("title"),
                "paper", pad.optString("paper"),
                "width", pad.optInt("width"),
                "height", pad.optInt("height"),
                "image", image != null ? Bridge.bytes(image) : null);
    }
}
