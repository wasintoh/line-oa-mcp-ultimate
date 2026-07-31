/**
 * Minimal ZIP writer — packages the 5 imagemap size variants into a single
 * archive for the manual "handoff" fallback (the user hosts the files
 * themselves, e.g. via Netlify Drop).
 *
 * Non-obvious constraint enforced here: output must be byte-for-byte
 * DETERMINISTIC for identical input (fixed DOS timestamps, no per-run
 * metadata) so repeated prepares of the same image produce identical zips —
 * important for idempotent retries and testability. STORE only (method 0,
 * no compression — PNGs are already compressed), hand-rolled CRC-32
 * (polynomial 0xEDB88320), UTF-8 names, no zip64 (inputs are tiny).
 */

import { ImageHostError } from "./types.js";

// ---- CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320) ----

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 over a buffer. Exported for reuse/verification in tests. */
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- ZIP container (local headers → central directory → EOCD) ----

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** General-purpose flag bit 11: entry name is UTF-8. */
const FLAG_UTF8 = 0x0800;
/** Version 2.0 — the minimum that understands the format we emit. */
const VERSION = 20;

// Fixed DOS timestamp (1980-01-01 00:00:00) — keeps output deterministic.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // month=1, day=1, year=1980

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Build a STORE-method (no compression) zip from the given entries.
 * Throws ImageHostError on an empty entry list or an empty entry name —
 * a nameless or empty archive is always a caller bug.
 */
export function buildZip(entries: ZipEntry[]): Buffer {
  if (entries.length === 0) {
    throw new ImageHostError("buildZip: refusing to build an empty zip (no entries)", "input-invalid");
  }

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (!entry.name) {
      throw new ImageHostError("buildZip: entry has an empty name", "input-invalid");
    }
    const nameBytes = Buffer.from(entry.name, "utf8");
    if (nameBytes.length > 0xffff) {
      throw new ImageHostError(`buildZip: entry name too long: ${entry.name.slice(0, 40)}…`, "input-invalid");
    }
    const crc = crc32(entry.data);
    const size = entry.data.length; // STORE: compressed size === uncompressed size

    // Local file header (30 bytes fixed + name), then the raw data.
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // method 0 = STORE
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBytes, entry.data);

    // Central directory record (46 bytes fixed + name).
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION, 4); // version made by
    central.writeUInt16LE(VERSION, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(0, 10); // method 0 = STORE
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20); // compressed size
    central.writeUInt32LE(size, 24); // uncompressed size
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const centralDir = Buffer.concat(centralParts);

  // End of central directory (22 bytes, no comment).
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDir, eocd]);
}
