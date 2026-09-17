import type { Mode } from '@wayfinder/shared';
import { Car, Footprints } from 'lucide-react';

export function ModeToggle({ value, onChange, label = 'Travel mode' }: { value: Mode; onChange(m: Mode): void; label?: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      <button type="button" role="radio" aria-checked={value === 'car'} onClick={() => onChange('car')}>
        <Car aria-hidden /> Drive
      </button>
      <button type="button" role="radio" aria-checked={value === 'foot'} onClick={() => onChange('foot')}>
        <Footprints aria-hidden /> Walk
      </button>
    </div>
  );
}
