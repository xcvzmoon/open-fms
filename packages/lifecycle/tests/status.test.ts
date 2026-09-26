import { describe, expect, test } from 'vite-plus/test';
import { canTransition, isDownloadableStatus, isTerminalStatus } from '../src/status.ts';
import { LifecycleError, toLifecycleFailure } from '../src/types.ts';

describe('file status machine', () => {
  test('allows the happy path', () => {
    expect(canTransition('initiated', 'uploading')).toBe(true);
    expect(canTransition('uploading', 'uploaded')).toBe(true);
    expect(canTransition('uploaded', 'quarantined')).toBe(true);
    expect(canTransition('quarantined', 'scanning')).toBe(true);
    expect(canTransition('scanning', 'clean')).toBe(true);
    expect(canTransition('clean', 'deleted')).toBe(true);
  });

  test('blocks skipped and reverse transitions', () => {
    expect(canTransition('initiated', 'clean')).toBe(false);
    expect(canTransition('scanning', 'uploading')).toBe(false);
    expect(canTransition('clean', 'scanning')).toBe(false);
    expect(canTransition('deleted', 'clean')).toBe(false);
    expect(canTransition('clean', 'infected')).toBe(false);
  });

  test('only clean files are downloadable', () => {
    expect(isDownloadableStatus('clean')).toBe(true);
    expect(isDownloadableStatus('scanning')).toBe(false);
    expect(isDownloadableStatus('infected')).toBe(false);
    expect(isDownloadableStatus('deleted')).toBe(false);
  });

  test('deleted is terminal', () => {
    expect(isTerminalStatus('deleted')).toBe(true);
    expect(isTerminalStatus('clean')).toBe(false);
  });
});

describe('lifecycle errors', () => {
  test('maps LifecycleError codes', () => {
    const failure = toLifecycleFailure(new LifecycleError('FILE_ROW_VERSION_CONFLICT'));
    expect(failure.code).toBe('FILE_ROW_VERSION_CONFLICT');
  });

  test('maps unknown errors to LIFECYCLE_FAILED', () => {
    const failure = toLifecycleFailure(new Error('boom'));
    expect(failure.code).toBe('LIFECYCLE_FAILED');
  });
});
