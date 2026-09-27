import type { LifecycleStorage } from '../src/types.ts';

type CopyRecord = {
  sourceBucket: string;
  sourceKey: string;
  destinationBucket: string;
  destinationKey: string;
};

type DeleteRecord = {
  bucket: string;
  key: string;
};

type StoredObject = {
  etag: string;
  contentLength: number;
};

export type ControllableStorage = LifecycleStorage & {
  copies: CopyRecord[];
  deletes: DeleteRecord[];
  failNextCopy: Error | null;
  failNextHead: Error | null;
  seedObject(location: { bucket: string; key: string }, object: StoredObject): void;
  objects: Map<string, StoredObject>;
};

function objectKey(location: { bucket: string; key: string }): string {
  return `${location.bucket}/${location.key}`;
}

export function createControllableStorage(): ControllableStorage {
  const objects = new Map<string, StoredObject>();
  const copies: CopyRecord[] = [];
  const deletes: DeleteRecord[] = [];
  let failNextCopy: Error | null = null;
  let failNextHead: Error | null = null;

  const storage: ControllableStorage = {
    copies,
    deletes,
    objects,
    get failNextCopy() {
      return failNextCopy;
    },
    set failNextCopy(error: Error | null) {
      failNextCopy = error;
    },
    get failNextHead() {
      return failNextHead;
    },
    set failNextHead(error: Error | null) {
      failNextHead = error;
    },
    seedObject(location, object) {
      objects.set(objectKey(location), object);
    },
    copyObject(input) {
      copies.push(input);
      if (failNextCopy) {
        const error = failNextCopy;
        failNextCopy = null;
        return Promise.reject(error);
      }
      const source = objects.get(objectKey({ bucket: input.sourceBucket, key: input.sourceKey }));
      const etag = source?.etag ?? 'copied-etag';
      objects.set(objectKey({ bucket: input.destinationBucket, key: input.destinationKey }), {
        etag,
        contentLength: source?.contentLength ?? 0,
      });
      return Promise.resolve({ etag });
    },
    headObject(location) {
      if (failNextHead) {
        const error = failNextHead;
        failNextHead = null;
        return Promise.reject(error);
      }
      const object = objects.get(objectKey(location));
      if (!object) {
        return Promise.reject(new Error('CONTROLLABLE_STORAGE_MISSING_OBJECT'));
      }
      return Promise.resolve({
        etag: object.etag,
        contentLength: object.contentLength,
        contentType: undefined,
        lastModified: undefined,
      });
    },
    deleteObject(location) {
      deletes.push(location);
      objects.delete(objectKey(location));
      return Promise.resolve();
    },
  };

  return storage;
}
