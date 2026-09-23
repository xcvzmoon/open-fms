import { defineEnv } from '@xcvzlabs/env';
import * as v from 'valibot';

// dotenv leaves unset-but-declared vars (e.g. `SMTP_SECURE=`) as an empty
// string rather than omitting the key, so "optional" here means both
// "absent" and "blank" skip validation of the wrapped schema.
function optionalEnv<TSchema extends v.GenericSchema<string, unknown>>(schema: TSchema) {
  return v.pipe(
    v.optional(v.string(), ''),
    v.transform((value) => (value === '' ? undefined : value)),
    v.optional(schema),
  );
}

export const env = defineEnv({
  schema: {
    web: {
      origin: v.pipe(v.string('WEB_ORIGIN is required'), v.url('WEB_ORIGIN must be a valid URL')),
    },
    google: {
      client: {
        id: v.string('GOOGLE_CLIENT_ID is required'),
        secret: v.string('GOOGLE_CLIENT_SECRET is required'),
      },
    },
    dymo: {
      apiKey: v.string('DYMO_API_KEY is required'),
    },
    email: {
      // Accepts either a bare address or an RFC 5322 "Name <email>" form,
      // e.g. "Buildr <hello@buildr.dev>" — unemail parses either.
      from: v.pipe(v.string('EMAIL_FROM is required'), v.minLength(1, 'EMAIL_FROM is required')),
    },
    resend: {
      apiKey: optionalEnv(v.string()),
    },
    smtp: {
      host: optionalEnv(v.string()),
      port: optionalEnv(
        v.pipe(v.string(), v.transform(Number), v.integer('SMTP_PORT must be an integer')),
      ),
      user: optionalEnv(v.string()),
      pass: optionalEnv(v.string()),
      secure: optionalEnv(
        v.pipe(
          v.picklist(['true', 'false'], 'SMTP_SECURE must be "true" or "false"'),
          v.transform((value) => value === 'true'),
        ),
      ),
    },
  },
});
