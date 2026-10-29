/**
 * Decoding of the frames that arrive over the Kubernetes exec websocket.
 *
 * Headlamp connects with the `base64.binary.k8s.io` protocol, so a message is
 * usually a base64 string that decodes to `<channel byte><payload>`. If the API
 * server does not negotiate that protocol the message arrives as raw bytes with
 * the same layout. Both cases are handled here.
 *
 * Channel bytes: 1 = stdout, 2 = stderr, 3 = status (JSON).
 */

export type FrameChannel = 'stdout' | 'stderr' | 'status' | 'unknown';

export interface Frame {
  channel: FrameChannel;
  text: string;
}

const STDOUT = 1;
const STDERR = 2;
const STATUS = 3;

const BASE64_PROTOCOL = 'base64.binary.k8s.io';
const decoder = new TextDecoder('utf-8');

function channelOf(byte: number): FrameChannel {
  switch (byte) {
    case STDOUT:
      return 'stdout';
    case STDERR:
      return 'stderr';
    case STATUS:
      return 'status';
    default:
      return 'unknown';
  }
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

function decodeBase64(input: string): Uint8Array | null {
  try {
    return base64ToBytes(input);
  } catch {
    return null;
  }
}

/**
 * Turn one websocket message into a channel + text pair.
 *
 * @param data     raw websocket message (ArrayBuffer, typed array or string)
 * @param protocol the negotiated websocket subprotocol, if known
 */
export function parseFrame(data: unknown, protocol = ''): Frame | null {
  const bytes = toBytes(data);

  if (bytes) {
    if (bytes.length === 0) {
      return null;
    }
    return { channel: channelOf(bytes[0]), text: decoder.decode(bytes.subarray(1)) };
  }

  if (typeof data === 'string') {
    if (data.length === 0) {
      return null;
    }

    const wantsBase64 = protocol === '' || protocol.includes(BASE64_PROTOCOL);
    if (wantsBase64) {
      const decoded = decodeBase64(data);
      if (decoded && decoded.length > 0 && decoded[0] >= STDOUT && decoded[0] <= STATUS) {
        return { channel: channelOf(decoded[0]), text: decoder.decode(decoded.subarray(1)) };
      }
    }

    // A text message without the channel prefix. Only trust it as stdout when
    // the server explicitly did not negotiate the base64 protocol.
    if (protocol !== '' && !protocol.includes(BASE64_PROTOCOL)) {
      return { channel: 'stdout', text: data };
    }

    return { channel: 'unknown', text: data };
  }

  return null;
}

/**
 * Decode base64 content that may be wrapped at any column (GNU coreutils wraps
 * at 76 characters, BusyBox does not wrap at all). Whitespace is ignored.
 */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[\r\n\t ]/g, '');
  if (clean.length === 0) {
    return new Uint8Array(0);
  }

  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** True when the frame carries no usable payload. */
export function isEmptyFrame(frame: Frame | null): boolean {
  return frame === null || (frame.channel === 'unknown' && frame.text === '');
}
