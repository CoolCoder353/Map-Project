export { formatDistanceShort, formatDuration } from '@wayfinder/nav';

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const formatNumber = (n: number) => n.toLocaleString('en-AU');
