# @open-fms/storage

Single AWS SDK v3 adapter for S3-compatible backends.

This is the only package allowed to import `@aws-sdk/*`.

## Features

- Put, get (with Range), head, copy, delete
- Multipart upload helpers
- Presigned PUT only. GET presign is intentionally not exposed.

## Config

Backend rows come from `storage_backends` (endpoint, region, buckets, path-style flag). Credentials are injected by the caller and never stored in the adapter.
