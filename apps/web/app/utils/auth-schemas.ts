import * as v from 'valibot';

export const signinSchema = v.object({
  email: v.pipe(v.string(), v.email('Enter a valid email address')),
  password: v.pipe(v.string(), v.minLength(1, 'Password is required')),
});

export const signupSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
  email: v.pipe(v.string(), v.email('Enter a valid email address')),
  password: v.pipe(v.string(), v.minLength(8, 'Password must be at least 8 characters')),
});

export const forgotPasswordSchema = v.object({
  email: v.pipe(v.string(), v.email('Enter a valid email address')),
});

export const resetPasswordSchema = v.object({
  email: v.pipe(v.string(), v.email('Enter a valid email address')),
  otp: v.pipe(v.string(), v.length(6, 'Enter the 6-digit code')),
  password: v.pipe(v.string(), v.minLength(8, 'Password must be at least 8 characters')),
});
