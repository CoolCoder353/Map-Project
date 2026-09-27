import { describe, expect, it, vi } from 'vitest';
import { captureScreen, shrinkImage, toBase64 } from '../src/lib/screenshot';
import { makeFakeMap } from './fakeMap';

describe('screenshots', () => {
  it('encodes bytes as base64 in chunks', async () => {
    const big = new Uint8Array(0x8000 * 2 + 3).map((_, i) => i % 256);
    const b64 = await toBase64(new Blob([big]));
    expect(Buffer.from(b64, 'base64').equals(Buffer.from(big))).toBe(true);
  });

  it('has nothing to capture off the map screen', async () => {
    await expect(captureScreen(makeFakeMap())).resolves.toBeNull();
  });

  it('refuses a file that isn’t an image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('not an image'); }));
    await expect(shrinkImage(new Blob(['text']))).resolves.toBeNull();
  });

  it('shrinks wide images to 1600 px and prefers WebP, falling back to JPEG', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3200, height: 1600 })));
    const sizes: Array<[number, number]> = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push([this.width, this.height]);
      return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    } as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type) => cb(new Blob(['x'], { type: type === 'image/webp' ? 'image/png' : type })));
    const out = await shrinkImage(new Blob(['img']));
    expect(sizes).toEqual([[1600, 800]]);
    expect(toBlob.mock.calls.map((c) => c[1])).toEqual(['image/webp', 'image/jpeg']);
    expect(out?.type).toBe('image/jpeg');
  });
});
