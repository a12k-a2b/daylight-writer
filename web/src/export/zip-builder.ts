/**
 * src/export/zip-builder.ts
 * Daylight Writer - Pure TypeScript Browser-Native PKZIP 2.0 Archive Generator
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 *
 * Implements STORE (Method 0) uncompressed packaging with IEEE 802.3 CRC-32
 * Zero external npm dependencies.
 */

export interface ZipEntry {
  path: string;
  data: Uint8Array | string;
}

/**
 * IEEE 802.3 32-bit Cyclic Redundancy Check
 */
export function crc32(buffer: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c ^= buffer[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Builds a valid uncompressed PKZIP 2.0 archive in a single Uint8Array.
 * Universally accepted by Microsoft Word, Google Docs, LibreOffice, unzip, etc.
 */
export function buildZipArchive(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const fileRecords: Array<{
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    offset: number;
  }> = [];

  let localHeadersSize = 0;
  let centralDirSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const dataBytes =
      typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(dataBytes);

    fileRecords.push({
      nameBytes,
      dataBytes,
      crc,
      offset: 0,
    });

    localHeadersSize += 30 + nameBytes.length + dataBytes.length;
    centralDirSize += 46 + nameBytes.length;
  }

  const eocdSize = 22;
  const totalSize = localHeadersSize + centralDirSize + eocdSize;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  let currentOffset = 0;

  // 1. Write Local File Headers & File Data
  for (const rec of fileRecords) {
    rec.offset = currentOffset;

    // Local Header Signature 0x04034B50 (PK\x03\x04)
    view.setUint32(currentOffset, 0x04034b50, true);
    view.setUint16(currentOffset + 4, 20, true); // Version needed (2.0)
    view.setUint16(currentOffset + 6, 0x0800, true); // Flags (UTF-8 filename)
    view.setUint16(currentOffset + 8, 0, true); // Compression: STORE (0)
    view.setUint16(currentOffset + 10, 0, true); // Mod time
    view.setUint16(currentOffset + 12, 0, true); // Mod date
    view.setUint32(currentOffset + 14, rec.crc, true); // CRC-32
    view.setUint32(currentOffset + 18, rec.dataBytes.length, true); // Compressed size
    view.setUint32(currentOffset + 22, rec.dataBytes.length, true); // Uncompressed size
    view.setUint16(currentOffset + 26, rec.nameBytes.length, true); // Filename length
    view.setUint16(currentOffset + 28, 0, true); // Extra field length

    currentOffset += 30;
    buffer.set(rec.nameBytes, currentOffset);
    currentOffset += rec.nameBytes.length;

    buffer.set(rec.dataBytes, currentOffset);
    currentOffset += rec.dataBytes.length;
  }

  const centralDirStartOffset = currentOffset;

  // 2. Write Central Directory Headers
  for (const rec of fileRecords) {
    // Central Header Signature 0x02014B50 (PK\x01\x02)
    view.setUint32(currentOffset, 0x02014b50, true);
    view.setUint16(currentOffset + 4, 20, true); // Version made by
    view.setUint16(currentOffset + 6, 20, true); // Version needed
    view.setUint16(currentOffset + 8, 0x0800, true); // Flags (UTF-8)
    view.setUint16(currentOffset + 10, 0, true); // Compression: STORE (0)
    view.setUint16(currentOffset + 12, 0, true); // Mod time
    view.setUint16(currentOffset + 14, 0, true); // Mod date
    view.setUint32(currentOffset + 16, rec.crc, true); // CRC-32
    view.setUint32(currentOffset + 20, rec.dataBytes.length, true); // Compressed size
    view.setUint32(currentOffset + 24, rec.dataBytes.length, true); // Uncompressed size
    view.setUint16(currentOffset + 28, rec.nameBytes.length, true); // Filename length
    view.setUint16(currentOffset + 30, 0, true); // Extra length
    view.setUint16(currentOffset + 32, 0, true); // Comment length
    view.setUint16(currentOffset + 34, 0, true); // Disk start
    view.setUint16(currentOffset + 36, 0, true); // Internal attributes
    view.setUint32(currentOffset + 38, 0, true); // External attributes
    view.setUint32(currentOffset + 42, rec.offset, true); // Relative offset of local header

    currentOffset += 46;
    buffer.set(rec.nameBytes, currentOffset);
    currentOffset += rec.nameBytes.length;
  }

  // 3. Write End of Central Directory Record (EOCD)
  // EOCD Signature 0x06054B50 (PK\x05\x06)
  view.setUint32(currentOffset, 0x06054b50, true);
  view.setUint16(currentOffset + 4, 0, true); // Disk number
  view.setUint16(currentOffset + 6, 0, true); // Start disk
  view.setUint16(currentOffset + 8, fileRecords.length, true); // Total entries on disk
  view.setUint16(currentOffset + 10, fileRecords.length, true); // Total entries
  view.setUint32(currentOffset + 12, centralDirSize, true); // Central dir size
  view.setUint32(currentOffset + 16, centralDirStartOffset, true); // Central dir offset
  view.setUint16(currentOffset + 20, 0, true); // Comment length

  return buffer;
}
