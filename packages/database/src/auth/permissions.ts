import * as v from 'valibot';

export const apiKeyPermissionsSchema = v.pipe(
  v.strictObject({
    uploads: v.optional(v.pipe(v.array(v.literal('write')), v.minLength(1), v.maxLength(1))),
    files: v.optional(v.pipe(v.array(v.literal('read')), v.minLength(1), v.maxLength(1))),
  }),
  v.check(({ uploads, files }) => uploads !== undefined || files !== undefined),
);

export type ApiKeyPermissions = v.InferOutput<typeof apiKeyPermissionsSchema>;

export const storedApiKeyPermissionsSchema = v.pipe(
  v.string(),
  v.parseJson(),
  apiKeyPermissionsSchema,
);
