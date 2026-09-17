import { open, stat, type FileHandle } from 'node:fs/promises';
import { Compression, PMTiles, type RangeResponse, type Source } from 'pmtiles';

class NodeFileSource implements Source {
  private handle: Promise<FileHandle>;
  constructor(private readonly path: string) {
    this.handle = open(path, 'r');
  }
  getKey() {
    return this.path;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const fh = await this.handle;
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, offset);
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead);
    return { data };
  }
  async close() {
    await (await this.handle).close();
  }
}

export interface TileArchive {
  getTile(z: number, x: number, y: number): Promise<{ data: Uint8Array; gzip: boolean } | null>;
  tileJson(tilesUrl: string): Promise<Record<string, unknown>>;
}

export function openTileArchive(path: string): TileArchive {
  const source = new NodeFileSource(path);
  const archive = new PMTiles(source);
  return {
    async getTile(z, x, y) {
      const header = await archive.getHeader();
      if (z < header.minZoom || z > header.maxZoom) return null;
      const tile = await archive.getZxy(z, x, y);
      if (!tile) return null;
      return { data: new Uint8Array(tile.data), gzip: header.tileCompression === Compression.Gzip };
    },
    async tileJson(tilesUrl) {
      const header = await archive.getHeader();
      const metadata = (await archive.getMetadata()) as Record<string, unknown>;
      return {
        tilejson: '3.0.0',
        tiles: [tilesUrl],
        minzoom: header.minZoom,
        maxzoom: header.maxZoom,
        bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
        center: [header.centerLon, header.centerLat, header.centerZoom],
        vector_layers: metadata.vector_layers ?? [],
        attribution: metadata.attribution ?? '© OpenStreetMap contributors',
      };
    },
  };
}

/**
 * A tile archive that tolerates the file not existing yet and reopens it when the data
 * pipeline swaps in a new version (checked at most every `checkMs`).
 */
export function reloadingTileArchive(path: string, checkMs = 30_000): TileArchive & { available(): Promise<boolean> } {
  let current: { archive: TileArchive; mtimeMs: number } | null = null;
  let lastCheck = 0;
  const refresh = async () => {
    if (Date.now() - lastCheck < checkMs && current) return current;
    lastCheck = Date.now();
    try {
      const s = await stat(path);
      if (!current || current.mtimeMs !== s.mtimeMs) current = { archive: openTileArchive(path), mtimeMs: s.mtimeMs };
    } catch {
      current = null;
    }
    return current;
  };
  return {
    async available() {
      return (await refresh()) !== null;
    },
    async getTile(z, x, y) {
      const c = await refresh();
      return c ? c.archive.getTile(z, x, y) : null;
    },
    async tileJson(url) {
      const c = await refresh();
      if (!c) throw new Error('Tiles unavailable');
      return c.archive.tileJson(url);
    },
  };
}
