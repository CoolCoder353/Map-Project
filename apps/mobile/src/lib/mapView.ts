import type { LngLat } from '@wayfinder/shared/geo';

/** The last view any map showed, so a feedback report can include it if the user agrees. */
let last: { center: LngLat; zoom: number } | null = null;

export function rememberMapView(bounds: [number, number, number, number], zoom: number) {
  const [w, s, e, n] = bounds;
  last = { center: [Number(((w + e) / 2).toFixed(5)), Number(((s + n) / 2).toFixed(5))], zoom: Number(zoom.toFixed(2)) };
}

export const lastMapView = () => last;
