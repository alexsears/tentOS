package org.alexsears.tentos;

import android.webkit.PermissionRequest;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class MainActivityTest {
    private static final String[] AUDIO = {PermissionRequest.RESOURCE_AUDIO_CAPTURE};

    @Test
    public void trustsAudioFromConfiguredServerOrigin() {
        assertTrue(MainActivity.isTrustedAudioRequest(
                "https://grow.example.org/", "https://grow.example.org/tentos", AUDIO));
        assertTrue(MainActivity.isTrustedAudioRequest(
                "http://homeassistant.local:8109/", "http://homeassistant.local:8109", AUDIO));
    }

    @Test
    public void rejectsDifferentOriginOrPermission() {
        assertFalse(MainActivity.isTrustedAudioRequest(
                "https://tentos.alexsears.org/", "https://grow.example.org", AUDIO));
        assertFalse(MainActivity.isTrustedAudioRequest(
                "https://grow.example.org/", "https://grow.example.org", new String[] {"video"}));
        assertFalse(MainActivity.isTrustedAudioRequest(
                "https://grow.example.org:444/", "https://grow.example.org", AUDIO));
    }
}
