import { defineEnv } from '@xcvzlabs/env';
import * as v from 'valibot';

export const env = defineEnv({
  schema: {
    db: {
      url: v.pipe(
        v.string('DB_URL is required'),
        v.url('DB_URL must be a valid URL'),
        v.regex(/^postgres(?:ql)?:\/\//, 'DB_URL must be a PostgreSQL connection string'),
      ),
    },
  },
});
