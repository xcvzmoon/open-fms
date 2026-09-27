# @open-fms/storage

Single AWS SDK v3 adapter for S3-compatible backends.

This is the only package allowed to import `@aws-sdk/*`.

## Features

- Put, get (with Range), head, copy, delete
- Multipart upload helpers
- Presigned PUT only. GET presign is intentionally not exposed.

## Config

Backend rows come from `storage_backends` (endpoint, region, buckets, path-style flag). Credentials are injected by the caller and never stored in the adapter.

## Integration tests

Unit tests cover construction and presign URL shape. Separate suites hit a real S3-compatible endpoint and cover:

- put/get/range/copy/delete and live presigned PUT
- multipart create/uploadPart/complete/abort
- resumable `proxy_parts` behavior (out-of-order parts, retries, 5 MiB non-final part rule, abort)

```bash
docker compose -f ../../compose.storage.yml up -d --wait
STORAGE_TEST_ENDPOINT=http://127.0.0.1:9000 vp run test
```

Without `STORAGE_TEST_ENDPOINT` the suites are skipped. Defaults match `compose.storage.yml` (`minioadmin`, path-style, `fms-quarantine` / `fms-clean` / `fms-forensic`). Point the same variables at RustFS, MinIO, or AWS S3 when validating a real backend; create the three buckets first.
