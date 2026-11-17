package com.stickynotes.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Deadline reminders: a port of electron/reminders.js. */
final class Reminders {
    private Reminders() {}

    static final long LATE_AFTER_MS = 5 * 60_000; // beyond this, word it as overdue rather than due now

    static final class Due {
        final JSONObject note, task;
        final boolean late;

        Due(JSONObject note, JSONObject task, boolean late) {
            this.note = note;
            this.task = task;
            this.late = late;
        }
    }

    /** Local time (ms) at which a deadline should remind. */
    static long reminderTime(String deadline, int dateOnlyHour) {
        int y = Integer.parseInt(deadline.substring(0, 4));
        int m = Integer.parseInt(deadline.substring(5, 7));
        int d = Integer.parseInt(deadline.substring(8, 10));
        int hh = dateOnlyHour, mm = 0;
        if (deadline.length() > 10) {
            hh = Integer.parseInt(deadline.substring(11, 13));
            mm = Integer.parseInt(deadline.substring(14, 16));
        }
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(y, m - 1, d, hh, mm, 0);
        return c.getTimeInMillis();
    }

    /** Tasks whose reminder time has arrived and that haven't reminded yet. Completed tasks never remind. */
    static List<Due> due(JSONArray notes, long now, int dateOnlyHour) {
        List<Due> out = new ArrayList<>();
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.optJSONObject(i);
            JSONArray tasks = note == null ? null : note.optJSONArray("tasks");
            if (tasks == null) continue;
            for (int k = 0; k < tasks.length(); k++) {
                JSONObject t = tasks.optJSONObject(k);
                String deadline = J.str(t, "deadline", null);
                if (t == null || J.bool(t, "done") || deadline == null || J.bool(t, "reminded")) continue;
                long at = reminderTime(deadline, dateOnlyHour);
                if (at <= now) out.add(new Due(note, t, now - at > LATE_AFTER_MS));
            }
        }
        return out;
    }

    /** The next time (ms) any open deadline will remind, or 0 if none. Used to set an alarm. */
    static long next(JSONArray notes, long now, int dateOnlyHour) {
        long best = 0;
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.optJSONObject(i);
            JSONArray tasks = note == null ? null : note.optJSONArray("tasks");
            if (tasks == null) continue;
            for (int k = 0; k < tasks.length(); k++) {
                JSONObject t = tasks.optJSONObject(k);
                String deadline = J.str(t, "deadline", null);
                if (t == null || J.bool(t, "done") || deadline == null || J.bool(t, "reminded")) continue;
                long at = reminderTime(deadline, dateOnlyHour);
                if (at > now && (best == 0 || at < best)) best = at;
            }
        }
        return best;
    }

    /** Keep each task's "reminded" flag only if its deadline is unchanged, so moving a deadline re-arms it. */
    static void carryReminded(JSONArray previous, JSONArray next) {
        Map<String, JSONObject> prev = new HashMap<>();
        for (int i = 0; previous != null && i < previous.length(); i++) {
            JSONObject t = previous.optJSONObject(i);
            if (t != null) prev.put(t.optString("id"), t);
        }
        for (int i = 0; i < next.length(); i++) {
            JSONObject t = next.optJSONObject(i);
            JSONObject old = prev.get(t.optString("id"));
            boolean keep = old != null && J.bool(old, "reminded")
                    && String.valueOf(J.get(old, "deadline")).equals(String.valueOf(J.get(t, "deadline")));
            J.put(t, "reminded", keep);
        }
    }
}
