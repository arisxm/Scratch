package com.stickynotes.android;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Notes and settings: one JSON file in the app's private storage, a port of
 * electron/store.js. Durability is the same as on desktop: write to a .tmp
 * file and rename it over the real one, keep the previous file as .bak, fall
 * back to the .bak (and move an unreadable file aside) when loading, and
 * flush synchronously when the app is stopped.
 *
 * All calls happen on the main thread; only the file writing runs on a
 * background thread.
 */
final class Store {
    private static final String TAG = "ScratchStore";
    private static final long DEBOUNCE_MS = 300;

    final File file, tmp, bak;
    JSONObject data = Schema.emptyData();
    boolean isFirstRun = false;
    File loadedFrom = null;
    File unreadableFile = null;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Runnable saveTask = this::saveInBackground;
    private boolean dirty = false;
    private long generation = 0; // each snapshot gets the next number
    private long written = -1; // newest snapshot on disk; an older one is never written over it

    Store(File file) {
        this.file = file;
        this.tmp = new File(file.getPath() + ".tmp");
        this.bak = new File(file.getPath() + ".bak");
    }

    JSONObject load() {
        File dir = file.getParentFile();
        if (dir != null) dir.mkdirs();
        boolean sawUnreadable = false;
        for (File candidate : new File[] {file, bak}) {
            if (!candidate.exists()) continue;
            JSONObject parsed = readJson(candidate);
            if (parsed != null) {
                data = Schema.normalizeData(parsed);
                loadedFrom = candidate;
                if (candidate != file) save(); // rewrite the main file from the backup
                return data;
            }
            Log.w(TAG, "could not read " + candidate);
            sawUnreadable = true;
            if (candidate == file) unreadableFile = quarantine(candidate);
        }
        isFirstRun = !sawUnreadable;
        data = Schema.emptyData();
        loadedFrom = null;
        return data;
    }

    JSONObject settings() {
        return data.optJSONObject("settings");
    }

    JSONArray notes() {
        return data.optJSONArray("notes");
    }

    JSONObject getNote(String id) {
        if (id == null) return null;
        JSONArray notes = notes();
        for (int i = 0; i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (n != null && id.equals(n.optString("id"))) return n;
        }
        return null;
    }

    void addNote(JSONObject note) {
        notes().put(note);
        save();
    }

    void deleteNote(String id) {
        JSONArray notes = notes();
        for (int i = 0; i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (n != null && id.equals(n.optString("id"))) {
                notes.remove(i);
                save();
                return;
            }
        }
    }

    /** Mark data as changed; it is written after a short quiet period. */
    void save() {
        dirty = true;
        main.removeCallbacks(saveTask);
        main.postDelayed(saveTask, DEBOUNCE_MS);
    }

    private void saveInBackground() {
        if (!dirty) return;
        dirty = false;
        final String contents = serialize();
        final long gen = ++generation;
        io.execute(() -> {
            try {
                write(contents, gen);
            } catch (IOException e) {
                Log.e(TAG, "save failed", e);
                main.post(() -> dirty = true); // keep it pending; the next save or flush retries
            }
        });
    }

    /** Write now if anything is pending. Safe to call when the app is stopping. */
    boolean flush() {
        main.removeCallbacks(saveTask);
        if (!dirty) return true;
        dirty = false;
        try {
            write(serialize(), ++generation);
            return true;
        } catch (IOException e) {
            Log.e(TAG, "save failed", e);
            dirty = true;
            return false;
        }
    }

    private String serialize() {
        try {
            return data.toString(2);
        } catch (Exception e) {
            return data.toString();
        }
    }

    private synchronized void write(String contents, long gen) throws IOException {
        if (gen < written) return; // a newer snapshot is already on disk
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(contents.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (file.exists()) {
            try {
                Files.copy(file.toPath(), bak.toPath(), StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException e) {
                Log.w(TAG, "could not refresh backup", e);
            }
        }
        Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        written = gen;
    }

    private static JSONObject readJson(File f) {
        try {
            String text = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
            if (!text.isEmpty() && text.charAt(0) == 0xFEFF) text = text.substring(1); // a byte-order mark
            return J.parseObject(text);
        } catch (IOException e) {
            return null;
        }
    }

    private static File quarantine(File f) {
        File target = new File(f.getPath() + ".unreadable-" + System.currentTimeMillis());
        return f.renameTo(target) ? target : f;
    }
}
