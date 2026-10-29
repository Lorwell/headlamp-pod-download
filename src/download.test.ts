import { describe, expect, it, vi } from 'vitest';
import { downloadPodFile, PodLike } from './download';
import type { StreamSink } from './sink';

function frame(channel: number, text: string): ArrayBuffer {
  const payload = new TextEncoder().encode(text);
  const bytes = new Uint8Array(payload.length + 1);
  bytes[0] = channel;
  bytes.set(payload, 1);
  return bytes.buffer;
}

function fakePod(frames: ArrayBuffer[]): PodLike {
  return {
    exec: (_container: string, onFrame: (data: unknown) => void) => {
      frames.forEach(item => onFrame(item));
      return { cancel: vi.fn(), getSocket: () => ({ protocol: 'v4.channel.k8s.io' }) };
    },
  } as unknown as PodLike;
}

function collectingSink() {
  const state = { bytes: [] as number[], closed: false, aborted: false };
  const sink: StreamSink = {
    write: async chunk => {
      state.bytes.push(...chunk);
    },
    close: async () => {
      state.closed = true;
    },
    abort: async () => {
      state.aborted = true;
    },
  };
  return { state, sink };
}

describe('downloadPodFile', () => {
  it('streams decoded bytes into the sink and closes it', async () => {
    const { state, sink } = collectingSink();
    const encoded = btoa('hello world');
    const onDone = vi.fn();

    const pod = fakePod([
      frame(1, encoded.slice(0, 3)),
      frame(1, encoded.slice(3)),
      frame(3, '{"status":"Success"}'),
    ]);

    downloadPodFile({
      pod,
      container: 'app',
      path: '/tmp/hello.txt',
      sink,
      onDone,
    });

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(new TextDecoder().decode(new Uint8Array(state.bytes))).toBe('hello world');
    expect(state.closed).toBe(true);
    expect(onDone).toHaveBeenCalledWith({ filename: 'hello.txt', bytes: 11 });
  });

  it('reports stderr when the container command fails', async () => {
    const { state, sink } = collectingSink();
    const onError = vi.fn();

    const pod = fakePod([
      frame(2, 'base64: /tmp/nope: No such file or directory'),
      frame(3, '{"status":"Failure","message":"command terminated with exit code 1"}'),
    ]);

    downloadPodFile({
      pod,
      container: 'app',
      path: '/tmp/nope',
      sink,
      onError,
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0]).toMatch(/File not found/);
    expect(state.aborted).toBe(true);
  });

  it('aborts the sink when the download is cancelled', async () => {
    const { state, sink } = collectingSink();
    let deliver: ((data: unknown) => void) | undefined;

    const pod = {
      exec: (_container: string, onFrame: (data: unknown) => void) => {
        deliver = onFrame;
        return { cancel: vi.fn(), getSocket: () => ({ protocol: 'v4.channel.k8s.io' }) };
      },
    } as unknown as PodLike;

    const onError = vi.fn();
    const handle = downloadPodFile({
      pod,
      container: 'app',
      path: '/tmp/big.bin',
      sink,
      onError,
    });

    deliver?.(frame(1, btoa('abc')));
    handle.cancel();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Download cancelled.'));
    expect(state.aborted).toBe(true);
  });

  it('buffers into a blob when no sink is given', async () => {
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const onDone = vi.fn();
    const pod = fakePod([frame(1, btoa('hello')), frame(3, '{"status":"Success"}')]);

    downloadPodFile({ pod, container: 'app', path: '/tmp/a.txt', onDone });

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('rejects an invalid path before touching the cluster', () => {
    const exec = vi.fn();
    const onError = vi.fn();

    downloadPodFile({
      pod: { exec } as unknown as PodLike,
      container: 'app',
      path: 'relative/path',
      onError,
    });

    expect(exec).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toMatch(/absolute path/);
  });
});
