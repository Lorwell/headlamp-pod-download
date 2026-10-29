import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import type { PodLike } from './download';
import { DownloadForm, DownloadRunner } from './DownloadForm';

export interface DownloadSectionProps {
  pod: PodLike;
  /** Injected in tests; defaults to the real exec based downloader. */
  runDownload?: DownloadRunner;
}

/** The section shown at the bottom of a Pod details page. */
export function DownloadSection({ pod, runDownload }: DownloadSectionProps) {
  return (
    <SectionBox title="Download file">
      <DownloadForm pod={pod} runDownload={runDownload} />
    </SectionBox>
  );
}
