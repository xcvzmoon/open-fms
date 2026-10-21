import { apiKeyPermissionsSchema } from '@open-fms/database';
import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { cidrAllows } from '~/server/auth/policy.ts';
import { handleIssueCredential } from '~/server/registration/service.ts';

const schema = v.strictObject({
  label: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  kind: v.picklist(['standard', 'restricted']),
  permissions: apiKeyPermissionsSchema,
  allowedCidrs: v.array(v.pipe(v.string(), v.check(validCidr))),
  allowedTypes: v.array(v.pipe(v.string(), v.minLength(1))),
  maxFileSizeBytes: v.nullable(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER)),
  ),
  rateLimitPerSec: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

function validCidr(cidr: string): boolean {
  const address = cidr.split('/')[0];
  return address !== undefined && cidrAllows(address, [cidr]);
}

export default defineHandler(async (event) => {
  const user = event.context.user;
  const callerId = event.context.params?.id;
  if (!user || !callerId) throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  const parsed = v.safeParse(schema, await readBody(event));
  if (!parsed.success) throw new HTTPError('CREDENTIAL_POLICY_INVALID', { status: 400 });
  if (
    parsed.output.kind === 'restricted' &&
    parsed.output.permissions.uploads?.includes('write') &&
    parsed.output.allowedTypes.length === 0
  )
    throw new HTTPError('CREDENTIAL_TYPES_REQUIRED', { status: 400 });
  const { permissions, ...policy } = parsed.output;
  return handleIssueCredential(user.id, callerId, policy, permissions);
});
