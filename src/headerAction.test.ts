import { describe, expect, it } from 'vitest';
import { DOWNLOAD_ACTION_ID, HeaderActionLike, insertDownloadAction } from './headerAction';

const terminalFirst: HeaderActionLike[] = [
  { id: 'POD_LOGS' },
  { id: 'POD_TERMINAL' },
  { id: 'POD_DEBUG' },
];

describe('insertDownloadAction', () => {
  it('places the download action right after the terminal action', () => {
    const result = insertDownloadAction(terminalFirst, 'button');
    expect(result.map(entry => entry.id)).toEqual([
      'POD_LOGS',
      'POD_TERMINAL',
      DOWNLOAD_ACTION_ID,
      'POD_DEBUG',
    ]);
    expect(result[2].action).toBe('button');
  });

  it('appends the action when there is no terminal action', () => {
    const result = insertDownloadAction([{ id: 'POD_LOGS' }], 'button');
    expect(result.map(entry => entry.id)).toEqual(['POD_LOGS', DOWNLOAD_ACTION_ID]);
  });

  it('does not add the action twice', () => {
    const once = insertDownloadAction(terminalFirst, 'button');
    const twice = insertDownloadAction(once, 'button');
    expect(twice).toBe(once);
    expect(twice.filter(entry => entry.id === DOWNLOAD_ACTION_ID)).toHaveLength(1);
  });
});
