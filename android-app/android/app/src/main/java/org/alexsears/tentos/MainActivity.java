package org.alexsears.tentos;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;

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
                boolean trustedOrigin = origin != null
                        && "https".equals(origin.getScheme())
                        && "tentos.alexsears.org".equals(origin.getHost());
                boolean onlyAudio = request.getResources().length == 1
                        && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(request.getResources()[0]);
                if (trustedOrigin && onlyAudio) {
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
}
