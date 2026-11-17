package com.stickynotes.android;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.File;

/** "Open when I sign in" (Settings): start Scratch when the phone starts. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (!Settings.canDrawOverlays(context)) return;
        Store store = new Store(new File(context.getFilesDir(), "sticky-notes.json"));
        JSONObject data = store.load();
        if (!J.bool(data.optJSONObject("settings"), "openAtLogin")) return;
        context.startForegroundService(new Intent(context, ScratchService.class));
    }
}
