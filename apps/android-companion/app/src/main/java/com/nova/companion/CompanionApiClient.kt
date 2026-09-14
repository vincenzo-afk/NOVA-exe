package com.nova.companion

import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The real network client that finishes pairing transport, device
 * sync, remote App Control / File Access, and the vision pipeline —
 * everything companion-server.ts exposes. Plain HTTP/JSON over
 * `HttpURLConnection` rather than adding OkHttp or Ktor: the request
 * shape here is simple (small JSON bodies, occasional larger frame
 * payloads), the companion app already has zero networking
 * dependencies, and every endpoint is request/response rather than a
 * persistent stream, so nothing here needs a purpose-built HTTP
 * client library — the platform's own client is enough and keeps the
 * dependency surface exactly what it was.
 *
 * Every call runs on `Dispatchers.IO` and returns a `CompanionResult`,
 * matching every other capability in this app rather than throwing
 * across a coroutine boundary a caller might not expect.
 */

class CompanionApiClient(
    private val baseUrl: String,
    private val bearerToken: () -> String?,
) {
    suspend fun postJson(path: String, bodyJson: String, requireAuth: Boolean = true): CompanionResult<String> =
        request("POST", path, bodyJson, requireAuth)

    suspend fun getJson(path: String, requireAuth: Boolean = true): CompanionResult<String> =
        request("GET", path, null, requireAuth)

    private suspend fun request(
        method: String,
        path: String,
        bodyJson: String?,
        requireAuth: Boolean,
    ): CompanionResult<String> = withContext(Dispatchers.IO) {
        try {
            val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
            connection.requestMethod = method
            connection.connectTimeout = 10_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            if (requireAuth) {
                val token = bearerToken()
                    ?: return@withContext CompanionResult.Err(
                        CompanionError.TransportFailure("No paired session token — pair with a desktop first."),
                    )
                connection.setRequestProperty("Authorization", "Bearer $token")
            }
            if (bodyJson != null) {
                connection.doOutput = true
                connection.outputStream.use { stream: OutputStream ->
                    stream.write(bodyJson.toByteArray(Charsets.UTF_8))
                }
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            connection.disconnect()

            if (status in 200..299) {
                CompanionResult.Ok(text)
            } else {
                CompanionResult.Err(CompanionError.TransportFailure("HTTP $status: $text"))
            }
        } catch (e: Exception) {
            CompanionResult.Err(CompanionError.TransportFailure(e.message ?: "network error"))
        }
    }
}
