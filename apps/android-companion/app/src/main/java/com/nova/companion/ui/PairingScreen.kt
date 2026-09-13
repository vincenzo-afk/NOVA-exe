package com.nova.companion.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nova.companion.PairingManager

/**
 * Pairing entry point (docs/28-multi-device-protocol/02-device-pairing-protocol.md).
 * Defaults to a live [CameraQrScanner]; "Enter code manually instead"
 * falls back to pasted QR payload text. Both paths converge on the same
 * `pairingManager.parseQrPayload` call below, so the verification logic
 * doesn't care which one produced the raw string.
 */
@Composable
fun PairingScreen(pairingManager: PairingManager, onPaired: () -> Unit) {
    var qrText by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    var useCameraScan by remember { mutableStateOf(true) }

    fun handleDecodedPayload(raw: String) {
        val payload = pairingManager.parseQrPayload(raw.trim())
        if (payload == null) {
            status = "That doesn't look like a valid NOVA pairing code."
            return
        }
        // The real challenge/response exchange happens over the
        // short-lived local channel named in the QR payload
        // (docs/28-multi-device-protocol/05-networking-and-discovery.md);
        // wiring that transport is outside this UI layer's scope. This
        // call is left for the transport integration to invoke once it
        // has the desktop's signed response in hand.
        status = "Payload parsed for code '${payload.pairingCode}'. Waiting for transport handshake."
    }

    Column(modifier = Modifier.padding(16.dp)) {
        Text("Pair with a NOVA desktop")
        Text("Scan the QR code shown on the desktop app.")

        if (useCameraScan) {
            CameraQrScanner(onDecoded = ::handleDecodedPayload)
            TextButton(onClick = { useCameraScan = false }) {
                Text("Enter code manually instead")
            }
        } else {
            TextField(
                value = qrText,
                onValueChange = { qrText = it },
                modifier = Modifier.padding(vertical = 12.dp),
            )
            Button(onClick = { handleDecodedPayload(qrText) }) {
                Text("Pair")
            }
            TextButton(onClick = { useCameraScan = true }) {
                Text("Scan with camera instead")
            }
        }

        status?.let { Text(it, modifier = Modifier.padding(top = 12.dp)) }
    }
}
