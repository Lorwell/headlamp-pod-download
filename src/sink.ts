/**
 * Streaming destination for large downloads.
 *
 * Browsers that implement the File System Access API (Chromium based) can write
 * the incoming bytes straight to the user's disk, so the size of the file is no
 * longer limited by the memory of the browser tab.
 */

export interface StreamSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface WritableLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<WritableLike>;
}

type SaveFilePicker = (options?: {
  suggestedName?: string;
}) => Promise<FileHandleLike>;

/** The user dismissed the save dialog; this is not an error. */
export class SaveCancelledError extends Error {
  constructor() {
    super('Save dialog cancelled');
    this.name = 'SaveCancelledError';
  }
}

function saveFilePicker(): SaveFilePicker | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
}

/** True when the browser can stream a download directly to disk. */
export function supportsStreamingSave(): boolean {
  return typeof saveFilePicker() === 'function';
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

/**
 * Ask the user where to save the file and return a sink that writes to it.
 *
 * Must be called from a user gesture (the click on the download button), before
 * the exec stream is opened.
 */
export async function createStreamSink(filename: string): Promise<StreamSink> {
  const picker = saveFilePicker();
  if (!picker) {
    throw new Error('The File System Access API is not available in this browser.');
  }

  let handle: FileHandleLike;
  try {
    handle = await picker({ suggestedName: filename });
  } catch (error) {
    if (isAbort(error)) {
      throw new SaveCancelledError();
    }
    throw error;
  }

  const writable = await handle.createWritable();

  return {
    write: chunk => writable.write(chunk),
    close: () => writable.close(),
    abort: async () => {
      try {
        await writable.abort();
      } catch {
        // The stream is already closed or aborted.
      }
    },
  };
}
