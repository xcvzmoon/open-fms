# @open-fms/scan-worker

Scan pipeline for quarantined objects.

## Pipeline

1. Claim a job with `FOR UPDATE SKIP LOCKED`
2. Download sealed object
3. SHA-256 verification
4. Magic-byte MIME sniff (`file-type`)
5. Structure and archive-bomb checks
6. Optional ClamAV `INSTREAM`
7. Submit verdict to `@open-fms/lifecycle`

Workers never write `files.status` directly.
