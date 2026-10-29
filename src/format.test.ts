import { describe, expect, it } from 'vitest';
import { describeExecError, formatBytes, suggestFilename } from './format';

describe('suggestFilename', () => {
  it('uses the last path segment', () => {
    expect(suggestFilename('/var/log/app.log')).toBe('app.log');
    expect(suggestFilename('/tmp/dump.sql.gz')).toBe('dump.sql.gz');
  });

  it('strips characters that are invalid in a download name', () => {
    expect(suggestFilename('/tmp/weird:name?.txt')).toBe('weird_name_.txt');
    expect(suggestFilename('/tmp/a"b<c>.txt')).toBe('a_b_c_.txt');
  });

  it('falls back when there is no usable name', () => {
    expect(suggestFilename('/')).toBe('download.bin');
    expect(suggestFilename('/tmp/..')).toBe('download.bin');
    expect(suggestFilename('')).toBe('download.bin');
  });
});

describe('formatBytes', () => {
  it('formats each unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MiB');
  });

  it('is defensive about bad input', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('describeExecError', () => {
  it('explains a missing file', () => {
    expect(describeExecError('base64: /tmp/nope: No such file or directory')).toMatch(
      /File not found/
    );
  });

  it('explains a directory', () => {
    expect(describeExecError('base64: /tmp: Is a directory')).toMatch(/directory/);
  });

  it('explains missing base64', () => {
    expect(describeExecError('exec: "base64": executable file not found in $PATH')).toMatch(
      /no `base64` binary/
    );
  });

  it('explains permission problems', () => {
    expect(describeExecError('base64: /root/secret: Permission denied')).toMatch(
      /Permission denied/
    );
    expect(describeExecError('pods "x" is forbidden')).toMatch(/not allowed to exec/);
  });

  it('passes unknown output through and truncates it', () => {
    expect(describeExecError('boom')).toBe('boom');
    expect(describeExecError('')).toMatch(/unknown error/);
    expect(describeExecError('x'.repeat(500)).length).toBeLessThanOrEqual(301);
  });
});
