package com.nova.companion

import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.nova.companion.ui.PairingScreen
import com.nova.companion.ui.PermissionsScreen

class MainActivity : ComponentActivity() {

    private val pairingManager = PairingManager()
    private val pairingTransport = PairingTransport(pairingManager)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Settings.Secure.ANDROID_ID is stable per app-install per device — good enough as this
        // companion's device_id for pairing/sync/commands; it is not a durable cross-reinstall
        // identity and isn't used as one anywhere in this transport.
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unpaired"
        val permissionsManager = CompanionPermissionsManager(deviceId = deviceId)

        setContent {
            MaterialTheme {
                Surface {
                    val navController = rememberNavController()
                    NavHost(navController = navController, startDestination = "pairing") {
                        composable("pairing") {
                            PairingScreen(
                                pairingManager = pairingManager,
                                pairingTransport = pairingTransport,
                                thisDeviceId = deviceId,
                                onPaired = { session ->
                                    CompanionSessionHolder.set(session)
                                    navController.navigate("permissions")
                                },
                            )
                        }
                        composable("permissions") {
                            PermissionsScreen(permissionsManager = permissionsManager)
                        }
                    }
                }
            }
        }
    }
}
