import { registerDetailsViewSection } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import type { PodLike } from './download';
import { DownloadSection } from './DownloadSection';

/**
 * Adds a "Download file" section to every Pod details page.
 *
 * The pod object handed to the section is the Headlamp resource instance, which
 * is what carries the `exec` helper used to read the file.
 */
registerDetailsViewSection(({ resource }) => {
  if (resource?.kind !== 'Pod') {
    return null;
  }
  return <DownloadSection pod={resource as unknown as PodLike} />;
});
