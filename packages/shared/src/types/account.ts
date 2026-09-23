import type * as v from 'valibot';
import { accounts } from '@buildr/database';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';

export const accountSelectSchema = createSelectSchema(accounts);
export const inputAccountSchema = createInsertSchema(accounts);
export const updateAccountSchema = createUpdateSchema(accounts);

export type SelectAccount = v.InferOutput<typeof accountSelectSchema>;
export type InsertAccount = v.InferOutput<typeof inputAccountSchema>;
export type UpdateAccount = v.InferOutput<typeof updateAccountSchema>;

export type Account = SelectAccount;
