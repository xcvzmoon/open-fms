# Open FMS API

Nitro/H3 HTTP service for Open FMS.

## Responsibilities

- Authenticate requests (Better Auth sessions and API keys)
- Register callers, issue setup codes, rotate and revoke credentials
- Accept uploads (single, parts, direct grants)
- Stream downloads for `clean` files only
- Run scheduled sweepers and health canaries

## Layout

```text
server/
  auth/          Better Auth config, pepper, mailer glue
  middleware/    request authentication
  registration/  signup, approval, keys, upload passes
  uploads/       upload service, hashing, storage credentials
  downloads/     download service
  observability/ OTel bootstrap and canary
  routes/        HTTP handlers
  tasks/         scheduled Nitro tasks
```

## Local commands

```bash
vp run build --filter open-fms-api
npm run dev --prefix apps/api
npm run build --prefix apps/api
```

## Important env

- `DB_URL`
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `AUTH_TOKEN_PEPPER`, `AUTH_TOKEN_PEPPER_VERSION`
- `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`
- `MAIL_MODE`, `MAIL_FROM`, optional `SMTP_HOST`, `SMTP_PORT`
- `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` for tracing

## Notes

- File bodies stream from the request. Do not buffer uploads with `readBody`.
- Internal imports use the `~` alias mapped to the app root in `nitro.config.ts`.
- `/healthz` is liveness. `/readyz` includes PostgreSQL readiness.
- Scheduled tasks: expiry, purge, reconcile, canary.
