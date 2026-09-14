package com.nova.companion.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nova.companion.PairingManager
import com.nova.companion.PairingSession
import com.nova.companion.PairingTransport
import com.nova.companion.PairingTransportOutcome
import kotlinx.coroutines.launch

/**
 * Pairing entry point (docs/28-multi-device-protocol/02-device-pairing-protocol.md).
 * Defaults to a live [CameraQrScanner]; "Enter code manually instead"
 * falls back to pasted QR payload text. Both paths converge on
 * [PairingTransport.pairFromQr], which runs the full challenge/
 * response exchange against the desktop over the network — this
 * screen no longer just parses the payload and stops (as it did
 * before `PairingTransport` existed); it drives pairing to
 * completion and hands the resulting session up to [onPaired].
 */
@Composable
fun PairingScreen(
    pairingManager: PairingManager,
    pairingTransport: PairingTransport,
    thisDeviceId: String,
    onPaired: (PairingSession) -> Unit,
) {
    var qrText by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    var useCameraScan by remember { mutableStateOf(true) }
    var isPairing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun handleDecodedPayload(raw: String) {
        if (isPairing) return
        val trimmed = raw.trim()
        // Parse locally first purely to fail fast on an obviously malformed
        // payload before spending a network round trip — the real trust
        // decision still happens entirely inside pairingTransport below.
        if (pairingManager.parseQrPayload(trimmed) == null) {
            status = "That doesn't look like a valid NOVA pairing code."
            return
        }
        isPairing = true
        status = "Connecting to desktop…"
        scope.launch {
            when (val outcome = pairingTransport.pairFromQr(trimmed, thisDeviceId)) {
                is PairingTransportOutcome.Success -> {
                    status = "Paired."
                    onPaired(outcome.session)
                }
                is PairingTransportOutcome.Failure -> {
                    status = outcome.reason
                }
            }
            isPairing = false
        }
    }

    Column(modifier = Modifier.padding(16.dp)) {
        Text("Pair with a NOVA desktop")
        Text("Scan the QR code shown on the desktop app.")

        if (useCameraScan) {
            CameraQrScanner(onDecoded = ::handleDecodedPayload)
            TextButton(onClick = { useCameraScan = false }, enabled = !isPairing) {
                Text("Enter code manually instead")
            }
        } else {
            TextField(
                value = qrText,
                onValueChange = { qrText = it },
                modifier = Modifier.padding(vertical = 12.dp),
                enabled = !isPairing,
            )
            Button(onClick = { handleDecodedPayload(qrText) }, enabled = !isPairing) {
                Text("Pair")
            }
            TextButton(onClick = { useCameraScan = true }, enabled = !isPairing) {
                Text("Scan with camera instead")
            }
        }

        if (isPairing) CircularProgressIndicator(modifier = Modifier.padding(top = 12.dp))
        status?.let { Text(it, modifier = Modifier.padding(top = 12.dp)) }
    }
}
