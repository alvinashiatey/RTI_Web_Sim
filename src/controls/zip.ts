// ── Minimal store-only ZIP builder (zero dependencies) ───

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

let _crc32Table: Uint32Array | null = null;

function _crc32(data: Uint8Array): number {
  if (!_crc32Table) {
    _crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      _crc32Table[i] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = _crc32Table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build an uncompressed (store-only) ZIP file from named binary entries.
 * PNGs are already compressed, so store is optimal — no extra CPU cost.
 */
export function buildZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = _crc32(entry.data);
    const size = entry.data.length;

    // Local file header (30 + name length)
    const local = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // compression: store
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    new Uint8Array(local).set(nameBytes, 30);
    localParts.push(new Uint8Array(local), entry.data);

    // Central directory header (46 + name length)
    const central = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(10, 0, true); // compression: store
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // local header offset
    new Uint8Array(central).set(nameBytes, 46);
    centralParts.push(new Uint8Array(central));

    offset += 30 + nameBytes.length + size;
  }

  const centralDirSize = centralParts.reduce((s, c) => s + c.length, 0);

  // End of central directory record (22 bytes)
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, offset, true);

  const parts: BlobPart[] = [];
  for (const p of localParts) parts.push(p as unknown as BlobPart);
  for (const c of centralParts) parts.push(c as unknown as BlobPart);
  parts.push(new Uint8Array(eocd) as unknown as BlobPart);

  return new Blob(parts, { type: "application/zip" });
}
