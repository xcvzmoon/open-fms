import type { reconcileObjectPages as runReconcile } from '../src/queries/reconcile.ts';
import { beforeAll, expect, test } from 'vite-plus/test';

let reconcileObjectPages: typeof runReconcile;
beforeAll(async () => {
  const previousUrl = process.env.DB_URL;
  process.env.DB_URL = 'postgresql://dummy:dummy@127.0.0.1:1/dummy';
  try {
    ({ reconcileObjectPages } = await import('../src/queries/reconcile.ts'));
  } finally {
    if (previousUrl === undefined) delete process.env.DB_URL;
    else process.env.DB_URL = previousUrl;
  }
});
type Row = Parameters<typeof runReconcile>[0] extends AsyncIterable<(infer Item)[]> ? Item : never;
const backend: NonNullable<Row['backend']> = {
  id: 'backend',
  name: 'fixture',
  kind: 's3',
  endpoint: 'http://127.0.0.1:1',
  region: 'us-east-1',
  quarantineBucket: 'quarantine',
  cleanBucket: 'clean',
  forensicBucket: null,
  credentialRef: 'dummy',
  isDefault: false,
  status: 'active',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
};
async function* pages(count: number): AsyncGenerator<Row[]> {
  for (let offset = 0; offset < count; offset += 200) {
    yield Array.from({ length: Math.min(200, count - offset) }, (_, index) => ({
      id: String(offset + index),
      objectKey: String(offset + index),
      status: 'clean',
      backend,
    }));
  }
}

test('reuses one adapter, limits concurrency to four and retains only 1000 mismatches across pages', async () => {
  let created = 0;
  let destroyed = 0;
  let active = 0;
  let maximum = 0;
  const missing = new Error('missing');
  const result = await reconcileObjectPages(
    pages(1205),
    async () => {
      created += 1;
      return {
        async headObject() {
          active += 1;
          maximum = Math.max(maximum, active);
          await new Promise<void>((resolve) => setImmediate(resolve));
          active -= 1;
          throw missing;
        },
        destroy() {
          destroyed += 1;
        },
      };
    },
    (error) => error === missing,
    100,
  );
  expect(result.checked).toBe(1205);
  expect(result.mismatchCount).toBe(1205);
  expect(result.mismatches).toHaveLength(1000);
  expect(result.truncated).toBe(true);
  expect(result.storageErrorCount).toBe(0);
  expect(maximum).toBe(4);
  expect(created).toBe(1);
  expect(destroyed).toBe(1);
});

test('reports timeouts and forbidden responses as operational errors, not missing objects', async () => {
  let destroyed = 0;
  const result = await reconcileObjectPages(
    pages(3),
    async () => ({
      async headObject(location) {
        if (location.key === '0') return { etag: 'present', contentLength: 10 };
        throw new Error(location.key === '1' ? 'timeout' : 'forbidden');
      },
      destroy() {
        destroyed += 1;
      },
    }),
    () => false,
  );
  expect(result.checked).toBe(1);
  expect(result.storageErrorCount).toBe(2);
  expect(result.mismatchCount).toBe(0);
  expect(result.mismatches).toEqual([]);
  expect(destroyed).toBe(1);
});

test('destroys the cached adapter when pagination fails', async () => {
  let destroyed = 0;
  async function* brokenPages(): AsyncGenerator<Row[]> {
    yield [{ id: '1', objectKey: 'one', status: 'clean', backend }];
    throw new Error('PAGE_FAILED');
  }
  await expect(
    reconcileObjectPages(
      brokenPages(),
      async () => ({
        async headObject() {
          return { etag: 'ok', contentLength: 1 };
        },
        destroy() {
          destroyed += 1;
        },
      }),
      () => false,
    ),
  ).rejects.toThrow('PAGE_FAILED');
  expect(destroyed).toBe(1);
});

test('bounds operational error details and caches failed backend creation', async () => {
  let created = 0;
  const result = await reconcileObjectPages(
    pages(1205),
    async () => {
      created += 1;
      throw new Error('BACKEND_UNAVAILABLE');
    },
    () => false,
  );
  expect(created).toBe(1);
  expect(result.storageErrorCount).toBe(1205);
  expect(result.storageErrors).toHaveLength(1000);
  expect(result.checked).toBe(0);
});

test('retained infected and rejected objects remain expected in quarantine', async () => {
  async function* retained(): AsyncGenerator<Row[]> {
    yield [
      { id: 'infected', objectKey: 'infected', status: 'infected', backend },
      { id: 'rejected', objectKey: 'rejected', status: 'rejected', backend },
    ];
  }
  const buckets: string[] = [];
  const result = await reconcileObjectPages(
    retained(),
    () =>
      Promise.resolve({
        headObject(location) {
          buckets.push(location.bucket);
          return Promise.resolve({ etag: 'retained', contentLength: 1 });
        },
        destroy() {},
      }),
    () => false,
  );
  expect(result.mismatchCount).toBe(0);
  expect(buckets).toEqual(['quarantine', 'quarantine']);
});
