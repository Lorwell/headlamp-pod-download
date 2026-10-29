/**
 * Download a single file from a running container.
 *
 * The file is streamed out of the container with `base64 <path>` over the
 * Kubernetes exec websocket that Headlamp already proxies, and assembled in the
 * browser into a Blob. No extra backend, no cluster writes.
 */

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { describeExecError, suggestFilename } from './format';
import { base64ToBytes, parseFrame } from './frames';

export type PodLike = InstanceType<typeof K8s.ResourceClasses.Pod>;

/** Upper bound for one download. Larger files should be fetched with `kubectl cp`. */
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/** The container stopped sending data for this long: treat it as a stall. */
const IDLE_TIMEOUT_MS = 60_000;

/** Absolute upper bound for one download. */
const TOTAL_TIMEOUT_MS = 10 * 60_000;

/** How much stderr to keep for error reporting. */
const MAX_STDERR = 4096;

export interface DownloadRequest {
  pod: PodLike;
  container: string;
  path: string;
  onProgress?: (receivedBytes: number) => void;
  onDone?: (result: { filename: string; bytes: number }) => void;
  onError?: (message: string) => void;
}

export interface DownloadHandle {
  cancel: () => void;
}

export const CANCEL_MESSAGE = 'Download cancelled.';

/** Validate the path before touching the cluster. Returns an error or null. */
export function validatePath(path: string): string | null {
  const value = (path ?? '').trim();
  if (value === '') {
    return 'Enter the absolute path of a file inside the container.';
  }
  if (!value.startsWith('/')) {
    return 'Use an absolute path, starting with "/".';
  }
  if (value === '/') {
    return 'That path is the container root. Enter the path of a file.';
  }
  if (value.endsWith('/')) {
    return 'That is a directory. Only single files can be downloaded; use `kubectl cp -r` for folders.';
  }
  return null;
}

function saveBlob(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadPodFile(request: DownloadRequest): DownloadHandle {
  const { pod, container, path, onProgress, onDone, onError } = request;
  const target = (path ?? '').trim();

  const invalid = validatePath(target);
  if (invalid) {
    onError?.(invalid);
    return { cancel: () => undefined };
  }

  let finished = false;
  let base64 = '';
  let stderr = '';
  let received = 0;
  let handle: ReturnType<PodLike['exec']> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const totalTimer = setTimeout(
    () => fail('Timed out after 10 minutes. Try a smaller file or `kubectl cp`.'),
    TOTAL_TIMEOUT_MS
  );

  function cleanup() {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  }

  function stopStream() {
    try {
      handle?.cancel();
    } catch {
      // Socket is already gone; nothing to do.
    }
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => fail('No data received for 60 seconds; the connection appears to be stalled.'),
      IDLE_TIMEOUT_MS
    );
  }

  function fail(message: string) {
    if (finished) {
      return;
    }
    finished = true;
    cleanup();
    stopStream();
    onError?.(message);
  }

  function complete() {
    if (finished) {
      return;
    }
    finished = true;
    cleanup();
    stopStream();

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(base64);
    } catch {
      onError?.('The container returned data that could not be decoded.');
      return;
    }

    const filename = suggestFilename(target);
    saveBlob(bytes, filename);
    onDone?.({ filename, bytes: bytes.length });
  }

  function handleStatus(text: string) {
    let status: { status?: string; message?: string };
    try {
      status = JSON.parse(text);
    } catch {
      fail(describeExecError(text));
      return;
    }

    if (status.status === 'Success') {
      complete();
      return;
    }
    fail(describeExecError(stderr || status.message || ''));
  }

  function onFrame(data: unknown) {
    if (finished) {
      return;
    }

    const protocol = handle?.getSocket()?.protocol ?? '';
    const frame = parseFrame(data, protocol);
    if (!frame) {
      return;
    }

    resetIdleTimer();

    switch (frame.channel) {
      case 'stdout': {
        // GNU base64 wraps at 76 columns, BusyBox does not wrap. Whitespace is
        // not part of the payload, so dropping it per frame is safe.
        const chunk = frame.text.replace(/[\r\n\t ]/g, '');
        if (chunk === '') {
          return;
        }
        base64 += chunk;
        received = Math.floor((base64.length * 3) / 4);
        onProgress?.(received);
        if (received > MAX_DOWNLOAD_BYTES) {
          fail('File is too large to download in the browser. Use `kubectl cp` for large files.');
        }
        return;
      }
      case 'stderr': {
        stderr = `${stderr}${frame.text}`.slice(-MAX_STDERR);
        return;
      }
      case 'status': {
        handleStatus(frame.text);
        return;
      }
      default:
        return;
    }
  }

  try {
    handle = pod.exec(container, onFrame, {
      command: ['base64', target],
      tty: false,
      stdin: false,
      stdout: true,
      stderr: true,
      reconnectOnFailure: false,
      failCb: () => fail(describeExecError(stderr || 'Connection to the container closed.')),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(describeExecError(message));
    return { cancel: () => undefined };
  }

  resetIdleTimer();

  return {
    cancel: () => fail(CANCEL_MESSAGE),
  };
}
