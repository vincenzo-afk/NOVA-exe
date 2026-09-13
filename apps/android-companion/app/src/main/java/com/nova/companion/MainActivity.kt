package com.nova.companion

import android.os.Bundle
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

    private val permissionsManager = CompanionPermissionsManager(deviceId = "unpaired")
    private val pairingManager = PairingManager()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface {
                    val navController = rememberNavController()
                    NavHost(navController = navController, startDestination = "pairing") {
                        composable("pairing") {
                            PairingScreen(
                                pairingManager = pairingManager,
                                onPaired = { navController.navigate("permissions") },
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
