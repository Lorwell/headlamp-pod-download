import { registerDetailsViewHeaderActionsProcessor } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import type { PodLike } from './download';
import { DownloadAction } from './DownloadAction';
import { insertDownloadAction } from './headerAction';

/**
 * Adds a download icon to the Pod details header, right after the terminal.
 * Clicking it opens a dialog where the file path is entered.
 */
registerDetailsViewHeaderActionsProcessor((resource, actions) => {
  if (!resource || resource.kind !== 'Pod') {
    return actions;
  }
  return insertDownloadAction(actions, <DownloadAction pod={resource as unknown as PodLike} />);
});
