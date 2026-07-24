/**
 * Minimal ZIP reader — just enough to pull TTF files out of the official
 * LINE Seed font archive (stored with method 0 or deflate/method 8).
 *
 * Deliberately dependency-free: Node's zlib.inflateRawSync handles deflate,
 * and the ZIP container format is parsed by hand (EOCD → central directory →
 * local headers). Not a general-purpose unzipper — no zip64, no encryption —
 * but fails loudly instead of silently corrupting data.
 */

import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * Extract entries whose full name matches `wanted`. Returns a map of
 * entry name → decompressed bytes. Throws on structural corruption.
 */
export function extractZipEntries(
  zip: Buffer,
  wanted: (name: string) => boolean,
): Map<string, Buffer> {
  // Find End Of Central Directory (scan backwards; comment can pad the tail).
  let eocd = -1;
  const scanStart = Math.max(0, zip.length - 22 - 65_535);
  for (let i = zip.length - 22; i >= scanStart; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: end-of-central-directory not found");

  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  const out = new Map<string, Buffer>();
  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new Error("ZIP: bad central-directory signature");
    }
    const method = zip.readUInt16LE(offset + 10);
    const compSize = zip.readUInt32LE(offset + 20);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLen);

    if (wanted(name)) {
      if (zip.readUInt32LE(localOffset) !== LOCAL_SIG) {
        throw new Error(`ZIP: bad local header for ${name}`);
      }
      const localNameLen = zip.readUInt16LE(localOffset + 26);
      const localExtraLen = zip.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = zip.subarray(dataStart, dataStart + compSize);
      if (method === 0) {
        out.set(name, Buffer.from(raw));
      } else if (method === 8) {
        out.set(name, inflateRawSync(raw));
      } else {
        throw new Error(`ZIP: unsupported compression method ${method} for ${name}`);
      }
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
