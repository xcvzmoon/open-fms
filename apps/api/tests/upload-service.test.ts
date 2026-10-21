import type { CallerContext } from '@open-fms/database';
import type { assertUploadPolicy as policyFunction } from '../server/uploads/service.ts';
import * as v from 'valibot';
import { describe, expect, test } from 'vite-plus/test';
import { hashByteStream } from '../server/uploads/hash.ts';

const previousDatabaseUrl = process.env.DB_URL;
process.env.DB_URL = 'postgresql://unused:unused@127.0.0.1:1/upload_unit_tests';
const {
  assertUploadPolicy: uploadPolicy,
  assertUploadOpen,
  assertUploadHeaders,
  parsePartNumber,
  createUploadSchema,
} = await import('../server/uploads/service.ts');
const assertUploadPolicy: typeof policyFunction = uploadPolicy;
if (previousDatabaseUrl === undefined) delete process.env.DB_URL;
else process.env.DB_URL = previousDatabaseUrl;

const caller: CallerContext = {
  caller: {
    id: 'caller',
    name: 'test',
    kind: 'app',
    status: 'active',
    maxFileSizeBytes: 100,
    allowedContentTypes: ['text/plain'],
    quotaBytes: null,
    rateLimitPerSec: null,
    retentionDays: null,
  },
  credential: {
    keyId: 'key',
    kind: 'restricted',
    scopes: [],
    allowedCidrs: [],
    allowedTypes: ['text/plain'],
    maxFileSizeBytes: 10,
    rateLimitPerSec: null,
  },
};

describe('upload admission', () => {
  test('creation rejects missing declarations, missing modes, and direct uploads', () => {
    const base = {
      storageBackendId: 'storage',
      originalFilename: 'file',
      declaredContentType: 'text/plain',
    };
    for (const input of [
      base,
      { ...base, mode: 'proxy_single' },
      { ...base, declaredSizeBytes: 1 },
      { ...base, declaredSizeBytes: 1, mode: 'direct' },
      { ...base, declaredSizeBytes: null, mode: 'proxy_single' },
    ]) {
      expect(v.safeParse(createUploadSchema, input).success).toBe(false);
    }
    expect(
      v.safeParse(createUploadSchema, { ...base, declaredSizeBytes: 0, mode: 'proxy_single' })
        .success,
    ).toBe(true);
  });
  test('rejects sealed, expired, and wrong-mode sessions before reading bytes', () => {
    const session = {
      mode: 'proxy_single',
      status: 'uploading',
      expiresAt: new Date(Date.now() + 60_000),
    } as const;
    expect(() => {
      assertUploadOpen({ status: 'quarantined' }, session, 'proxy_single');
    }).toThrow('FILE_TRANSITION_INVALID');
    expect(() => {
      assertUploadOpen(
        { status: 'uploading' },
        { ...session, status: 'completed' },
        'proxy_single',
      );
    }).toThrow('UPLOAD_SESSION_INVALID');
    expect(() => {
      assertUploadOpen(
        { status: 'uploading' },
        { ...session, expiresAt: new Date(0) },
        'proxy_single',
      );
    }).toThrow('UPLOAD_SESSION_INVALID');
    expect(() => {
      assertUploadOpen({ status: 'uploading' }, session, 'proxy_parts', true);
    }).toThrow('UPLOAD_MODE_INVALID');
  });
  test.each(['1x', '1.5', '+1', '-1', '0', '10001', '1e2', ' 1', ''])(
    'rejects malformed part %s',
    (part) => {
      expect(() => parsePartNumber(part)).toThrow('UPLOAD_PART_NUMBER_INVALID');
    },
  );
  test('accepts the full part range', () => {
    expect(parsePartNumber('1')).toBe(1);
    expect(parsePartNumber('10000')).toBe(10000);
  });
  test.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'requires an exact declared size %s',
    (size) => {
      expect(() => {
        assertUploadPolicy(caller, size, 'text/plain');
      }).toThrow('UPLOAD_SIZE_MISMATCH');
    },
  );
  test('applies effective key limits to existing session declarations', () => {
    expect(() => {
      assertUploadPolicy(caller, 11, 'text/plain');
    }).toThrow('QUOTA_EXCEEDED');
    expect(() => {
      assertUploadPolicy(caller, 10, 'image/png');
    }).toThrow('UPLOAD_TYPE_NOT_ALLOWED');
    expect(() => {
      assertUploadPolicy(caller, 0, 'text/plain');
    }).not.toThrow();
  });
  test('rejects length and MIME spoofing before storage', () => {
    expect(() => {
      assertUploadHeaders(
        new Headers({ 'content-length': '2', 'content-type': 'text/plain' }),
        3,
        'text/plain',
      );
    }).toThrow('UPLOAD_SIZE_MISMATCH');
    expect(() => {
      assertUploadHeaders(new Headers({ 'content-type': 'image/png' }), 3, 'text/plain');
    }).toThrow('UPLOAD_TYPE_NOT_ALLOWED');
  });
});

describe('streamed completion hashing', () => {
  test('stops reading at the declaration and closes the source', async () => {
    let closed = false;
    let reads = 0;
    function* objectBytes(): Generator<Uint8Array> {
      try {
        for (let index = 0; index < 100; index += 1) {
          reads += 1;
          yield new Uint8Array(4);
        }
      } finally {
        closed = true;
      }
    }
    await expect(hashByteStream(objectBytes(), 5)).rejects.toThrow('UPLOAD_SIZE_MISMATCH');
    expect(reads).toBe(2);
    expect(closed).toBe(true);
  });
});
