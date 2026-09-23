import type * as v from 'valibot';
import { users } from '@buildr/database';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';

export const userSelectSchema = createSelectSchema(users);
export const inputUserSchema = createInsertSchema(users);
export const updateUserSchema = createUpdateSchema(users);

export type SelectUser = v.InferOutput<typeof userSelectSchema>;
export type InsertUser = v.InferOutput<typeof inputUserSchema>;
export type UpdateUser = v.InferOutput<typeof updateUserSchema>;

export type User = SelectUser;
