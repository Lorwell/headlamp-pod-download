/**
 * Download a single file from a running container.
 *
 * The file is read with `base64 <path>` over the Kubernetes exec websocket that
 * Headlamp already proxies. Two destinations are supported:
 *
 * - a `StreamSink` (File System Access API): bytes are decoded per frame and
 *   written straight to disk, so the file size is not limited by browser memory;
 * - otherwise the parts are collected and saved as a Blob, which is bounded by
 *   `MAX_BUFFERED_BYTES`.
 *
 * No extra backend, no cluster writes.
 */

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { describeExecError, suggestFilename } from './format';
import { Base64StreamDecoder, parseFrame } from './frames';
import type { StreamSink } from './sink';

export type PodLike = InstanceType<typeof K8s.ResourceClasses.Pod>;

/** Largest file that can be assembled in browser memory (no File System Access API). */
export const MAX_BUFFERED_BYTES = 200 * 1024 * 1024;

/** Safety valve for streamed downloads; the real limit is the user's disk. */
export const MAX_STREAM_BYTES = 5 * 1024 * 1024 * 1024;

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
  /** When set, decoded bytes are written here instead of being buffered. */
  sink?: StreamSink;
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

function saveBlob(blob: Blob, filename: string): void {
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
  const { pod, container, path, sink, onProgress, onDone, onError } = request;
  const target = (path ?? '').trim();

  const invalid = validatePath(target);
  if (invalid) {
    onError?.(invalid);
    return { cancel: () => undefined };
  }

  const limit = sink ? MAX_STREAM_BYTES : MAX_BUFFERED_BYTES;
  const decoder = new Base64StreamDecoder();
  const chunks: Uint8Array[] = [];

  let finished = false;
  let writeFailed = false;
  let stderr = '';
  let received = 0;
  let pendingWrite: Promise<void> = Promise.resolve();
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
    void sink?.abort();
    onError?.(message);
  }

  /** Write one decoded part, keeping the order even when the sink is async. */
  function writePart(bytes: Uint8Array) {
    if (!sink) {
      chunks.push(bytes);
      return;
    }
    pendingWrite = pendingWrite.then(() => sink.write(bytes)).catch(() => {
      writeFailed = true;
      fail('Failed to write the file to disk.');
    });
  }

  async function complete() {
    if (finished) {
      return;
    }
    finished = true;
    cleanup();
    stopStream();

    try {
      await pendingWrite;
      if (writeFailed) {
        return;
      }

      let tail: Uint8Array;
      try {
        tail = decoder.flush();
      } catch {
        onError?.('The container returned data that could not be decoded.');
        return;
      }

      if (tail.length > 0) {
        received += tail.length;
        onProgress?.(received);
        if (sink) {
          await sink.write(tail);
        } else {
          chunks.push(tail);
        }
      }

      const filename = suggestFilename(target);
      if (sink) {
        await sink.close();
      } else {
        saveBlob(new Blob(chunks as BlobPart[], { type: 'application/octet-stream' }), filename);
      }
      onDone?.({ filename, bytes: received });
    } catch {
      onError?.('Failed to write the file to disk.');
    }
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
      void complete();
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
        let bytes: Uint8Array;
        try {
          bytes = decoder.push(frame.text);
        } catch {
          fail('The container returned data that could not be decoded.');
          return;
        }
        if (bytes.length === 0) {
          return;
        }

        received += bytes.length;
        onProgress?.(received);
        if (received > limit) {
          fail('File is too large to download in the browser. Use `kubectl cp` for large files.');
          return;
        }
        writePart(bytes);
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
