package com.nova.companion

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/**
 * Completes the vision pipeline on the phone side: takes the JPEG
 * bytes `VisionCaptureManager`/`ScreenCaptureManager` already produce
 * and sends them to companion-server.ts's `/v1/companion/vision/frame`
 * endpoint, which runs `vision-pipeline.ts` + `spatial-context.ts` and
 * returns resolved, graph-converged objects. Spatial resolution and
 * the Knowledge Graph both live in the Primary Runtime
 * (docs/20-devices/spatial-perception.md's convergence design), so
 * this client is deliberately thin — it moves frames up and results
 * back, it does not duplicate SpatialContext on-device.
 */

data class RecognizedObject(val nodeId: String, val label: String, val via: String)

class VisionPipelineClient(private val client: CompanionApiClient) {

    suspend fun sendFrame(
        frameBytes: ByteArray,
        capturedAtEpochMs: Long,
        hint: String? = null,
    ): CompanionResult<List<RecognizedObject>> {
        val body = JSONObject()
            .put("frame_b64", Base64.encodeToString(frameBytes, Base64.NO_WRAP))
            .put("captured_at_epoch_ms", capturedAtEpochMs)
        if (hint != null) body.put("hint", hint)

        val response = client.postJson("/v1/companion/vision/frame", body.toString())
        return when (response) {
            is CompanionResult.Err -> CompanionResult.Err(response.error)
            is CompanionResult.Ok -> {
                val objects = JSONObject(response.value).optJSONArray("objects") ?: JSONArray()
                val parsed = (0 until objects.length()).map { i ->
                    val entry = objects.getJSONObject(i)
                    RecognizedObject(
                        nodeId = entry.optString("node_id"),
                        label = entry.optString("label"),
                        via = entry.optString("via"),
                    )
                }
                CompanionResult.Ok(parsed)
            }
        }
    }
}
