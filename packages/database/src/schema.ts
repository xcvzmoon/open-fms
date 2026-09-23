import { boolean, index, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { generateTimestamps, generateUuid, TIMESTAMP_CONFIG } from './helpers/index.ts';

const schema = pgSchema('buildr');

export const users = schema.table('users', {
  id: generateUuid('id'),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  ...generateTimestamps(),
});

export const sessions = schema.table(
  'sessions',
  {
    id: generateUuid('id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    ...generateTimestamps(),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

export const accounts = schema.table(
  'accounts',
  {
    id: generateUuid('id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    scope: text('scope'),
    password: text('password'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', TIMESTAMP_CONFIG),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', TIMESTAMP_CONFIG),
    ...generateTimestamps(),
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_issuer_account_id_uidx').on(table.issuer, table.accountId),
  ],
);

export const verifications = schema.table(
  'verifications',
  {
    id: generateUuid('id'),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    ...generateTimestamps(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);
