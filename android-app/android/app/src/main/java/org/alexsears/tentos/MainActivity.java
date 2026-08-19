package org.alexsears.tentos;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;

import java.net.URI;
import java.net.URISyntaxException;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                Uri origin = request.getOrigin();
                if (isTrustedAudioRequest(
                        origin == null ? null : origin.toString(),
                        getBridge().getServerUrl(),
                        request.getResources())) {
                    // Preserve Capacitor's Android runtime-permission request,
                    // but only for audio requested by the hosted TentOS origin.
                    super.onPermissionRequest(request);
                } else {
                    request.deny();
                }
            }
        });

        getBridge().getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }

    static boolean isTrustedAudioRequest(String origin, String serverUrl, String[] resources) {
        if (origin == null || serverUrl == null || resources == null || resources.length != 1
                || !PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resources[0])) {
            return false;
        }
        try {
            URI requestOrigin = new URI(origin);
            URI configuredServer = new URI(serverUrl);
            return requestOrigin.getScheme() != null
                    && requestOrigin.getScheme().equalsIgnoreCase(configuredServer.getScheme())
                    && requestOrigin.getHost() != null
                    && requestOrigin.getHost().equalsIgnoreCase(configuredServer.getHost())
                    && effectivePort(requestOrigin) == effectivePort(configuredServer);
        } catch (URISyntaxException error) {
            return false;
        }
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) {
            return uri.getPort();
        }
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }
}
