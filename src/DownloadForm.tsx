import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  CANCEL_MESSAGE,
  DownloadHandle,
  downloadPodFile,
  DownloadRequest,
  MAX_BUFFERED_BYTES,
  PodLike,
  validatePath,
} from './download';
import { formatBytes, suggestFilename } from './format';
import { useT } from './i18n';
import { createStreamSink, SaveCancelledError, StreamSink, supportsStreamingSave } from './sink';

export type DownloadRunner = (request: DownloadRequest) => DownloadHandle;

export interface DownloadFormProps {
  pod: PodLike;
  /** Injected in tests; defaults to the real exec based downloader. */
  runDownload?: DownloadRunner;
  /** Injected in tests; defaults to the File System Access API picker. */
  createSink?: (filename: string) => Promise<StreamSink>;
}

type Notice = { severity: 'info' | 'success' | 'error'; text: string };

export function DownloadForm({
  pod,
  runDownload = downloadPodFile,
  createSink = createStreamSink,
}: DownloadFormProps) {
  const t = useT();
  const containers: string[] = (pod.spec?.containers ?? []).map(container => container.name);
  const streaming = supportsStreamingSave();
  const [container, setContainer] = React.useState(containers[0] ?? '');
  const [path, setPath] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [received, setReceived] = React.useState(0);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const handle = React.useRef<DownloadHandle | null>(null);

  React.useEffect(() => () => handle.current?.cancel(), []);

  const isRunning = pod.status?.phase === 'Running';

  async function start() {
    if (busy) {
      return;
    }

    const invalid = validatePath(path);
    if (invalid) {
      setNotice({ severity: 'error', text: t(invalid) });
      return;
    }

    setNotice(null);
    setReceived(0);

    let sink: StreamSink | undefined;
    if (streaming) {
      try {
        // Must run inside the click gesture, before the exec stream opens.
        sink = await createSink(suggestFilename(path));
      } catch (error) {
        if (error instanceof SaveCancelledError) {
          return;
        }
        setNotice({ severity: 'error', text: t('Could not open the save dialog.') });
        return;
      }
    }

    setBusy(true);
    handle.current = runDownload({
      pod,
      container,
      path,
      sink,
      onProgress: bytes => setReceived(bytes),
      onDone: result => {
        handle.current = null;
        setBusy(false);
        setNotice({
          severity: 'success',
          text: t('Saved {{file}} ({{size}})', {
            file: result.filename,
            size: formatBytes(result.bytes),
          }),
        });
      },
      onError: message => {
        handle.current = null;
        setBusy(false);
        setNotice({
          severity: message === CANCEL_MESSAGE ? 'info' : 'error',
          text: t(message),
        });
      },
    });
  }

  function cancel() {
    handle.current?.cancel();
  }

  if (!isRunning) {
    return <Alert severity="info">{t('The pod must be running to download files.')}</Alert>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography variant="body2" color="text.secondary">
          {t(
            'Enter the absolute path of one file inside a container. The container needs a base64 binary and your account needs pods/exec. Directories are not supported.'
          )}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {streaming
            ? t('Streamed directly to disk, no practical size limit.')
            : t('Up to {{size}} (kept in browser memory).', {
                size: formatBytes(MAX_BUFFERED_BYTES),
              })}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {containers.length > 1 && (
          <TextField
            select
            size="small"
            label={t('Container')}
            value={container}
            onChange={event => setContainer(event.target.value)}
            disabled={busy}
            sx={{ minWidth: 180 }}
          >
            {containers.map(name => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
        )}

        <TextField
          size="small"
          label={t('File path')}
          placeholder="/var/log/app.log"
          value={path}
          onChange={event => setPath(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              void start();
            }
          }}
          disabled={busy}
          sx={{ flex: 1, minWidth: 240 }}
          inputProps={{ 'aria-label': 'File path' }}
        />

        {busy ? (
          <Button variant="outlined" onClick={cancel}>
            {t('Cancel')}
          </Button>
        ) : (
          <Button variant="contained" onClick={() => void start()} disabled={path.trim() === ''}>
            {t('Download')}
          </Button>
        )}
      </Box>

      {busy && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={16} />
          <Typography variant="body2">
            {t('Receiving… {{size}}', { size: formatBytes(received) })}
          </Typography>
        </Box>
      )}

      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
    </Box>
  );
}
