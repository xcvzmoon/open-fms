import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vite-plus/test';
import { parseAuthFixtureDatabaseUrl } from './auth-fixture.ts';

const enabled = process.env.FMS_AUTH_INTEGRATION === '1';

describe('verified caller registration', () => {
  test.runIf(enabled)(
    'binds text user IDs, requires approval, consumes once, and fails closed for unpaired keys',
    async () => {
      parseAuthFixtureDatabaseUrl(process.env.DB_URL);
      const { and, eq, inArray } = await import('drizzle-orm');
      const { db, closeDatabase } = await import('../src/client.ts');
      const { authUsers } = await import('../src/auth/schema.ts');
      const { callers, auditEvents, setupCodes, serviceSettings, callerCredentials } =
        await import('../src/tables/index.ts');
      const {
        createSelfSignupCaller,
        redeemSetupCode,
        approveCaller,
        saveSignupSettings,
        loadSignupSettings,
        bootstrapAdmin,
      } = await import('../src/queries/registration.ts');
      const { hashToken } = await import('../src/security/tokens.ts');
      const { loadCallerContext, consumeCallerRateLimit } =
        await import('../src/queries/callers.ts');
      const userId = `auth-test-${randomUUID()}`;
      const otherId = `auth-other-${randomUUID()}`;
      const [previousSettings] = await db
        .select()
        .from(serviceSettings)
        .where(eq(serviceSettings.key, 'signup'));
      await loadSignupSettings();
      const pepper = { secret: 'dummy-test-pepper-with-at-least-32-chars', version: 1 };
      try {
        await db.insert(authUsers).values([
          { id: userId, name: 'Audit test', email: `${userId}@example.test`, emailVerified: true },
          {
            id: otherId,
            name: 'Unverified',
            email: `${otherId}@example.test`,
            emailVerified: false,
          },
        ]);
        await saveSignupSettings(
          {
            mode: 'self_signup',
            allowedDomains: ['example.test'],
            requireAdminApproval: true,
            maxPendingDays: 14,
          },
          userId,
        );
        await expect(bootstrapAdmin(otherId)).rejects.toThrow('VERIFIED_ACCOUNT_REQUIRED');
        await expect(
          createSelfSignupCaller({ name: otherId, ownerUserId: otherId, pepper }),
        ).rejects.toThrow('VERIFIED_ACCOUNT_REQUIRED');
        const issued = await createSelfSignupCaller({ name: userId, ownerUserId: userId, pepper });
        expect(issued.callerId).not.toBe(userId);
        await db.delete(setupCodes).where(eq(setupCodes.callerId, issued.callerId));
        const codeRows = [];
        for (let index = 0; index < 51; index += 1) {
          codeRows.push({
            callerId: issued.callerId,
            codeHash: hashToken(`dummy-${index}`, pepper),
            expiresAt: issued.expiresAt,
          });
        }
        codeRows.push({
          callerId: issued.callerId,
          codeHash: hashToken(issued.code, pepper),
          expiresAt: issued.expiresAt,
        });
        await db.insert(setupCodes).values(codeRows);
        expect(await loadCallerContext(userId)).toBeNull();
        await expect(
          redeemSetupCode({ code: issued.code, ownerUserId: otherId, pepper }),
        ).rejects.toThrow('SETUP_CODE_INVALID');
        await redeemSetupCode({ code: issued.code, ownerUserId: userId, pepper });
        expect(await loadCallerContext(userId)).toBeNull();
        await expect(
          redeemSetupCode({ code: issued.code, ownerUserId: userId, pepper }),
        ).rejects.toThrow('SETUP_CODE_INVALID');
        await approveCaller({ callerId: issued.callerId, adminActorId: userId, approve: true });
        expect((await loadCallerContext(userId))?.caller.id).toBe(issued.callerId);
        expect(await loadCallerContext(userId, 'unpaired-key')).toBeNull();
        const future = new Date(Date.now() + 60000);
        const past = new Date(Date.now() - 60000);
        await db.insert(callerCredentials).values([
          {
            callerId: issued.callerId,
            label: 'valid',
            keyPrefix: 'test',
            keyId: `${userId}-valid`,
            createdBy: userId,
            expiresAt: future,
          },
          {
            callerId: issued.callerId,
            label: 'expired',
            createdAt: new Date(past.getTime() - 60000),
            keyPrefix: 'test',
            keyId: `${userId}-expired`,
            createdBy: userId,
            expiresAt: past,
          },
          {
            callerId: issued.callerId,
            label: 'revoked',
            keyPrefix: 'test',
            keyId: `${userId}-revoked`,
            createdBy: userId,
            expiresAt: future,
            revokedAt: past,
          },
        ]);
        expect((await loadCallerContext(userId, `${userId}-valid`))?.credential?.keyId).toBe(
          `${userId}-valid`,
        );
        expect(await loadCallerContext(userId, `${userId}-expired`)).toBeNull();
        expect(await loadCallerContext(userId, `${userId}-revoked`)).toBeNull();
        const admissions = await Promise.all([
          consumeCallerRateLimit(issued.callerId, 2),
          consumeCallerRateLimit(issued.callerId, 2),
          consumeCallerRateLimit(issued.callerId, 2),
          consumeCallerRateLimit(issued.callerId, 2),
        ]);
        expect(admissions.filter((allowed) => allowed)).toHaveLength(2);
        await approveCaller({ callerId: issued.callerId, adminActorId: userId, approve: false });
        expect(await loadCallerContext(userId)).toBeNull();
        const audit = await db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.callerId, issued.callerId),
              eq(auditEvents.action, 'setup_code.redeemed'),
            ),
          );
        expect(audit).toHaveLength(1);
      } finally {
        if (previousSettings) {
          await db
            .insert(serviceSettings)
            .values(previousSettings)
            .onConflictDoUpdate({
              target: serviceSettings.key,
              set: {
                value: previousSettings.value,
                updatedBy: previousSettings.updatedBy,
                updatedAt: previousSettings.updatedAt,
              },
            });
        } else {
          await db.delete(serviceSettings).where(eq(serviceSettings.key, 'signup'));
        }
        const owned = await db
          .select({ id: callers.id })
          .from(callers)
          .where(inArray(callers.ownerUserId, [userId, otherId]));
        if (owned.length > 0) {
          const callerIds = owned.map(({ id }) => id);
          await db.delete(setupCodes).where(inArray(setupCodes.callerId, callerIds));
          await db.delete(auditEvents).where(inArray(auditEvents.callerId, callerIds));
        }
        await db.delete(callers).where(inArray(callers.ownerUserId, [userId, otherId]));
        await db.delete(auditEvents).where(eq(auditEvents.actorId, userId));
        await db.delete(authUsers).where(inArray(authUsers.id, [userId, otherId]));
        await closeDatabase();
      }
    },
  );
});
