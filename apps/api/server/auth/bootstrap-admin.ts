import { bootstrapAdmin, closeDatabase } from '@open-fms/database';
import * as v from 'valibot';
import { createAuth } from './auth.ts';
import { readBootstrapPassword } from './bootstrap-password.ts';
import { resolveAuthEnv } from './env.ts';

const emailSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email());
const [command, identifier, name] = process.argv.slice(2);
try {
  if (command === 'create' && identifier && name && process.argv.length === 5) {
    const email = v.parse(emailSchema, identifier);
    if (process.stdin.isTTY)
      throw new Error('BOOTSTRAP_PASSWORD_STDIN_REQUIRED: pipe a password from a secure source');
    const password = await readBootstrapPassword(process.stdin);
    const bootstrapAuth = createAuth(email);
    const env = resolveAuthEnv();
    const result = await bootstrapAuth.api.signUpEmail({
      body: { email, name, password },
      headers: new Headers({ origin: new URL(env.baseURL).origin }),
    });
    console.info(
      `Account ${result.user.id} created. Open the verification email, then run auth:bootstrap-admin promote with this user ID.`,
    );
  } else if (command === 'promote' && identifier && !name && process.argv.length === 4) {
    await bootstrapAdmin(identifier);
    console.info('Admin access granted to the verified account');
  } else {
    throw new Error(
      'USAGE: auth:bootstrap-admin create <email> <name> | promote <verified-user-id>',
    );
  }
} finally {
  await closeDatabase();
}
