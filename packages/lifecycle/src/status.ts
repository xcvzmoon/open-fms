export type FileStatus =
  | 'initiated'
  | 'uploading'
  | 'uploaded'
  | 'quarantined'
  | 'scanning'
  | 'clean'
  | 'infected'
  | 'rejected'
  | 'failed'
  | 'deleted';

export type FileStatusTransition = {
  from: FileStatus;
  to: FileStatus;
};

const allowedTransitions: ReadonlySet<string> = new Set([
  'initiated>uploading',
  'initiated>failed',
  'initiated>deleted',
  'uploading>uploaded',
  'uploading>failed',
  'uploading>deleted',
  'uploaded>quarantined',
  'uploaded>failed',
  'uploaded>deleted',
  'quarantined>scanning',
  'quarantined>failed',
  'quarantined>deleted',
  'scanning>clean',
  'scanning>infected',
  'scanning>rejected',
  'scanning>failed',
  'clean>deleted',
  'infected>deleted',
  'rejected>deleted',
  'failed>deleted',
]);

export function canTransition(from: FileStatus, to: FileStatus): boolean {
  return allowedTransitions.has(`${from}>${to}`);
}

export function isTerminalStatus(status: FileStatus): boolean {
  return status === 'deleted';
}

export function isDownloadableStatus(status: FileStatus): boolean {
  return status === 'clean';
}
