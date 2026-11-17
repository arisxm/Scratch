package com.stickynotes.android;

import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.Dialog;
import android.app.TimePickerDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.text.format.DateFormat;
import android.view.ContextThemeWrapper;
import android.view.WindowManager;

import java.util.Calendar;
import java.util.function.Consumer;

/**
 * Dialogs shown from the service, over other apps: the desktop app's message
 * boxes and menus, and the date/time pickers a floating note can't open by
 * itself. Each is an overlay window (the app holds "display over other apps").
 */
final class Dialogs {
    private Dialogs() {}

    static Context themed(Context c) {
        return new ContextThemeWrapper(c, android.R.style.Theme_DeviceDefault_Light_Dialog_Alert);
    }

    /**
     * Show a dialog as a window over other apps. Without the permission it
     * can't appear: then `onFail` answers the caller instead of a crash.
     */
    static void show(Dialog d, Runnable onFail) {
        if (d.getWindow() != null) d.getWindow().setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
        try {
            d.show();
        } catch (RuntimeException e) {
            android.util.Log.e("ScratchDialogs", "could not show a dialog", e);
            if (onFail != null) onFail.run();
        }
    }

    /** A yes/no question. `answer` is called exactly once. */
    static void confirm(Context c, String title, String message, String yes, Consumer<Boolean> answer) {
        final boolean[] answered = {false};
        Consumer<Boolean> once = (v) -> {
            if (answered[0]) return;
            answered[0] = true;
            answer.accept(v);
        };
        AlertDialog d = new AlertDialog.Builder(themed(c))
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(yes, (di, w) -> once.accept(true))
                .setNegativeButton("Cancel", (di, w) -> once.accept(false))
                .setOnDismissListener(di -> once.accept(false))
                .create();
        show(d, () -> once.accept(false));
    }

    static void message(Context c, String title, String message) {
        AlertDialog d = new AlertDialog.Builder(themed(c)).setTitle(title).setMessage(message).setPositiveButton("OK", null).create();
        show(d, null);
    }

    /** A list of choices, like a desktop context menu. */
    static void menu(Context c, String title, String[] items, Consumer<Integer> picked) {
        AlertDialog d = new AlertDialog.Builder(themed(c))
                .setTitle(title)
                .setItems(items, (di, which) -> picked.accept(which))
                .create();
        show(d, null);
    }

    /**
     * A date, month or time picker for an <input> in a floating page. Answers
     * the new value, "" for Clear, or null if the user backed out.
     */
    static void pick(Context c, String type, String value, Consumer<String> answer) {
        final boolean[] answered = {false};
        Consumer<String> once = (v) -> {
            if (answered[0]) return;
            answered[0] = true;
            answer.accept(v);
        };
        Calendar now = Calendar.getInstance();
        Context t = themed(c);
        Dialog dialog;
        if ("time".equals(type)) {
            int h = now.get(Calendar.HOUR_OF_DAY), m = 0;
            if (value != null && value.matches("\\d{2}:\\d{2}")) {
                h = Integer.parseInt(value.substring(0, 2));
                m = Integer.parseInt(value.substring(3, 5));
            }
            TimePickerDialog d = new TimePickerDialog(t,
                    (view, hour, minute) -> once.accept(Schema.pad2(hour) + ":" + Schema.pad2(minute)),
                    h, m, DateFormat.is24HourFormat(c));
            d.setButton(DialogInterface.BUTTON_NEUTRAL, "Clear", (di, w) -> once.accept(""));
            dialog = d;
        } else {
            int y = now.get(Calendar.YEAR), mo = now.get(Calendar.MONTH), day = now.get(Calendar.DAY_OF_MONTH);
            if (value != null && value.matches("\\d{4}-\\d{2}(-\\d{2})?")) {
                y = Integer.parseInt(value.substring(0, 4));
                mo = Integer.parseInt(value.substring(5, 7)) - 1;
                if (value.length() == 10) day = Integer.parseInt(value.substring(8, 10));
                else day = 1;
            }
            boolean month = "month".equals(type);
            DatePickerDialog d = new DatePickerDialog(t, (view, year, monthOfYear, dayOfMonth) -> {
                String ym = year + "-" + Schema.pad2(monthOfYear + 1);
                once.accept(month ? ym : ym + "-" + Schema.pad2(dayOfMonth));
            }, y, mo, day);
            if (month) d.setTitle("Pick any day in the month");
            else d.setButton(DialogInterface.BUTTON_NEUTRAL, "Clear", (di, w) -> once.accept(""));
            dialog = d;
        }
        dialog.setOnDismissListener(di -> once.accept(null));
        show(dialog, () -> once.accept(null));
    }
}
