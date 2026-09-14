package com.nova.companion

import android.net.Uri
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/**
 * Finishes App Control and File Access as remotely-triggerable
 * capabilities: polls companion-server.ts for commands queued by
 * companion-command-bridge.ts, executes each against the
 * already-real `AppController` / `FileAccessManager` local APIs, and
 * posts the result back so the desktop-side `sendCommand` promise
 * resolves. Nothing about `AppController`/`FileAccessManager`
 * themselves changes — this is the missing remote-dispatch layer on
 * top of them.
 */

class RemoteCommandExecutor(
    private val client: CompanionApiClient,
    private val appController: AppController,
    private val fileAccessManager: FileAccessManager,
) {
    /** Polls once for queued commands and executes each in order. Call this on a periodic loop while the foreground service is active — not a persistent connection, consistent with the "not always-on" model. */
    suspend fun pollAndExecuteOnce(): CompanionResult<Int> {
        val response = client.getJson("/v1/companion/commands/next")
        val body = when (response) {
            is CompanionResult.Err -> return CompanionResult.Err(response.error)
            is CompanionResult.Ok -> JSONObject(response.value)
        }
        val commands = body.optJSONArray("commands") ?: JSONArray()
        for (i in 0 until commands.length()) {
            executeOne(commands.getJSONObject(i))
        }
        return CompanionResult.Ok(commands.length())
    }

    private suspend fun executeOne(commandJson: JSONObject) {
        val commandId = commandJson.optString("command_id")
        val action = commandJson.optJSONObject("action") ?: return
        val result = try {
            dispatch(action)
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("reason", e.message ?: "unhandled command execution error")
        }
        client.postJson(
            "/v1/companion/commands/result",
            JSONObject().put("command_id", commandId).put("result", result).toString(),
        )
    }

    private fun dispatch(action: JSONObject): JSONObject = when (action.optString("kind")) {
        "app_control.open_deep_link" -> {
            val outcome = appController.perform(AppAction.OpenDeepLink(action.getString("uri")))
            outcome.toJson()
        }
        "app_control.click_by_text" -> {
            val outcome = appController.perform(AppAction.ClickByText(action.getString("text")))
            outcome.toJson()
        }
        "file_access.list" -> {
            when (val outcome = fileAccessManager.listFiles(Uri.parse(action.getString("tree_uri")))) {
                is CompanionResult.Ok -> {
                    val entries = JSONArray()
                    outcome.value.forEach {
                        entries.put(
                            JSONObject()
                                .put("uri", it.uri.toString())
                                .put("name", it.name)
                                .put("is_directory", it.isDirectory)
                                .put("size_bytes", it.sizeBytes),
                        )
                    }
                    JSONObject().put("ok", true).put("result", JSONObject().put("entries", entries))
                }
                is CompanionResult.Err -> JSONObject().put("ok", false).put("reason", outcome.error.message)
            }
        }
        "file_access.read" -> {
            when (val outcome = fileAccessManager.readFile(Uri.parse(action.getString("file_uri")))) {
                is CompanionResult.Ok -> JSONObject().put("ok", true).put(
                    "result",
                    JSONObject().put("content_b64", Base64.encodeToString(outcome.value, Base64.NO_WRAP)),
                )
                is CompanionResult.Err -> JSONObject().put("ok", false).put("reason", outcome.error.message)
            }
        }
        "file_access.write" -> {
            val content = Base64.decode(action.getString("content_b64"), Base64.NO_WRAP)
            val outcome = fileAccessManager.writeFile(
                Uri.parse(action.getString("directory_tree_uri")),
                action.getString("file_name"),
                action.getString("mime_type"),
                content,
            )
            when (outcome) {
                is CompanionResult.Ok -> JSONObject().put("ok", true).put("result", JSONObject().put("uri", outcome.value.toString()))
                is CompanionResult.Err -> JSONObject().put("ok", false).put("reason", outcome.error.message)
            }
        }
        else -> JSONObject().put("ok", false).put("reason", "Unknown command kind: ${action.optString("kind")}")
    }

    private fun AppControlResult.toJson(): JSONObject = when (this) {
        is AppControlResult.Performed -> JSONObject().put("ok", true).put("result", JSONObject().put("via", via))
        is AppControlResult.Failed -> JSONObject().put("ok", false).put("reason", reason)
    }
}
