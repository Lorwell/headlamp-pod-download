import { ActionButton } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Dialog, DialogContent, DialogTitle } from '@mui/material';
import React from 'react';
import type { PodLike } from './download';
import { DownloadForm } from './DownloadForm';
import { useT } from './i18n';

export interface DownloadActionProps {
  pod: PodLike;
}

/**
 * Header action shown next to the terminal icon on a Pod page. Clicking it
 * opens the download dialog.
 */
export function DownloadAction({ pod }: DownloadActionProps) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const isRunning = pod.status?.phase === 'Running';

  return (
    <>
      <ActionButton
        description={t('Download file')}
        icon="mdi:file-download"
        onClick={() => setOpen(true)}
        iconButtonProps={{ disabled: !isRunning }}
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="pod-download-dialog-title"
      >
        <DialogTitle id="pod-download-dialog-title">{t('Download file')}</DialogTitle>
        <DialogContent dividers>
          <DownloadForm pod={pod} />
        </DialogContent>
      </Dialog>
    </>
  );
}
