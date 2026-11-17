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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * Notepads (drawing pads): a port of electron/notepad.js. notepads.json lists
 * them; each drawing is a PNG in notepads/. Everything is written atomically
 * (tmp file + rename), one write after another, on a background thread.
 */
final class NotepadStore {
    private static final String TAG = "ScratchNotepads";
    static final List<String> PAPERS = Arrays.asList("lined", "grid", "dotted", "plain");
    static final int MAX_PNG_BYTES = 64 * 1024 * 1024;
    static final int PAGE_MIN = 100, PAGE_MAX = 12000;
    static final int TITLE_MAX = 80;
    private static final Pattern ID_RE = Pattern.compile("^[A-Za-z0-9-]{1,64}$");
    private static final byte[] PNG_SIGNATURE = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};

    final File dir, indexFile, imageDir;
    final List<JSONObject> pads = new ArrayList<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Runnable saveTask = this::saveIndex;

    NotepadStore(File dir) {
        this.dir = dir;
        this.indexFile = new File(dir, "notepads.json");
        this.imageDir = new File(dir, "notepads");
    }

    // ----------------------------------------------------------- cleaning ---

    static Integer cleanPageSide(Object v) {
        if (!J.isNum(v)) return null;
        return (int) Math.round(Math.min(PAGE_MAX, Math.max(PAGE_MIN, ((Number) v).doubleValue())));
    }

    static String cleanTitle(Object v) {
        if (!(v instanceof String)) return null;
        String t = ((String) v).replaceAll("[\\r\\n\\t]+", " ");
        return t.length() > TITLE_MAX ? t.substring(0, TITLE_MAX) : t;
    }

    static JSONObject cleanPad(JSONObject raw) {
        if (raw == null) return null;
        Object idRaw = J.get(raw, "id");
        if (!(idRaw instanceof String) || !ID_RE.matcher((String) idRaw).matches()) return null;
        long now = System.currentTimeMillis();
        boolean hidden = J.bool(raw, "hidden");
        Object hiddenAt = J.get(raw, "hiddenAt");
        String title = cleanTitle(J.get(raw, "title"));
        Object paper = J.get(raw, "paper");
        Integer w = cleanPageSide(J.get(raw, "width"));
        Integer h = cleanPageSide(J.get(raw, "height"));
        Object createdAt = J.get(raw, "createdAt"), updatedAt = J.get(raw, "updatedAt");
        return J.obj(
                "id", idRaw,
                "title", title != null ? title : "",
                "paper", paper != null && PAPERS.contains(paper) ? paper : "lined",
                "width", w != null ? w : 0,
                "height", h != null ? h : 0,
                "bounds", Schema.sanitizeBounds(J.get(raw, "bounds")),
                "hidden", hidden,
                "hiddenAt", hidden ? (J.isNum(hiddenAt) ? hiddenAt : now) : null,
                "createdAt", J.isNum(createdAt) ? createdAt : now,
                "updatedAt", J.isNum(updatedAt) ? updatedAt : now);
    }

    static boolean isPng(byte[] data) {
        if (data == null || data.length < PNG_SIGNATURE.length || data.length > MAX_PNG_BYTES) return false;
        for (int i = 0; i < PNG_SIGNATURE.length; i++) if (data[i] != PNG_SIGNATURE[i]) return false;
        return true;
    }

    // -------------------------------------------------------------- load ---

    void load() {
        pads.clear();
        if (!indexFile.exists()) return;
        try {
            String text = new String(Files.readAllBytes(indexFile.toPath()), StandardCharsets.UTF_8);
            JSONObject raw = J.parseObject(text);
            JSONArray list = raw == null ? null : raw.optJSONArray("notepads");
            if (list == null) return;
            Set<String> seen = new HashSet<>();
            for (int i = 0; i < list.length(); i++) {
                JSONObject pad = cleanPad(list.optJSONObject(i));
                if (pad != null && seen.add(pad.optString("id"))) pads.add(pad);
            }
        } catch (IOException e) {
            Log.w(TAG, "could not read notepads", e);
        }
    }

    JSONObject get(String id) {
        if (id == null) return null;
        for (JSONObject p : pads) if (id.equals(p.optString("id"))) return p;
        return null;
    }

    JSONObject create() {
        JSONObject pad = cleanPad(J.obj("id", UUID.randomUUID().toString()));
        pads.add(pad);
        save();
        return pad;
    }

    File imageFile(String id) {
        if (!ID_RE.matcher(id).matches()) throw new IllegalArgumentException("bad notepad id");
        return new File(imageDir, id + ".png");
    }

    /** A notepad's saved drawing, or null. */
    byte[] readImage(String id) {
        if (get(id) == null) return null;
        try {
            File f = imageFile(id);
            if (!f.exists()) return null;
            byte[] data = Files.readAllBytes(f.toPath());
            return isPng(data) ? data : null;
        } catch (IOException e) {
            return null;
        }
    }

    // -------------------------------------------------------------- save ---

    private String indexJson() {
        JSONArray list = new JSONArray();
        for (JSONObject p : pads) list.put(p);
        JSONObject o = J.obj("version", 1, "notepads", list);
        try {
            return o.toString(2);
        } catch (Exception e) {
            return o.toString();
        }
    }

    /** Write the list soon (several changes in a row become one write). */
    void save() {
        main.removeCallbacks(saveTask);
        main.postDelayed(saveTask, 300);
    }

    private void saveIndex() {
        final String contents = indexJson();
        io.execute(() -> {
            try {
                writeAtomic(indexFile, contents.getBytes(StandardCharsets.UTF_8));
            } catch (IOException e) {
                Log.e(TAG, "could not save notepads", e);
            }
        });
    }

    /** Synchronous write, for stopping. */
    void saveIndexSync() {
        main.removeCallbacks(saveTask);
        try {
            writeAtomic(indexFile, indexJson().getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Log.e(TAG, "could not save notepads", e);
        }
    }

    /** Save a drawing sent by the Notepad page. Calls back on the main thread with true if it was valid and written. */
    void saveDrawing(String id, byte[] png, Object width, Object height, Object paper, Consumer<Boolean> done) {
        JSONObject pad = get(id);
        if (pad == null || !isPng(png)) {
            done.accept(false);
            return;
        }
        Integer w = cleanPageSide(width), h = cleanPageSide(height);
        if (w != null) J.put(pad, "width", w);
        if (h != null) J.put(pad, "height", h);
        if (paper != null && PAPERS.contains(paper)) J.put(pad, "paper", paper);
        J.put(pad, "updatedAt", System.currentTimeMillis());
        final File file = imageFile(id);
        final byte[] index = indexJson().getBytes(StandardCharsets.UTF_8);
        io.execute(() -> {
            boolean ok;
            try {
                writeAtomic(file, png);
                writeAtomic(indexFile, index);
                ok = true;
            } catch (IOException e) {
                Log.e(TAG, "could not save drawing", e);
                ok = false;
            }
            final boolean result = ok;
            main.post(() -> done.accept(result));
        });
    }

    boolean rename(String id, Object title) {
        JSONObject pad = get(id);
        String clean = cleanTitle(title);
        if (pad == null || clean == null || clean.equals(pad.optString("title"))) return false;
        J.put(pad, "title", clean);
        J.put(pad, "updatedAt", System.currentTimeMillis());
        save();
        return true;
    }

    void setHidden(JSONObject pad, boolean hidden) {
        J.put(pad, "hidden", hidden);
        J.put(pad, "hiddenAt", hidden ? System.currentTimeMillis() : null);
        save();
    }

    void remove(String id) {
        JSONObject pad = get(id);
        if (pad == null) return;
        pads.remove(pad);
        final File file = imageFile(id);
        final byte[] index = indexJson().getBytes(StandardCharsets.UTF_8);
        io.execute(() -> {
            try {
                Files.deleteIfExists(file.toPath());
                writeAtomic(indexFile, index);
            } catch (IOException e) {
                Log.e(TAG, "could not delete notepad", e);
            }
        });
    }

    private void writeAtomic(File target, byte[] contents) throws IOException {
        File parent = target.getParentFile();
        if (parent != null) parent.mkdirs();
        File tmp = new File(target.getPath() + "." + System.nanoTime() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(contents);
            out.getFD().sync();
        }
        Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }
}
