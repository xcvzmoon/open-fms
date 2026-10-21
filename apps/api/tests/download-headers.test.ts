import { expect, test } from 'vite-plus/test';
import {
  DownloadRangeError,
  downloadDisposition,
  validateDownloadRange,
} from '../server/downloads/headers.ts';

test.each(['bytes=0-99', 'bytes=100-', 'bytes=-100', undefined])(
  'accepts a single byte range %s',
  (range) => {
    expect(validateDownloadRange(range)).toBe(range);
  },
);
test.each([
  'bytes=1-0',
  'bytes=0-1\n',
  'bytes=-0',
  'bytes=-',
  'bytes=0-1,4-5',
  'items=0-1',
  'bytes=9007199254740992-',
  'bytes=0-1\r\nfoo',
])('rejects invalid range %s', (range) => {
  expect(() => validateDownloadRange(range)).toThrow(DownloadRangeError);
});
test('encodes original unicode filename and removes header injection and path separators', () => {
  const disposition = downloadDisposition('résumé/"file"\r\n.txt');
  expect(disposition).toContain('filename="r_sum__');
  expect(disposition).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9_%22file%22__.txt");
  expect(() => new Headers({ 'content-disposition': disposition })).not.toThrow();
});
