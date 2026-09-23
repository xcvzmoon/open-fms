import type * as v from 'valibot';
import { sessions } from '@buildr/database';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';

export const sessionSelectSchema = createSelectSchema(sessions);
export const inputSessionSchema = createInsertSchema(sessions);
export const updateSessionSchema = createUpdateSchema(sessions);

export type SelectSession = v.InferOutput<typeof sessionSelectSchema>;
export type InsertSession = v.InferOutput<typeof inputSessionSchema>;
export type UpdateSession = v.InferOutput<typeof updateSessionSchema>;

export type Session = SelectSession;
