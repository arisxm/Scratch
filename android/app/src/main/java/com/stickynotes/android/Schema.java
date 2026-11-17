package com.stickynotes.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Data shape and validation: a port of electron/schema.js. The data file has
 * the same layout as on desktop (sticky-notes.json), except that note bounds
 * are in Android dp rather than desktop pixels. Pages are treated as
 * untrusted input: every patch passes through sanitizeNotePatch().
 */
final class Schema {
    private Schema() {}

    static final int SCHEMA_VERSION = 1;
    static final List<String> COLORS = Arrays.asList(
            "yellow", "pink", "lavender", "mint", "sky", "peach", "coral", "lime", "aqua", "orchid", "sand", "stone");
    static final List<String> MODES = Arrays.asList("daily", "monthly");
    static final int TITLE_MAX = 80, TASK_TEXT_MAX = 500, TASKS_PER_NOTE = 500, ID_MAX = 64;
    static final int DEFAULT_NOTE_W = 300, DEFAULT_NOTE_H = 360;
    static final double OPACITY_MIN = 0.3, OPACITY_MAX = 1, OPACITY_DEFAULT = 1;
    static final double[] SCALES = {0.8, 0.9, 1, 1.1, 1.25, 1.5};
    static final int[] FOCUS_LIMITS = {1, 180}, BREAK_LIMITS = {1, 60};
    static final int FOCUS_DEFAULT = 25, BREAK_DEFAULT = 5;

    private static final Pattern DATE_RE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern MONTH_RE = Pattern.compile("^\\d{4}-(0[1-9]|1[0-2])$");
    private static final Pattern TIME_RE = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");

    // ------------------------------------------------------------- dates ---

    static String pad2(int n) {
        return n < 10 ? "0" + n : String.valueOf(n);
    }

    static String localDateKey() {
        Calendar c = Calendar.getInstance();
        return c.get(Calendar.YEAR) + "-" + pad2(c.get(Calendar.MONTH) + 1) + "-" + pad2(c.get(Calendar.DAY_OF_MONTH));
    }

    static String localMonthKey() {
        Calendar c = Calendar.getInstance();
        return c.get(Calendar.YEAR) + "-" + pad2(c.get(Calendar.MONTH) + 1);
    }

    static boolean isValidDateKey(Object v) {
        if (!(v instanceof String) || !DATE_RE.matcher((String) v).matches()) return false;
        String s = (String) v;
        int y = Integer.parseInt(s.substring(0, 4));
        int m = Integer.parseInt(s.substring(5, 7));
        int d = Integer.parseInt(s.substring(8, 10));
        if (m < 1 || m > 12 || d < 1) return false;
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(y, m - 1, 1);
        return d <= c.getActualMaximum(Calendar.DAY_OF_MONTH);
    }

    /** A deadline is a day ("2026-11-20") or a day and time ("2026-11-20T17:30"). */
    static boolean isValidDeadline(Object v) {
        if (!(v instanceof String)) return false;
        String s = (String) v;
        if (s.length() == 10) return isValidDateKey(s);
        return s.length() == 16 && s.charAt(10) == 'T' && isValidDateKey(s.substring(0, 10))
                && TIME_RE.matcher(s.substring(11)).matches();
    }

    static boolean isValidMonthKey(Object v) {
        return v instanceof String && MONTH_RE.matcher((String) v).matches();
    }

    // ---------------------------------------------------------- cleaners ---

    static String cleanId(Object v) {
        return v instanceof String && !((String) v).isEmpty() && ((String) v).length() <= ID_MAX ? (String) v : null;
    }

    /** Note transparency: 1 is solid; never below 0.3 so a note can't vanish. */
    static Double cleanOpacity(Object v) {
        if (!J.isNum(v)) return null;
        double d = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, ((Number) v).doubleValue()));
        return Math.round(d * 100) / 100.0;
    }

    static String cleanTitle(Object v) {
        if (!(v instanceof String)) return null;
        String t = ((String) v).replaceAll("[\\r\\n\\t]+", " ");
        return t.length() > TITLE_MAX ? t.substring(0, TITLE_MAX) : t;
    }

    static JSONObject sanitizeTask(Object v, boolean trusted) {
        if (!(v instanceof JSONObject)) return null;
        JSONObject raw = (JSONObject) v;
        String id = cleanId(J.get(raw, "id"));
        if (id == null) return null;
        Object textRaw = J.get(raw, "text");
        if (!(textRaw instanceof String)) return null;
        String text = ((String) textRaw).replaceAll("[\\r\\n]+", " ");
        if (text.length() > TASK_TEXT_MAX) text = text.substring(0, TASK_TEXT_MAX);
        if (text.trim().isEmpty()) return null;
        boolean done = J.bool(raw, "done");
        long now = System.currentTimeMillis();
        Object createdAt = J.get(raw, "createdAt");
        Object completedAt = J.get(raw, "completedAt");
        Object deadline = J.get(raw, "deadline");
        return J.obj(
                "id", id,
                "text", text,
                "done", done,
                "createdAt", J.isNum(createdAt) ? createdAt : now,
                "completedAt", done ? (J.isNum(completedAt) ? completedAt : now) : null,
                "deadline", isValidDeadline(deadline) ? deadline : null,
                "reminded", trusted && J.bool(raw, "reminded"));
    }

    static JSONArray sanitizeTasks(Object v, boolean trusted) {
        if (!(v instanceof JSONArray)) return null;
        JSONArray list = (JSONArray) v;
        Set<String> seen = new HashSet<>();
        JSONArray out = new JSONArray();
        for (int i = 0; i < list.length() && i < TASKS_PER_NOTE; i++) {
            JSONObject task = sanitizeTask(J.at(list, i), trusted);
            if (task != null && seen.add(task.optString("id"))) out.put(task);
        }
        return out;
    }

    static JSONObject sanitizeBounds(Object v) {
        if (!(v instanceof JSONObject)) return null;
        JSONObject raw = (JSONObject) v;
        Object x = J.get(raw, "x"), y = J.get(raw, "y"), w = J.get(raw, "width"), h = J.get(raw, "height");
        if (!J.isNum(x) || !J.isNum(y) || !J.isNum(w) || !J.isNum(h)) return null;
        if (((Number) w).doubleValue() <= 0 || ((Number) h).doubleValue() <= 0) return null;
        return bounds(
                (int) Math.round(((Number) x).doubleValue()),
                (int) Math.round(((Number) y).doubleValue()),
                (int) Math.round(((Number) w).doubleValue()),
                (int) Math.round(((Number) h).doubleValue()));
    }

    static JSONObject bounds(int x, int y, int w, int h) {
        return J.obj("x", x, "y", y, "width", w, "height", h);
    }

    /** Validate a partial update coming from a note page; unknown keys and bad values are dropped. */
    static JSONObject sanitizeNotePatch(Object v) {
        JSONObject out = new JSONObject();
        if (!(v instanceof JSONObject)) return out;
        JSONObject patch = (JSONObject) v;
        if (patch.has("title")) {
            String t = cleanTitle(J.get(patch, "title"));
            if (t != null) J.put(out, "title", t);
        }
        Object color = J.get(patch, "color");
        if (color != null && COLORS.contains(color)) J.put(out, "color", color);
        Object mode = J.get(patch, "mode");
        if (mode != null && MODES.contains(mode)) J.put(out, "mode", mode);
        if (isValidDateKey(J.get(patch, "date"))) J.put(out, "date", J.get(patch, "date"));
        if (isValidMonthKey(J.get(patch, "month"))) J.put(out, "month", J.get(patch, "month"));
        if (patch.has("tasks")) {
            JSONArray tasks = sanitizeTasks(J.get(patch, "tasks"), false);
            if (tasks != null) J.put(out, "tasks", tasks);
        }
        if (patch.has("opacity")) {
            Double o = cleanOpacity(J.get(patch, "opacity"));
            if (o != null) J.put(out, "opacity", o);
        }
        if (J.get(patch, "historyOpen") instanceof Boolean) J.put(out, "historyOpen", J.get(patch, "historyOpen"));
        return out;
    }

    static JSONObject createNote(JSONObject opts) {
        if (opts == null) opts = new JSONObject();
        long now = System.currentTimeMillis();
        String title = cleanTitle(J.get(opts, "title"));
        Object color = J.get(opts, "color");
        Object mode = J.get(opts, "mode");
        Object date = J.get(opts, "date");
        Object month = J.get(opts, "month");
        JSONArray tasks = sanitizeTasks(J.get(opts, "tasks"), true);
        Double opacity = cleanOpacity(J.get(opts, "opacity"));
        JSONObject b = sanitizeBounds(J.get(opts, "bounds"));
        return J.obj(
                "id", UUID.randomUUID().toString(),
                "title", title != null ? title : "",
                "color", color != null && COLORS.contains(color) ? color : COLORS.get(0),
                "mode", mode != null && MODES.contains(mode) ? mode : "daily",
                "date", isValidDateKey(date) ? date : localDateKey(),
                "month", isValidMonthKey(month) ? month : localMonthKey(),
                "tasks", tasks != null ? tasks : new JSONArray(),
                "opacity", opacity != null ? opacity : OPACITY_DEFAULT,
                "historyOpen", J.bool(opts, "historyOpen"),
                "collapsed", false,
                "hidden", false,
                "hiddenAt", null,
                "bounds", b != null ? b : bounds(40, 120, DEFAULT_NOTE_W, DEFAULT_NOTE_H),
                "createdAt", now,
                "updatedAt", now);
    }

    /** Repair a note read from disk. Returns null if it is unrecoverable. */
    static JSONObject normalizeNote(Object v) {
        if (!(v instanceof JSONObject)) return null;
        JSONObject raw = (JSONObject) v;
        String id = cleanId(J.get(raw, "id"));
        if (id == null) return null;
        JSONObject note = createNote(raw);
        boolean hidden = J.bool(raw, "hidden");
        Object hiddenAt = J.get(raw, "hiddenAt");
        Object createdAt = J.get(raw, "createdAt");
        Object updatedAt = J.get(raw, "updatedAt");
        J.put(note, "id", id);
        J.put(note, "collapsed", J.bool(raw, "collapsed"));
        J.put(note, "hidden", hidden);
        J.put(note, "hiddenAt", hidden && J.isNum(hiddenAt) ? hiddenAt : null);
        if (J.isNum(createdAt)) J.put(note, "createdAt", createdAt);
        if (J.isNum(updatedAt)) J.put(note, "updatedAt", updatedAt);
        // Trusted data keeps its "already reminded" flags.
        JSONArray tasks = sanitizeTasks(J.get(raw, "tasks"), true);
        if (tasks != null) J.put(note, "tasks", tasks);
        return note;
    }

    // ---------------------------------------------------------- settings ---

    static Double cleanScale(Object v) {
        if (!J.isNum(v)) return null;
        double d = ((Number) v).doubleValue();
        for (double s : SCALES) if (s == d) return s;
        return null;
    }

    static Integer cleanMinutes(String key, Object v) {
        if (!J.isNum(v)) return null;
        int[] lim = "focusMin".equals(key) ? FOCUS_LIMITS : BREAK_LIMITS;
        long r = Math.round(((Number) v).doubleValue());
        return (int) Math.min(lim[1], Math.max(lim[0], r));
    }

    static Integer cleanHour(Object v) {
        if (!J.isNum(v)) return null;
        return (int) Math.min(23, Math.max(0, Math.round(((Number) v).doubleValue())));
    }

    static String cleanNewNoteMode(Object v) {
        return v != null && MODES.contains(v) ? (String) v : null;
    }

    static String cleanNewNoteColor(Object v) {
        return "rotate".equals(v) || (v != null && COLORS.contains(v)) ? (String) v : null;
    }

    static JSONObject defaultSettings() {
        return J.obj(
                "alwaysOnTop", true,
                "openAtLogin", false,
                "reminders", true,
                "ticker", true,
                "scale", 1,
                "animations", true,
                "startCollapsed", false,
                "newNoteColor", "rotate",
                "notifySound", true,
                "newNoteMode", "daily",
                "reminderHour", 9,
                "pomodoroAutoFocus", false,
                "pomodoroNotify", true,
                "pomodoroLengths", J.obj("focusMin", FOCUS_DEFAULT, "breakMin", BREAK_DEFAULT),
                "colorCursor", 0,
                "launcherBounds", null,
                "timerBounds", null,
                "aboutBounds", null,
                "managerBounds", null,
                "settingsBounds", null,
                "pomodoro", J.obj("date", null, "count", 0));
    }

    private static final String[] BOOL_SETTINGS = {
            "alwaysOnTop", "openAtLogin", "reminders", "ticker", "animations", "startCollapsed",
            "notifySound", "pomodoroAutoFocus", "pomodoroNotify"};
    private static final String[] BOUNDS_SETTINGS = {
            "launcherBounds", "timerBounds", "aboutBounds", "managerBounds", "settingsBounds"};

    static JSONObject normalizeSettings(Object v) {
        JSONObject d = defaultSettings();
        if (!(v instanceof JSONObject)) return d;
        JSONObject raw = (JSONObject) v;
        for (String k : BOOL_SETTINGS) {
            if (J.get(raw, k) instanceof Boolean) J.put(d, k, J.get(raw, k));
        }
        Double scale = cleanScale(J.get(raw, "scale"));
        if (scale != null) J.put(d, "scale", scale);
        String color = cleanNewNoteColor(J.get(raw, "newNoteColor"));
        if (color != null) J.put(d, "newNoteColor", color);
        String mode = cleanNewNoteMode(J.get(raw, "newNoteMode"));
        if (mode != null) J.put(d, "newNoteMode", mode);
        Integer hour = cleanHour(J.get(raw, "reminderHour"));
        if (hour != null) J.put(d, "reminderHour", hour);
        JSONObject lengths = raw.optJSONObject("pomodoroLengths");
        if (lengths != null) {
            Integer f = cleanMinutes("focusMin", J.get(lengths, "focusMin"));
            Integer b = cleanMinutes("breakMin", J.get(lengths, "breakMin"));
            J.put(d, "pomodoroLengths", J.obj("focusMin", f != null ? f : FOCUS_DEFAULT, "breakMin", b != null ? b : BREAK_DEFAULT));
        }
        Object cursor = J.get(raw, "colorCursor");
        if (J.isInt(cursor) && ((Number) cursor).intValue() >= 0) {
            J.put(d, "colorCursor", ((Number) cursor).intValue() % COLORS.size());
        }
        for (String k : BOUNDS_SETTINGS) J.put(d, k, sanitizeBounds(J.get(raw, k)));
        JSONObject p = raw.optJSONObject("pomodoro");
        if (p != null && isValidDateKey(J.get(p, "date")) && J.isInt(J.get(p, "count")) && p.optInt("count") >= 0) {
            J.put(d, "pomodoro", J.obj("date", J.get(p, "date"), "count", p.optInt("count")));
        }
        return d;
    }

    static JSONObject emptyData() {
        return J.obj("version", SCHEMA_VERSION, "settings", defaultSettings(), "notes", new JSONArray());
    }

    static JSONObject normalizeData(Object v) {
        if (!(v instanceof JSONObject)) return emptyData();
        JSONObject raw = (JSONObject) v;
        Set<String> seen = new HashSet<>();
        JSONArray notes = new JSONArray();
        JSONArray list = raw.optJSONArray("notes");
        if (list != null) {
            for (int i = 0; i < list.length(); i++) {
                JSONObject note = normalizeNote(J.at(list, i));
                if (note != null && seen.add(note.optString("id"))) notes.put(note);
            }
        }
        return J.obj("version", SCHEMA_VERSION, "settings", normalizeSettings(J.get(raw, "settings")), "notes", notes);
    }
}
