package com.nova.companion

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage

/**
 * Decodes QR codes from the live camera feed for
 * `docs/28-multi-device-protocol/02-device-pairing-protocol.md`'s
 * pairing scan, closing the gap `apps/android-companion/README.md`
 * previously listed under "What's intentionally not here yet": CameraX
 * was a declared dependency with no analyzer actually using it.
 *
 * Restricted to `FORMAT_QR_CODE` only — this device never needs to
 * decode barcodes of any other kind, and a narrower scanner model is
 * both faster and less likely to mis-fire on an unrelated code in
 * frame. [onDecoded] fires once per newly-seen raw value; the analyzer
 * suppresses repeat callbacks for the same value across frames so the
 * caller doesn't have to debounce a 30fps stream of identical scans
 * itself.
 */
class QrAnalyzer(private val onDecoded: (String) -> Unit) : ImageAnalysis.Analyzer {

    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
    )
    private var lastDecodedValue: String? = null

    @androidx.camera.core.ExperimentalGetImage
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val input = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        scanner.process(input)
            .addOnSuccessListener { barcodes ->
                val raw = barcodes.firstOrNull()?.rawValue
                if (raw != null && raw != lastDecodedValue) {
                    lastDecodedValue = raw
                    onDecoded(raw)
                }
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    }

    /** Lets the screen re-arm scanning after a failed pairing attempt (e.g. a stale/expired code). */
    fun reset() {
        lastDecodedValue = null
    }
}
