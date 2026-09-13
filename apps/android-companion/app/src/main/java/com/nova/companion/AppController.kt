package com.nova.companion

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * App Control capability (docs/20-devices/android-companion.md):
 * "supported apps are driven through Android's Accessibility Service
 * ... or through app-specific Android Intents/deep links where
 * available, in that priority order — direct Intents are preferred
 * over Accessibility-Service simulation wherever an app exposes them,
 * mirroring the desktop execution-priority principle
 * (docs/06-tools/execution-priority.md)."
 *
 * `AppController` is the priority-order policy, independent of the
 * Android service lifecycle; `NovaAccessibilityService` is the actual
 * `AccessibilityService` subclass Android requires for the fallback
 * tier and holds the live root node `AppController` needs for it.
 */

/** One controllable action against a target app, resolved by [AppController.perform]. */
sealed class AppAction {
    /** e.g. open a specific screen/deep link the target app registered. */
    data class OpenDeepLink(val uri: String) : AppAction()
    /** Accessibility-Service-only: find a node by its visible text/content-description and click it. */
    data class ClickByText(val text: String) : AppAction()
}

sealed class AppControlResult {
    data class Performed(val via: String) : AppControlResult()
    data class Failed(val reason: String) : AppControlResult()
}

/**
 * `IntentResolver` is the seam for "does this app expose a direct
 * Intent/deep link for this action" — real resolution
 * (`PackageManager.resolveActivity`) is injected so this class stays
 * unit-testable without an Android runtime, same pattern as every
 * other injected collaborator this session.
 */
fun interface IntentResolver {
    fun resolve(action: AppAction.OpenDeepLink): Intent?
}

class AppController(
    private val permissions: CompanionPermissionsManager,
    private val intentResolver: IntentResolver,
    private val startActivity: (Intent) -> Unit,
    private val accessibilityRootNode: () -> AccessibilityNodeInfo?,
) {
    /**
     * Resolves and performs one action, enforcing execution priority:
     * a direct Intent always wins over Accessibility-Service node
     * simulation when both could satisfy the action.
     */
    fun perform(action: AppAction): AppControlResult {
        val permissionCheck = permissions.use(
            CompanionCapability(CompanionCapabilities.APP_CONTROL, listOf(CompanionCapabilities.APP_CONTROL)),
        )
        if (permissionCheck is CompanionResult.Err) {
            return AppControlResult.Failed(permissionCheck.error.message)
        }

        return when (action) {
            is AppAction.OpenDeepLink -> {
                val intent = intentResolver.resolve(action)
                if (intent != null) {
                    startActivity(intent)
                    AppControlResult.Performed(via = "intent")
                } else {
                    AppControlResult.Failed("No app exposes a direct Intent for '${action.uri}'.")
                }
            }
            is AppAction.ClickByText -> {
                val root = accessibilityRootNode()
                    ?: return AppControlResult.Failed("Accessibility Service has no active window to search.")
                val target = findNodeByText(root, action.text)
                    ?: return AppControlResult.Failed("No visible node matches '${action.text}'.")
                val clicked = target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                if (clicked) AppControlResult.Performed(via = "accessibility_service")
                else AppControlResult.Failed("Node matching '${action.text}' did not accept the click action.")
            }
        }
    }

    private fun findNodeByText(root: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
        if (root.text?.toString() == text || root.contentDescription?.toString() == text) return root
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            findNodeByText(child, text)?.let { return it }
        }
        return null
    }
}

/**
 * Checks whether a target package is even installed, for callers
 * building an [IntentResolver] — resolution itself still goes through
 * `PackageManager.resolveActivity` against a real `Intent`, this is
 * just the "is it worth trying" pre-check.
 */
fun isPackageInstalled(context: Context, packageName: String): Boolean = try {
    context.packageManager.getPackageInfo(packageName, 0)
    true
} catch (_: PackageManager.NameNotFoundException) {
    false
}

/**
 * The Accessibility-Service-tier fallback. Like `NotificationCaptureService`,
 * Android only delivers events here once the user separately grants
 * Accessibility Service access in system settings — declaring the
 * service does not itself enable it, keeping this consistent with
 * `CompanionPermissionsManager`'s individually-revocable model.
 */
class NovaAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Deliberately not accumulating a background event stream here —
        // App Control is a call-and-response action (AppController.perform),
        // not an observer source. rootInActiveWindow below is read on
        // demand at the moment an action is performed.
    }

    override fun onInterrupt() {}

    fun currentRootNode(): AccessibilityNodeInfo? = rootInActiveWindow
}
