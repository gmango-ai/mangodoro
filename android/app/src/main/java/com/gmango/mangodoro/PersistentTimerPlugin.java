package com.gmango.mangodoro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Posts an ongoing notification with a live countdown chronometer so the
 * active pomodoro phase remains visible on the lockscreen / notification
 * shade while the WebView is suspended.
 *
 * The OS itself drives the per-second countdown via the Chronometer view
 * baked into the notification ({@code setUsesChronometer + setChronometerCountDown}),
 * so once we post the end time the JS layer doesn't need to push tick
 * updates.
 */
@CapacitorPlugin(name = "PersistentTimer")
public class PersistentTimerPlugin extends Plugin {

    private static final String CHANNEL_ID = "mangodoro_active_timer";
    private static final String CHANNEL_NAME = "Active pomodoro";
    private static final String CHANNEL_DESC =
        "Shows your running pomodoro timer on the lockscreen.";
    private static final int NOTIF_ID = 4242;

    @Override
    public void load() {
        ensureChannel();
    }

    @PluginMethod
    public void start(PluginCall call) {
        long endsAtMs = call.getLong("endsAtMs", 0L);
        String label = call.getString("label", "Pomodoro");
        boolean isSynced = call.getBoolean("isSynced", false);
        if (endsAtMs <= System.currentTimeMillis()) {
            cancel();
            call.resolve();
            return;
        }
        post(endsAtMs, label, isSynced);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        // Update == re-post with the same NOTIF_ID. setOnlyAlertOnce
        // keeps it silent on update so phase transitions don't ping.
        start(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        cancel();
        call.resolve();
    }

    private void post(long endsAtMs, String label, boolean isSynced) {
        Context ctx = getContext();
        ensureChannel();

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // Carries the routing hint that MainActivity reads on warm-resume.
        open.putExtra("route", "/pomodoro");
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(ctx, 0, open, piFlags);

        String subtitle = isSynced ? "Sync session in progress" : "Tap to open Mangodoro";

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(label)
            .setContentText(subtitle)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setWhen(endsAtMs)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(contentIntent);

        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        try {
            nm.notify(NOTIF_ID, b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS denied on Android 13+. The local-notifications
            // plugin requests the permission at app launch, so this branch is
            // only hit when the user revokes it — fail silently.
        }
    }

    private void cancel() {
        NotificationManagerCompat.from(getContext()).cancel(NOTIF_ID);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
        if (existing != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(CHANNEL_DESC);
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }
}
