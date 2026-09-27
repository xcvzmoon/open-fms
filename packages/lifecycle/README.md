# @open-fms/lifecycle

File lifecycle module. Owns guarded status transitions and quota accounting.

Use this package instead of writing `files.status` from routes, workers, or tasks.

## Public surface

- `createFileWithUploadSession`
- `markUploading` / `markScanning` / `completeAndEnqueueScan`
- `applyScanVerdict`
- `abortFile` / `expireStaleUpload` / `purgeFile` / `markDeleted`
- `assertDownloadable`

Storage access is injected through a narrow port (`copy` / `head` / `delete`).
