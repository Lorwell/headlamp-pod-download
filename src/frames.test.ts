import { describe, expect, it } from 'vitest';
import { base64ToBytes, parseFrame } from './frames';

const encoder = new TextEncoder();

function frameBytes(channel: number, payload: string): ArrayBuffer {
  const payloadBytes = encoder.encode(payload);
  const bytes = new Uint8Array(payloadBytes.length + 1);
  bytes[0] = channel;
  bytes.set(payloadBytes, 1);
  return bytes.buffer;
}

function base64Frame(channel: number, payload: string): string {
  const bytes = new Uint8Array(frameBytes(channel, payload));
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

describe('parseFrame', () => {
  it('reads binary frames', () => {
    const frame = parseFrame(frameBytes(1, 'aGVsbG8='), 'v4.channel.k8s.io');
    expect(frame).toEqual({ channel: 'stdout', text: 'aGVsbG8=' });
  });

  it('reads base64 encoded text frames', () => {
    const frame = parseFrame(base64Frame(1, 'aGVsbG8='), 'base64.binary.k8s.io');
    expect(frame).toEqual({ channel: 'stdout', text: 'aGVsbG8=' });
  });

  it('reads base64 encoded frames when the protocol is unknown', () => {
    const frame = parseFrame(base64Frame(2, 'base64: bad path'), '');
    expect(frame).toEqual({ channel: 'stderr', text: 'base64: bad path' });
  });

  it('reads the status frame', () => {
    const frame = parseFrame(base64Frame(3, '{"status":"Success"}'), 'base64.binary.k8s.io');
    expect(frame).toEqual({ channel: 'status', text: '{"status":"Success"}' });
  });

  it('falls back to plain text when the server did not negotiate base64', () => {
    const frame = parseFrame('plain text', 'v4.channel.k8s.io');
    expect(frame).toEqual({ channel: 'stdout', text: 'plain text' });
  });

  it('ignores empty frames', () => {
    expect(parseFrame(new ArrayBuffer(0), 'base64.binary.k8s.io')).toBeNull();
    expect(parseFrame('', 'base64.binary.k8s.io')).toBeNull();
    expect(parseFrame(undefined)).toBeNull();
  });
});

describe('base64ToBytes', () => {
  it('ignores the line wrapping added by coreutils', () => {
    const bytes = base64ToBytes('aGVs\nbG8g\nd29y\nbGQ=\n');
    expect(new TextDecoder().decode(bytes)).toBe('hello world');
  });

  it('round trips binary content', () => {
    const original = new Uint8Array([0x00, 0x01, 0xff, 0x80, 0x41]);
    let binary = '';
    original.forEach(byte => {
      binary += String.fromCharCode(byte);
    });
    expect(Array.from(base64ToBytes(btoa(binary)))).toEqual(Array.from(original));
  });

  it('returns an empty array for empty input', () => {
    expect(base64ToBytes('').length).toBe(0);
    expect(base64ToBytes(' \n\t').length).toBe(0);
  });

  it('throws on invalid base64', () => {
    expect(() => base64ToBytes('not base64!')).toThrow();
  });
});
