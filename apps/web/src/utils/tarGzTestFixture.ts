import { gzipSync } from 'node:zlib';

/**
 * Builds a gzipped ustar archive shaped like GitHub's repository tarballs, for
 * tests only: a global pax header first, pax `path` records for long names.
 */
export interface TarFixtureEntry {
  name: string;
  content?: string;
  type?: string;
  linkname?: string;
}

function header(name: string, size: number, type: string, linkname = ''): Buffer {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, 'utf8');
  block.write('0000644\0', 100);
  block.write('0000000\0', 108);
  block.write('0000000\0', 116);
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  block.write('00000000000\0', 136);
  block.write('        ', 148);
  block.write(type, 156);
  block.write(linkname, 157);
  block.write('ustar\0', 257);
  block.write('00', 263);
  let checksum = 0;
  for (const byte of block) checksum += byte;
  block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

function padded(content: Buffer): Buffer {
  const remainder = content.length % 512;
  return remainder === 0 ? content : Buffer.concat([content, Buffer.alloc(512 - remainder)]);
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (`${length}${body}`.length !== length) length = `${length}${body}`.length;
  return `${length}${body}`;
}

export function tarGz(entries: TarFixtureEntry[]): Buffer {
  const parts: Buffer[] = [
    // GitHub opens every tarball with a global pax header holding the commit.
    header('pax_global_header', 52, 'g'),
    padded(Buffer.from(paxRecord('comment', 'f4ecb7167e89415c23cf1eaffc7c7cc1876c34b9'))),
  ];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? '');
    const type = entry.type ?? '0';
    if (entry.name.length > 100) {
      const pax = Buffer.from(paxRecord('path', entry.name));
      parts.push(header('PaxHeader', pax.length, 'x'), padded(pax));
    }
    parts.push(header(entry.name, type === '0' ? content.length : 0, type, entry.linkname));
    if (type === '0') parts.push(padded(content));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
