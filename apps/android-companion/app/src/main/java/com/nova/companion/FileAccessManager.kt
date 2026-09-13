package com.nova.companion

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.documentfile.provider.DocumentFile

/**
 * File Access capability (docs/20-devices/android-companion.md):
 * "Storage Access Framework-scoped access to user-granted folders;
 * never blanket filesystem access." Every method here operates only on
 * a `treeUri` the user has already granted through
 * `ACTION_OPEN_DOCUMENT_TREE` — there is deliberately no path here that
 * accepts an arbitrary filesystem path, since that would be exactly the
 * blanket access the doc rules out.
 */

data class FileAccessEntry(val uri: Uri, val name: String, val isDirectory: Boolean, val sizeBytes: Long)

sealed class FileAccessError(val message: String) {
    object TreeNotAccessible : FileAccessError("The granted folder is no longer accessible (was it revoked in Android Settings?).")
    class ReadFailed(reason: String) : FileAccessError("Failed to read file: $reason")
    class WriteFailed(reason: String) : FileAccessError("Failed to write file: $reason")
}

class FileAccessManager(
    private val context: Context,
    private val permissions: CompanionPermissionsManager,
) {
    private val capability =
        CompanionCapability(CompanionCapabilities.FILE_ACCESS, listOf(CompanionCapabilities.FILE_ACCESS))

    /** The Intent to launch for the user to pick a folder to grant access to (docs: "user-granted folders"). */
    fun requestFolderAccessIntent(): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )

    /**
     * Persists the grant returned by [requestFolderAccessIntent]'s result
     * so it survives app/device restarts, per SAF's standard pattern —
     * without this call the grant is only valid for the current process.
     */
    fun persistFolderAccess(treeUri: Uri) {
        context.contentResolver.takePersistableUriPermission(
            treeUri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
    }

    fun revokeFolderAccess(treeUri: Uri) {
        context.contentResolver.releasePersistableUriPermission(
            treeUri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
    }

    /** Currently granted folder trees — what the permissions screen would list. */
    fun grantedTrees(): List<Uri> = context.contentResolver.persistedUriPermissions
        .filter { it.isReadPermission }
        .map { it.uri }

    fun listFiles(treeUri: Uri): CompanionResult<List<FileAccessEntry>> {
        val permissionCheck = permissions.use(capability)
        if (permissionCheck is CompanionResult.Err) return CompanionResult.Err(permissionCheck.error)

        val tree = DocumentFile.fromTreeUri(context, treeUri)
            ?: return errorResult(FileAccessError.TreeNotAccessible)
        val entries = tree.listFiles().map {
            FileAccessEntry(it.uri, it.name ?: "(unnamed)", it.isDirectory, it.length())
        }
        return CompanionResult.Ok(entries)
    }

    fun readFile(fileUri: Uri): CompanionResult<ByteArray> {
        val permissionCheck = permissions.use(capability)
        if (permissionCheck is CompanionResult.Err) return CompanionResult.Err(permissionCheck.error)

        return try {
            val bytes = context.contentResolver.openInputStream(fileUri)?.use { it.readBytes() }
                ?: return errorResult(FileAccessError.ReadFailed("resolver returned no stream"))
            CompanionResult.Ok(bytes)
        } catch (e: Exception) {
            errorResult(FileAccessError.ReadFailed(e.message ?: "unknown error"))
        }
    }

    fun writeFile(
        directoryTreeUri: Uri,
        fileName: String,
        mimeType: String,
        content: ByteArray,
    ): CompanionResult<Uri> {
        val permissionCheck = permissions.use(capability)
        if (permissionCheck is CompanionResult.Err) return CompanionResult.Err(permissionCheck.error)

        val directory = DocumentFile.fromTreeUri(context, directoryTreeUri)
            ?: return errorResult(FileAccessError.TreeNotAccessible)
        return try {
            val target = directory.findFile(fileName) ?: directory.createFile(mimeType, fileName)
            ?: return errorResult(FileAccessError.WriteFailed("could not create '$fileName'"))
            context.contentResolver.openOutputStream(target.uri, "wt")?.use { it.write(content) }
                ?: return errorResult(FileAccessError.WriteFailed("resolver returned no output stream"))
            CompanionResult.Ok(target.uri)
        } catch (e: Exception) {
            errorResult(FileAccessError.WriteFailed(e.message ?: "unknown error"))
        }
    }

    private fun <T> errorResult(error: FileAccessError): CompanionResult<T> =
        CompanionResult.Err(CompanionError.MissingPermission(CompanionCapabilities.FILE_ACCESS, error.message))
}
