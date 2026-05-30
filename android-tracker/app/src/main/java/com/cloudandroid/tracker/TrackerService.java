package com.cloudandroid.tracker;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.json.JSONObject;
import java.net.URI;

public class TrackerService extends NotificationListenerService {
    private static final String TAG = "TrackerService";
    private WebSocketClient webSocketClient;
    private int notificationCount = 0;
    
    // We assume the redroid container hostname matches the profile ID, e.g., redroid_1 -> 1
    // For simplicity, we can also just fetch it from a system property or hardcode if we pass it dynamically.
    // Let's use a default profile ID for now, or extract from hostname
    private String getProfileId() {
        try {
            String hostname = java.net.InetAddress.getLocalHost().getHostName();
            if (hostname != null && hostname.startsWith("redroid_")) {
                return hostname.replace("redroid_", "");
            }
        } catch (Exception e) {}
        return "1"; // Fallback
    }

    @Override
    public void onCreate() {
        super.onCreate();
        connectWebSocket();
    }

    private void connectWebSocket() {
        try {
            // 10.0.2.2 is the standard loopback for Android emulator to access host localhost.
            // For Docker Redroid, to access the backend container (backend_default network), we might need the IP of the backend.
            // We can use the docker-compose service name "backend" if DNS works, or host IP. Let's try "ws://backend:3001".
            URI uri = new URI("ws://backend:3001");
            webSocketClient = new WebSocketClient(uri) {
                @Override
                public void onOpen(ServerHandshake handshakedata) {
                    Log.i(TAG, "Opened websocket");
                    sendUpdate();
                }

                @Override
                public void onMessage(String message) {}

                @Override
                public void onClose(int code, String reason, boolean remote) {
                    Log.i(TAG, "Closed websocket");
                    // Reconnect logic could go here
                }

                @Override
                public void onError(Exception ex) {
                    Log.e(TAG, "Websocket error", ex);
                }
            };
            webSocketClient.connect();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void sendUpdate() {
        if (webSocketClient != null && webSocketClient.isOpen()) {
            try {
                JSONObject json = new JSONObject();
                json.put("type", "NOTIFICATION");
                json.put("profileId", getProfileId());
                json.put("count", notificationCount);
                webSocketClient.send(json.toString());
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        notificationCount++;
        sendUpdate();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        if (notificationCount > 0) notificationCount--;
        sendUpdate();
    }
}
