package com.nova.companion

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import java.io.ByteArrayOutputStream

/**
 * Screen-content capture (docs/20-devices/screen-streaming.md's
 * "Capture" pipeline step). Uses Android's MediaProjection API, which
 * — per the doc — requires an explicit, per-session user grant that
 * Android itself prompts for; this class cannot and does not bypass
 * that system dialog, it only drives the session once the user has
 * granted it via [requestProjectionIntent]'s result.
 *
 * Same [CompanionCapabilities.VISION] capability gate as
 * [VisionCaptureManager]'s camera capture — the doc treats phone
 * screen-content and phone-camera capture as two capture *sources*
 * within one Vision capability domain, not two separate permissions.
 *
 * "Session-scoped, not always-on": [startSession] requires an explicit
 * call, and an idle timeout with no [onFrame] consumer activity
 * auto-stops the session — there is no code path here that keeps
 * capturing indefinitely in the background.
 */
class ScreenCaptureManager(
    private val context: Context,
    private val permissions: CompanionPermissionsManager,
) {
    private val capability = CompanionCapability(CompanionCapabilities.VISION, listOf(CompanionCapabilities.VISION))
    private val handler = Handler(Looper.getMainLooper())

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var idleTimeoutRunnable: Runnable? = null

    /** Launch this Intent from an Activity via `startActivityForResult` — Android's own consent prompt. */
    fun requestProjectionIntent(): Intent {
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        return manager.createScreenCaptureIntent()
    }

    /**
     * Starts a bounded capture session from the Activity result of
     * [requestProjectionIntent]. [onFrame] receives downscaled JPEG
     * bytes at roughly [frameIntervalMs] — "reduced frame rate and
     * resolution tuned for understanding rather than video quality,
     * this is not a screen-mirroring product," per the doc, so the
     * default interval favors sparse sampling over smooth video.
     * [idleTimeoutMs] auto-stops the session ("ends ... after a
     * configurable idle timeout") if [reportActivity] isn't called to
     * reset the clock — capture activity alone does not count as task
     * activity, since a Planner that stopped consuming frames but left
     * the raw capture loop running would be exactly the always-on
     * surveillance mode the doc rules out.
     *
     * Caller must have already started [CompanionForegroundService]
     * before calling this — Android 14+ throws a `SecurityException`
     * from `getMediaProjection` if a `mediaProjection`-typed foreground
     * service isn't already running, so this isn't an optional
     * ordering suggestion.
     */
    fun startSession(
        activityResult: Activity,
        resultCode: Int,
        resultData: Intent,
        captureWidth: Int = 720,
        captureHeight: Int = 1280,
        frameIntervalMs: Long = 1000,
        idleTimeoutMs: Long = 120_000,
        onFrame: (ByteArray) -> Unit,
    ): CompanionResult<Unit> {
        val permissionCheck = permissions.use(capability)
        if (permissionCheck is CompanionResult.Err) return CompanionResult.Err(permissionCheck.error)

        val manager =
            activityResult.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = manager.getMediaProjection(resultCode, resultData)
        mediaProjection = projection

        val reader = ImageReader.newInstance(captureWidth, captureHeight, android.graphics.PixelFormat.RGBA_8888, 2)
        imageReader = reader
        virtualDisplay = projection.createVirtualDisplay(
            "nova-screen-capture",
            captureWidth,
            captureHeight,
            context.resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            handler,
        )

        var lastEmittedAt = 0L
        reader.setOnImageAvailableListener({ imageReader ->
            val image = imageReader.acquireLatestImage() ?: return@setOnImageAvailableListener
            val now = System.currentTimeMillis()
            if (now - lastEmittedAt < frameIntervalMs) {
                image.close()
                return@setOnImageAvailableListener
            }
            lastEmittedAt = now
            onFrame(image.toJpegBytes())
            image.close()
        }, handler)

        armIdleTimeout(idleTimeoutMs)
        return CompanionResult.Ok(Unit)
    }

    /** Resets the idle-timeout clock — call this when a frame was actually consumed/acted on, not on every raw capture. */
    fun reportActivity(idleTimeoutMs: Long = 120_000) {
        if (mediaProjection == null) return
        armIdleTimeout(idleTimeoutMs)
    }

    fun stopSession() {
        idleTimeoutRunnable?.let { handler.removeCallbacks(it) }
        idleTimeoutRunnable = null
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        mediaProjection?.stop()
        mediaProjection = null
    }

    fun isSessionActive(): Boolean = mediaProjection != null

    private fun armIdleTimeout(idleTimeoutMs: Long) {
        idleTimeoutRunnable?.let { handler.removeCallbacks(it) }
        val runnable = Runnable { stopSession() }
        idleTimeoutRunnable = runnable
        handler.postDelayed(runnable, idleTimeoutMs)
    }

    private fun Image.toJpegBytes(): ByteArray {
        val plane = planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width

        val bitmap = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888)
        bitmap.copyPixelsFromBuffer(buffer)
        val cropped = if (rowPadding == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0, width, height)

        val output = ByteArrayOutputStream()
        cropped.compress(Bitmap.CompressFormat.JPEG, 70, output)
        return output.toByteArray()
    }
}
