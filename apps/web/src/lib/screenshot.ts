import { domToCanvas } from 'modern-screenshot';
import type { MapApi } from '../map/MapProvider';

const MAX_WIDTH = 1600;

/**
 * A picture of what the user is looking at: the WebGL map (which a DOM capture can't see) with
 * the panels and controls drawn over it. Downscaled and encoded as WebP (JPEG as a fallback).
 */
export async function captureScreen(map: MapApi): Promise<Blob | null> {
  const root = document.querySelector<HTMLElement>('.map-shell');
  if (!root) return null;
  const bounds = root.getBoundingClientRect();
  const [mapShot, ui] = await Promise.all([
    map.captureMap(),
    domToCanvas(root, {
      scale: 1,
      // The map is drawn separately; leave its area transparent here.
      filter: (node) => !(node instanceof HTMLElement && node.classList.contains('map-canvas')),
      style: { background: 'transparent' },
    }),
  ]);
  const scale = Math.min(1, MAX_WIDTH / bounds.width);
  const out = document.createElement('canvas');
  out.width = Math.round(bounds.width * scale);
  out.height = Math.round(bounds.height * scale);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  if (mapShot) {
    const r = mapShot.rect;
    ctx.drawImage(mapShot.image, (r.left - bounds.left) * scale, (r.top - bounds.top) * scale, r.width * scale, r.height * scale);
  }
  ctx.drawImage(ui, 0, 0, out.width, out.height);
  return encode(out);
}

/** Re-encode a user-chosen image the same way, so uploads stay small. */
export async function shrinkImage(file: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const out = document.createElement('canvas');
  out.width = Math.round(bitmap.width * scale);
  out.height = Math.round(bitmap.height * scale);
  out.getContext('2d')!.drawImage(bitmap, 0, 0, out.width, out.height);
  return encode(out);
}

async function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const blob = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await blob('image/webp', 0.82);
  // Browsers that can't encode WebP hand back PNG instead.
  return webp?.type === 'image/webp' ? webp : blob('image/jpeg', 0.85);
}

export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
