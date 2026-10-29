import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DownloadRequest, PodLike } from './download';
import { DownloadForm } from './DownloadForm';

// The real hook loads locale files through Headlamp's plugin i18n runtime, which
// does not exist in a unit test. Keep the keys and only do the interpolation.
vi.mock('./i18n', async importOriginal => {
  const actual = await importOriginal<typeof import('./i18n')>();
  return {
    ...actual,
    useT: () => (key: string, values?: Record<string, unknown>) =>
      actual.interpolate(key, values),
  };
});

function makePod(phase = 'Running'): PodLike {
  return {
    status: { phase },
    spec: { containers: [{ name: 'app' }, { name: 'sidecar' }] },
  } as unknown as PodLike;
}

describe('DownloadForm', () => {
  it('requires a path before downloading', () => {
    render(<DownloadForm pod={makePod()} runDownload={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/etc/hostname' } });
    expect(button.disabled).toBe(false);
  });

  it('downloads the requested path and reports the result', async () => {
    const requests: DownloadRequest[] = [];
    const runDownload = vi.fn((request: DownloadRequest) => {
      requests.push(request);
      request.onProgress?.(2048);
      request.onDone?.({ filename: 'hostname', bytes: 12 });
      return { cancel: vi.fn() };
    });

    render(<DownloadForm pod={makePod()} runDownload={runDownload} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/etc/hostname' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/etc/hostname');
    expect(requests[0].container).toBe('app');
    expect(await screen.findByText(/Saved hostname/)).toBeTruthy();
  });

  it('shows the error returned by the downloader', async () => {
    const runDownload = vi.fn((request: DownloadRequest) => {
      request.onError?.('File not found inside the container.');
      return { cancel: vi.fn() };
    });

    render(<DownloadForm pod={makePod()} runDownload={runDownload} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/tmp/nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(await screen.findByText('File not found inside the container.')).toBeTruthy();
  });

  it('hides the form when the pod is not running', () => {
    render(<DownloadForm pod={makePod('Succeeded')} runDownload={vi.fn()} />);

    expect(screen.getByText(/must be running/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
