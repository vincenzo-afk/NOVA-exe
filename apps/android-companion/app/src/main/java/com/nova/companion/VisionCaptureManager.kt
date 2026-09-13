package com.nova.companion

import android.content.Context
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * Vision capability (docs/20-devices/android-companion.md): "camera ...
 * capture feed[s] the Vision capability domain ... enabling 'point the
 * phone camera and ask NOVA' interactions." This is the still-image
 * half of that (screen-content capture is `docs/20-devices/screen-streaming.md`'s
 * concern, a separate, not-yet-audited surface). Every capture is
 * gated by the same `CompanionPermissionsManager.use()` check every
 * other capability uses — there is no path here that captures without
 * it.
 *
 * Returns raw JPEG bytes rather than a NOVA-specific type: what happens
 * to the bytes next (routed to which provider, on-device or cloud) is
 * `docs/18-providers/provider-interface.md`'s concern, not this
 * capture surface's.
 */
class VisionCaptureManager(
    private val context: Context,
    private val permissions: CompanionPermissionsManager,
) {
    private val capability = CompanionCapability(CompanionCapabilities.VISION, listOf(CompanionCapabilities.VISION))

    suspend fun captureStillImage(
        lifecycleOwner: LifecycleOwner,
        cameraExecutor: Executor,
    ): CompanionResult<ByteArray> {
        val permissionCheck = permissions.use(capability)
        if (permissionCheck is CompanionResult.Err) return CompanionResult.Err(permissionCheck.error)

        val cameraProvider = ProcessCameraProvider.getInstance(context).get()
        val imageCapture = ImageCapture.Builder().build()
        cameraProvider.unbindAll()
        cameraProvider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, imageCapture)

        return try {
            val bytes = suspendCoroutine<ByteArray> { continuation ->
                imageCapture.takePicture(
                    cameraExecutor,
                    object : ImageCapture.OnImageCapturedCallback() {
                        override fun onCaptureSuccess(image: ImageProxy) {
                            continuation.resume(image.toJpegBytes())
                            image.close()
                        }

                        override fun onError(exception: ImageCaptureException) {
                            continuation.resume(ByteArray(0))
                        }
                    },
                )
            }
            cameraProvider.unbindAll()
            if (bytes.isEmpty()) {
                CompanionResult.Err(CompanionError.MissingPermission(CompanionCapabilities.VISION, "capture failed"))
            } else {
                CompanionResult.Ok(bytes)
            }
        } catch (e: Exception) {
            cameraProvider.unbindAll()
            CompanionResult.Err(CompanionError.MissingPermission(CompanionCapabilities.VISION, e.message ?: "capture error"))
        }
    }

    private fun ImageProxy.toJpegBytes(): ByteArray {
        val buffer = planes[0].buffer
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        return bytes
    }
}
