package com.nova.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nova.companion.CompanionPermissionState
import com.nova.companion.CompanionPermissionsManager

/**
 * Renders each companion capability as its own toggle — no "allow
 * everything" switch, per docs/20-devices/android-companion.md's
 * permission model. Toggling one permission never touches another's
 * state, matching CompanionPermissionsManager's per-key grant/revoke.
 *
 * Actually requesting the underlying Android runtime permission
 * (notification listener access, RECORD_AUDIO, CAMERA, SAF folder
 * picker) is the caller's responsibility via the platform permission
 * APIs; this screen only reflects and drives the companion-level
 * capability state once that platform grant exists.
 */
@Composable
fun PermissionsScreen(permissionsManager: CompanionPermissionsManager) {
    var snapshot by remember { mutableStateOf(permissionsManager.snapshot()) }

    Column(modifier = Modifier.padding(16.dp)) {
        Text("Companion capabilities")
        snapshot.forEach { (capability, state) ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(capability)
                Switch(
                    checked = state == CompanionPermissionState.GRANTED,
                    onCheckedChange = { checked ->
                        if (checked) permissionsManager.grant(capability)
                        else permissionsManager.revoke(capability)
                        snapshot = permissionsManager.snapshot()
                    },
                )
            }
        }
    }
}
