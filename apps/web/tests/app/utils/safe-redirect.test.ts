import * as v from 'valibot';
import { describe, expect, it } from 'vite-plus/test';
import { redirectPathSchema } from '../../../app/utils/safe-redirect.ts';

describe('redirectPathSchema', () => {
  const schema = redirectPathSchema('/overview');

  it('accepts a local path', () => {
    expect(v.parse(schema, '/overview')).toBe('/overview');
    expect(v.parse(schema, '/settings/billing')).toBe('/settings/billing');
  });

  it('accepts a local path with a query string', () => {
    expect(v.parse(schema, '/overview?tab=billing')).toBe('/overview?tab=billing');
  });

  it('falls back to the given default for a non-string value', () => {
    expect(v.parse(schema, undefined)).toBe('/overview');
    expect(v.parse(schema, null)).toBe('/overview');
    expect(v.parse(schema, 42)).toBe('/overview');
  });

  it('falls back to the given default for an empty string', () => {
    expect(v.parse(schema, '')).toBe('/overview');
  });

  it('falls back for a path that does not start with a single slash', () => {
    expect(v.parse(schema, 'overview')).toBe('/overview');
    expect(v.parse(schema, 'relative/path')).toBe('/overview');
  });

  it('falls back for a protocol-relative URL (open-redirect guard)', () => {
    // `//evil.example.com` is a valid browser URL that navigates
    // off-origin; the leading-slash check alone would let it through.
    expect(v.parse(schema, '//evil.example.com')).toBe('/overview');
  });

  it('falls back for a backslash-based open-redirect attempt', () => {
    // Browsers normalize `\` to `/` in URLs, so `/\evil.example.com` and
    // `\\evil.example.com` are both effectively protocol-relative.
    expect(v.parse(schema, '/\\evil.example.com')).toBe('/overview');
    expect(v.parse(schema, '\\\\evil.example.com')).toBe('/overview');
  });

  it('falls back for an absolute URL disguised as a path', () => {
    expect(v.parse(schema, 'https://evil.example.com/overview')).toBe('/overview');
    expect(v.parse(schema, 'http://evil.example.com')).toBe('/overview');
  });

  it('uses the fallback value passed to redirectPathSchema, not a hardcoded one', () => {
    const customSchema = redirectPathSchema('/signin');
    expect(v.parse(customSchema, 'not-a-path')).toBe('/signin');
  });
});
