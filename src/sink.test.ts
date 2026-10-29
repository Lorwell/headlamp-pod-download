import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamSink, SaveCancelledError, supportsStreamingSave } from './sink';

const pickerWindow = window as unknown as { showSaveFilePicker?: unknown };

afterEach(() => {
  delete pickerWindow.showSaveFilePicker;
});

describe('supportsStreamingSave', () => {
  it('is false when the browser has no File System Access API', () => {
    expect(supportsStreamingSave()).toBe(false);
  });

  it('is true when showSaveFilePicker exists', () => {
    pickerWindow.showSaveFilePicker = vi.fn();
    expect(supportsStreamingSave()).toBe(true);
  });
});

describe('createStreamSink', () => {
  it('writes chunks to the picked file', async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);

    pickerWindow.showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close, abort }),
    }));

    const sink = await createStreamSink('app.log');
    await sink.write(new Uint8Array([1, 2, 3]));
    await sink.close();

    expect(pickerWindow.showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'app.log' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('maps a dismissed dialog to SaveCancelledError', async () => {
    pickerWindow.showSaveFilePicker = vi.fn(async () => {
      const error = new Error('cancelled');
      error.name = 'AbortError';
      throw error;
    });

    await expect(createStreamSink('app.log')).rejects.toBeInstanceOf(SaveCancelledError);
  });

  it('propagates other picker errors', async () => {
    pickerWindow.showSaveFilePicker = vi.fn(async () => {
      throw new Error('SecurityError');
    });

    await expect(createStreamSink('app.log')).rejects.toThrow('SecurityError');
  });
});
