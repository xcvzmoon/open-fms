import type * as v from 'valibot';
import { verifications } from '@buildr/database';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';

export const verificationSelectSchema = createSelectSchema(verifications);
export const inputVerificationSchema = createInsertSchema(verifications);
export const updateVerificationSchema = createUpdateSchema(verifications);

export type SelectVerification = v.InferOutput<typeof verificationSelectSchema>;
export type InsertVerification = v.InferOutput<typeof inputVerificationSchema>;
export type UpdateVerification = v.InferOutput<typeof updateVerificationSchema>;

export type Verification = SelectVerification;
