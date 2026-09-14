package com.nova.companion

import org.json.JSONArray
import org.json.JSONObject

/**
 * Kotlin mirror of services/runtime/src/cross-device-sync.ts's
 * `CrossDeviceSyncManager` — same last-write-wins field-level merge,
 * same category priority ordering, same dedup-by-change-id — talking
 * to companion-server.ts's `/v1/companion/sync/pull` and `/sync/push`
 * over the session this device paired with (`PairingSession`).
 * Mirroring an already-tested TS class in Kotlin is the same
 * cross-language convention this app already uses for
 * `CompanionPermissions.kt` mirroring `android-companion.ts`.
 */

data class SyncChange(
    val changeId: String,
    val entityId: String,
    val category: String,
    val logicalClock: Long,
    val partition: String,
    val fields: Map<String, Any?>,
)

class DeviceSyncClient(
    private val client: CompanionApiClient,
    private val sessionKey: ByteArray,
) {
    private var checkpoint: Long = 0
    private val records = mutableMapOf<String, MutableMap<String, Any?>>()
    private val fieldClocks = mutableMapOf<String, MutableMap<String, Long>>()
    private val appliedChangeIds = mutableSetOf<String>()
    private val pending = mutableListOf<SyncChange>()

    /** Pulls every change queued since the last checkpoint and merges it locally, field-by-field, last-write-wins by logical clock. */
    suspend fun pull(): CompanionResult<Int> {
        val response = client.postJson(
            "/v1/companion/sync/pull",
            JSONObject().put("since_logical_clock", checkpoint).toString(),
        )
        val body = when (response) {
            is CompanionResult.Err -> return CompanionResult.Err(response.error)
            is CompanionResult.Ok -> JSONObject(response.value)
        }
        val nextClock = body.optLong("next_clock", checkpoint)
        val envelopes = body.optJSONArray("envelopes") ?: JSONArray()
        var appliedCount = 0
        for (i in 0 until envelopes.length()) {
            val envelopeJson = envelopes.getJSONObject(i)
            val envelope = EncryptedEnvelope(
                ivB64 = envelopeJson.getString("iv_b64"),
                ciphertextB64 = envelopeJson.getString("ciphertext_b64"),
                tagB64 = envelopeJson.getString("tag_b64"),
            )
            val plaintext = CompanionCrypto.decrypt(sessionKey, envelope) ?: continue
            val change = parseChange(JSONObject(plaintext)) ?: continue
            if (appliedChangeIds.contains(change.changeId)) continue
            apply(change)
            appliedChangeIds.add(change.changeId)
            appliedCount += 1
        }
        checkpoint = nextClock
        return CompanionResult.Ok(appliedCount)
    }

    /** Records a locally-originated change and queues it for the next [flush]. */
    fun applyLocal(change: SyncChange) {
        apply(change)
        pending.add(change)
    }

    /** Pushes every queued local change, encrypted with this device's session key, and clears the queue on success. */
    suspend fun flush(): CompanionResult<Int> {
        if (pending.isEmpty()) return CompanionResult.Ok(0)
        val envelopes = JSONArray()
        for (change in pending) {
            val encrypted = CompanionCrypto.encrypt(sessionKey, changeToJson(change).toString())
            envelopes.put(
                JSONObject()
                    .put("iv_b64", encrypted.ivB64)
                    .put("ciphertext_b64", encrypted.ciphertextB64)
                    .put("tag_b64", encrypted.tagB64),
            )
        }
        val response = client.postJson("/v1/companion/sync/push", JSONObject().put("envelopes", envelopes).toString())
        if (response is CompanionResult.Err) return CompanionResult.Err(response.error)
        val count = pending.size
        pending.clear()
        return CompanionResult.Ok(count)
    }

    fun record(entityId: String): Map<String, Any?>? = records[entityId]?.toMap()

    private fun apply(change: SyncChange) {
        val fields = records.getOrPut(change.entityId) { mutableMapOf() }
        val clocks = fieldClocks.getOrPut(change.entityId) { mutableMapOf() }
        for ((field, value) in change.fields) {
            val currentClock = clocks[field] ?: -1
            if (change.logicalClock >= currentClock) {
                fields[field] = value
                clocks[field] = change.logicalClock
            }
        }
    }

    private fun changeToJson(change: SyncChange): JSONObject {
        val fieldsJson = JSONObject()
        for ((key, value) in change.fields) fieldsJson.put(key, value)
        return JSONObject()
            .put("change_id", change.changeId)
            .put("entity_id", change.entityId)
            .put("category", change.category)
            .put("logical_clock", change.logicalClock)
            .put("partition", change.partition)
            .put("fields", fieldsJson)
    }

    private fun parseChange(json: JSONObject): SyncChange? {
        val fieldsJson = json.optJSONObject("fields") ?: return null
        val fields = mutableMapOf<String, Any?>()
        for (key in fieldsJson.keys()) fields[key] = fieldsJson.get(key)
        return SyncChange(
            changeId = json.optString("change_id").ifEmpty { return null },
            entityId = json.optString("entity_id").ifEmpty { return null },
            category = json.optString("category").ifEmpty { return null },
            logicalClock = json.optLong("logical_clock", -1).also { if (it < 0) return null },
            partition = json.optString("partition").ifEmpty { return null },
            fields = fields,
        )
    }
}
