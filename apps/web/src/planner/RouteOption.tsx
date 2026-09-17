import type { Route } from '@wayfinder/shared';
import { ArrowLeft, ArrowRight, ArrowUp, CornerUpLeft, CornerUpRight, Flag, MapPin, MoveUpLeft, MoveUpRight, RotateCcw, Send, Sparkles, Zap } from 'lucide-react';
import { useState } from 'react';
import { formatDistanceShort, formatDuration } from '../lib/format';
import { useAppConfig } from '../lib/config';

const signIcon = (sign: number) => {
  if (sign === 4) return Flag;
  if (sign === 5) return MapPin;
  if (sign === 6) return RotateCcw;
  if (sign === -8 || sign === 8 || sign === -98) return RotateCcw;
  if (sign === -1 || sign === -7) return MoveUpLeft;
  if (sign === 1 || sign === 7) return MoveUpRight;
  if (sign === -2) return ArrowLeft;
  if (sign === 2) return ArrowRight;
  if (sign === -3) return CornerUpLeft;
  if (sign === 3) return CornerUpRight;
  return ArrowUp;
};

interface Props {
  route: Route;
  title: string;
  selected: boolean;
  onSelect(): void;
  onSend?: (() => void) | undefined;
  sending?: boolean;
  hovered?: boolean;
  onHover?: ((hovering: boolean) => void) | undefined;
}

export function RouteOption({ route, title, selected, onSelect, onSend, sending, hovered, onHover }: Props) {
  const { copy } = useAppConfig();
  const [showSteps, setShowSteps] = useState(false);
  const isFastest = route.kind === 'fastest';
  return (
    <li
      className={`route-option ${selected ? 'is-selected' : ''} ${hovered ? 'is-hovered' : ''} route-${route.kind}`}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <button type="button" className="route-option-main" aria-pressed={selected} onClick={onSelect}>
        <span className="route-option-swatch" aria-hidden>
          {isFastest ? <Zap /> : <Sparkles />}
        </span>
        <span className="route-option-body">
          <span className="route-option-title">{title}</span>
          <span className="route-option-meta num">
            {formatDistanceShort(route.distanceM)}
            {route.novelty.newKm > 0.05 && (
              <span className="badge badge-new">{copy.newKm(route.novelty.newKm)}</span>
            )}
          </span>
        </span>
        <span className="route-option-time num">
          <strong>{formatDuration(route.durationS)}</strong>
          {!isFastest && route.extraDurationS > 30 && <span>+{formatDuration(route.extraDurationS)}</span>}
        </span>
      </button>
      {selected && (
        <div className="route-option-detail">
          <div className="route-option-actions">
            {onSend && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onSend} disabled={sending}>
                {sending ? <span className="spinner" aria-hidden /> : <Send aria-hidden />} Send to phone
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowSteps((s) => !s)} aria-expanded={showSteps}>
              {showSteps ? 'Hide steps' : `${route.instructions.length} steps`}
            </button>
          </div>
          {showSteps && (
            <ol className="steps">
              {route.instructions.map((ins, i) => {
                const Icon = signIcon(ins.sign);
                return (
                  <li key={i}>
                    <Icon aria-hidden />
                    <span>{ins.text}</span>
                    {ins.distanceM > 0 && <span className="num steps-dist">{formatDistanceShort(ins.distanceM)}</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}
