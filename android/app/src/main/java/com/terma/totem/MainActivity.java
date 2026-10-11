package com.terma.totem;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "TERMA_MainActivity";
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Mantener la pantalla encendida permanentemente mientras TERMA esté en primer plano
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Habilitar depuración remota de WebView mediante chrome://inspect
        WebView.setWebContentsDebuggingEnabled(true);

        // Forzar a Android a rutear las conexiones por Wi-Fi aunque no tenga Internet
        bindProcessToWifi();
    }

    @Override
    public void onStart() {
        super.onStart();
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                WebSettings settings = webView.getSettings();
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                settings.setDomStorageEnabled(true);
                settings.setJavaScriptEnabled(true);
                settings.setAllowContentAccess(true);
                settings.setAllowFileAccess(true);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error configurando WebSettings", e);
        }
    }

    private void bindProcessToWifi() {
        try {
            final ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;

            NetworkRequest request = new NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .build();

            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    try {
                        cm.bindProcessToNetwork(network);
                        Log.i(TAG, "Proceso enlazado exitosamente a la interfaz Wi-Fi (TERMA)");
                    } catch (Exception e) {
                        Log.e(TAG, "Error enlazando proceso a Wi-Fi", e);
                    }
                }

                @Override
                public void onLost(Network network) {
                    try {
                        cm.bindProcessToNetwork(null);
                        Log.i(TAG, "Enlace de proceso a Wi-Fi liberado");
                    } catch (Exception e) {
                        Log.e(TAG, "Error liberando enlace de Wi-Fi", e);
                    }
                }
            };

            cm.registerNetworkCallback(request, networkCallback);
        } catch (Exception e) {
            Log.e(TAG, "Error registrando NetworkCallback para Wi-Fi", e);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (networkCallback != null) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    cm.unregisterNetworkCallback(networkCallback);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error desregistrando NetworkCallback", e);
            }
        }
    }
}
