/**
 * Image file formats whose pixel size can be read from the header.
 *
 * @category Images
 */
export type ImageFormat = "png" | "jpeg" | "gif" | "webp";

/**
 * Format and pixel size of an image, as found in its header.
 *
 * @category Images
 */
export interface ImageInfo {
  /** Detected file format. */
  format: ImageFormat;
  /** Width in pixels; always above 0. */
  widthPx: number;
  /** Height in pixels; always above 0. */
  heightPx: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length &&
    prefix.every((byte, i) => bytes[i] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";

  for (let i = offset; i < offset + length; i++) {
    out += String.fromCharCode(bytes[i]);
  }

  return out;
}

function info(
  format: ImageFormat,
  widthPx: number,
  heightPx: number,
): ImageInfo | null {
  return widthPx > 0 && heightPx > 0 ? { format, widthPx, heightPx } : null;
}

function readPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return info("png", view.getUint32(16), view.getUint32(20));
}

function readGif(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 10) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return info("gif", view.getUint16(6, true), view.getUint16(8, true));
}

/** Index of the next JPEG marker code byte at or after `start` (skipping fill bytes), or -1 at end of data. */
function findJpegMarker(bytes: Uint8Array, start: number): number {
  let i = start;

  while (i < bytes.length && bytes[i] !== 0xff) {
    i++;
  }

  while (i < bytes.length && bytes[i] === 0xff) {
    i++;
  } // fill bytes

  return i < bytes.length ? i : -1;
}

/** Stuffed zero, TEM, RSTn and SOI carry no length. */
function isLengthlessJpegMarker(marker: number): boolean {
  return marker === 0x00 || marker === 0x01 || marker === 0xd8 ||
    (marker >= 0xd0 && marker <= 0xd7);
}

/** Start-of-frame markers (SOF0..SOF15 except DHT, JPG and DAC). */
function isJpegFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf &&
    marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** Size from a start-of-frame segment whose length field is at `at`: length(2) precision(1) height(2) width(2). */
function jpegFrameSize(
  view: DataView,
  at: number,
  length: number,
): ImageInfo | null {
  if (length < 7 || at + 7 > view.byteLength) {
    return null;
  }

  return info("jpeg", view.getUint16(at + 5), view.getUint16(at + 3));
}

function readJpeg(bytes: Uint8Array): ImageInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 2;

  for (;;) {
    const markerAt = findJpegMarker(bytes, i);

    if (markerAt < 0) {
      return null;
    }

    const marker = bytes[markerAt];

    i = markerAt + 1;

    if (isLengthlessJpegMarker(marker)) {
      continue;
    }

    if (marker === 0xd9 || i + 2 > bytes.length) {
      return null;
    }

    const length = view.getUint16(i);

    if (isJpegFrameMarker(marker)) {
      return jpegFrameSize(view, i, length);
    }

    if (length < 2) {
      return null;
    }

    i += length;
  }
}

/** Lossy WebP: frame tag (3), start code 9d 01 2a, then 14-bit width and height. */
function readWebpLossy(bytes: Uint8Array): ImageInfo | null {
  if (
    bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 ||
    bytes[25] !== 0x2a
  ) {
    return null;
  }

  return info(
    "webp",
    (bytes[26] | (bytes[27] << 8)) & 0x3fff,
    (bytes[28] | (bytes[29] << 8)) & 0x3fff,
  );
}

function readWebpLossless(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 25 || bytes[20] !== 0x2f) {
    return null;
  }

  const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) |
    (bytes[24] << 24)) >>> 0;

  return info("webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
}

function readWebpExtended(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 30) {
    return null;
  }

  return info(
    "webp",
    (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
    (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
  );
}

function readWebp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 21 || ascii(bytes, 8, 4) !== "WEBP") {
    return null;
  }

  switch (ascii(bytes, 12, 4)) {
    case "VP8 ":
      return readWebpLossy(bytes);
    case "VP8L":
      return readWebpLossless(bytes);
    case "VP8X":
      return readWebpExtended(bytes);
    default:
      return null;
  }
}

/**
 * Detects the format from the magic bytes and reads the pixel size from the
 * header, without decoding the image.
 *
 * @param bytes Contents of a PNG, JPEG, GIF or WebP file (at least its header).
 * @returns The format and size, or `null` when the format is unknown or the
 * header is truncated.
 * @category Images
 *
 * @example Read the size of a GIF
 * ```ts
 * import { readImageInfo } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * // "GIF89a", then width 3 and height 2 as little-endian 16-bit numbers.
 * const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 3, 0, 2, 0]);
 *
 * assertEquals(readImageInfo(gif), { format: "gif", widthPx: 3, heightPx: 2 });
 * assertEquals(readImageInfo(new Uint8Array(4)), null);
 * ```
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return readPng(bytes);
  }

  if (startsWith(bytes, [0xff, 0xd8])) {
    return readJpeg(bytes);
  }

  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return readGif(bytes);
  }

  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) {
    return readWebp(bytes);
  }

  return null;
}
