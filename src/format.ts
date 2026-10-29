/** Small pure helpers: file names, byte sizes and human readable exec errors. */

const MAX_ERROR_LENGTH = 300;

/** Build a safe download file name from an absolute path inside the container. */
export function suggestFilename(path: string): string {
  const base = path.split('/').filter(Boolean).pop() ?? '';
  const safe = base
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();

  if (safe === '' || safe === '.' || safe === '..') {
    return 'download.bin';
  }
  return safe;
}

/** Human readable size, e.g. 512 B, 1.2 KiB, 3.4 MiB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function truncate(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= MAX_ERROR_LENGTH) {
    return single;
  }
  return `${single.slice(0, MAX_ERROR_LENGTH)}…`;
}

/**
 * Map the most common exec failures onto messages an operator can act on.
 * Unknown output is passed through (trimmed and truncated).
 */
export function describeExecError(raw: string): string {
  const text = (raw ?? '').trim();
  const lower = text.toLowerCase();

  if (
    /executable file not found|not found in \$path|no such file or directory: base64/.test(lower)
  ) {
    return 'This container has no `base64` binary (distroless or scratch images are not supported).';
  }
  if (/no such file or directory|file not found|do not exist/.test(lower)) {
    return 'File not found inside the container. Use an absolute path.';
  }
  if (/is a directory/.test(lower)) {
    return 'That path is a directory. Only single files can be downloaded; use `kubectl cp -r` for folders.';
  }
  if (/permission denied/.test(lower)) {
    return 'Permission denied: the container user cannot read this path.';
  }
  if (/forbidden|unauthorized/.test(lower)) {
    return 'You are not allowed to exec into this pod (needs pods/exec in RBAC).';
  }
  if (/read-only file system/.test(lower)) {
    return 'Read-only file system (this is only relevant for write access).';
  }
  if (text === '') {
    return 'The container reported an unknown error.';
  }
  return truncate(text);
}
