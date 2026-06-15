package com.gmango.mangodoro;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PersistentTimerPlugin.class);
        super.onCreate(savedInstanceState);
        handleRoutingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRoutingIntent(intent);
    }

    /**
     * When the ongoing-timer notification is tapped we want the WebView
     * to land on /pomodoro. The bridge serves the SPA from a fixed origin
     * so deep-linking via reload would lose state — instead we postpone
     * until the bridge is up and call window.location.hash via JS.
     */
    private void handleRoutingIntent(Intent intent) {
        if (intent == null) return;
        String route = intent.getStringExtra("route");
        if (route == null || route.isEmpty()) return;
        // The bridge may not be ready on cold-launch; schedule on the
        // decor view so the eval runs after webview attach.
        String js = "window.__pendingRoute = " + jsonString(route) + ";"
            + "if (window.dispatchEvent) {"
            + "  window.dispatchEvent(new CustomEvent('mangodoro:route', { detail: " + jsonString(route) + " }));"
            + "}";
        getWindow().getDecorView().post(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    private static String jsonString(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
        return sb.toString();
    }
}
