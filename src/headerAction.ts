import { DetailsViewDefaultHeaderActions } from '@kinvolk/headlamp-plugin/lib';
import type React from 'react';

/** Id of our entry in the details view header action list. */
export const DOWNLOAD_ACTION_ID = 'pod-download';

export interface HeaderActionLike {
  id: string;
  action?: unknown;
}

/**
 * Insert the download action right after Headlamp's terminal icon, so the
 * button sits next to the action it complements. Falls back to the end of the
 * list when the terminal action is not present (e.g. other resource kinds).
 */
export function insertDownloadAction<T extends HeaderActionLike>(
  actions: T[],
  action: React.ReactNode
): T[] {
  if (actions.some(entry => entry.id === DOWNLOAD_ACTION_ID)) {
    return actions;
  }

  const entry = { id: DOWNLOAD_ACTION_ID, action } as T;
  const terminalIndex = actions.findIndex(
    item => item.id === DetailsViewDefaultHeaderActions.POD_TERMINAL
  );

  if (terminalIndex === -1) {
    return [...actions, entry];
  }

  return [...actions.slice(0, terminalIndex + 1), entry, ...actions.slice(terminalIndex + 1)];
}
