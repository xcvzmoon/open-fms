# @open-fms/scan-worker

Run `vp run build` in this package, then `vp run start` to start the separate
`dist/cli.mjs` consumer. SIGINT and SIGTERM cancel active work and polling, remove
temporary files, destroy storage clients, and close the database pool.

The worker requires `DB_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and
`CLAMAV_HOST`. `CLAMAV_PORT` defaults to 3310. Antivirus errors fail closed;
there is no disabled antivirus mode. Configuration errors print stable codes
without configuration values.

Optional limits are `SCAN_MAX_FILE_BYTES` (1073741824), `SCAN_LEASE_MS` (300000,
minimum 3000), `SCAN_JOB_TIMEOUT_MS` (600000), `SCAN_CLAMAV_TIMEOUT_MS` (30000),
and `SCAN_POLL_INTERVAL_MS` (1000). Times are milliseconds. `SCAN_WORKER_ID`
defaults to a random UUID. `S3_SESSION_TOKEN` is optional.

Each claim consumes an attempt and receives a fresh lease token. Heartbeats renew
the lease; a missed renewal cancels work. Expired claimed and running jobs recover
until their attempt limit, then fail with `SCAN_ATTEMPTS_EXHAUSTED`. Queue updates
and lifecycle verdicts fence stale attempts with the token and lease expiry.

Sealed reads use an ETag condition. Object bytes stream to a private temporary
file, bounded by the recorded size, caller limit, and configured limit. SHA-256
is computed while spooling. MIME detection reads an 8 KiB prefix and checks the
caller allowlist and declared type. ClamAV receives the file with bounded,
backpressured INSTREAM frames.

ZIP inspection uses yauzl with lazy entries, strict filenames, and entry-size
validation. Production scans read the spooled file with random access; they never
buffer the full archive or central directory. Stored and deflated entries are
processed one at a time with stream backpressure and the job cancellation signal.
Both declared and actual uncompressed totals are capped at 4 GiB, with at most
10,000 entries and 16 path segments. Each entry retains only an 8 KiB prefix for
nested archive detection. No archive contents are written to disk.

Encrypted entries, unsupported compression methods, unsafe paths, malformed
metadata, inconsistent decompressed sizes, and nested archives identified by names
or decompressed content signatures fail closed. Other recognized archive formats
are rejected. There is no recursive extraction or compression-ratio heuristic.
Nested archive detection uses recognized names and signatures; it does not claim
to identify every possible polyglot or disguised format. yauzl does not verify
entry CRC-32 checksums; the sealed object's SHA-256 check remains separate.

Scanner unit tests use local dummy services. Queue integration tests require an
explicit `SCAN_TEST_ADMIN_URL`; they create and drop a separate temporary database
and never modify the supplied database's schema.
