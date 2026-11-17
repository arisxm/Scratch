package com.stickynotes.android;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Serves the one picture copied from a notepad (Copy in the select tool), so
 * other apps can paste it. Read-only, and only that one file.
 */
public final class ImageProvider extends ContentProvider {
    static final String AUTHORITY = "com.stickynotes.android.images";
    private static final String NAME = "drawing.png";

    static Uri put(Context context, byte[] png) throws IOException {
        File dir = new File(context.getCacheDir(), "clipboard");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("no cache folder");
        try (FileOutputStream out = new FileOutputStream(new File(dir, NAME))) {
            out.write(png);
        }
        return Uri.parse("content://" + AUTHORITY + "/" + NAME + "?t=" + System.currentTimeMillis());
    }

    private File file() {
        return new File(new File(getContext().getCacheDir(), "clipboard"), NAME);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!NAME.equals(uri.getLastPathSegment()) || !"r".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(file(), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "image/png";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        MatrixCursor c = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[] {NAME, file().length()});
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
