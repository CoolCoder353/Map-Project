import { FEEDBACK_SCREENSHOT_MAX_BYTES, FEEDBACK_TYPE_LABEL, type FeedbackCreate, type FeedbackType } from '@wayfinder/shared';
import { Bug, ImagePlus, Lightbulb, MessageSquare, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { shrinkImage, toBase64 } from '../lib/screenshot';
import { useToast } from '../lib/toast';
import type { MapApi } from '../map/MapProvider';

const TYPES: Array<{ id: FeedbackType; icon: typeof Bug }> = [
  { id: 'bug', icon: Bug },
  { id: 'idea', icon: Lightbulb },
  { id: 'other', icon: MessageSquare },
];

interface Props {
  open: boolean;
  /** Captured before the dialog opened, so it shows the screen, not the form. */
  screenshot: Blob | null;
  map: MapApi;
  onClose(): void;
}

export function FeedbackDialog({ open, screenshot: captured, map, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const toast = useToast();
  const location = useLocation();
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [includeMap, setIncludeMap] = useState(false);
  const [shot, setShot] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (shot ? URL.createObjectURL(shot) : null), [shot]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setType('bug');
      setMessage('');
      setIncludeMap(false);
      setShot(captured);
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, captured]);

  const replace = async (file: File | undefined) => {
    if (!file) return;
    const small = await shrinkImage(file);
    if (!small) setError('That file isn’t an image we can read.');
    else setShot(small);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (shot && shot.size > FEEDBACK_SCREENSHOT_MAX_BYTES) throw new Error('The screenshot is over 2 MB. Remove it or choose a smaller image.');
      const view = includeMap ? map.view() : null;
      const body: FeedbackCreate = {
        type,
        message,
        context: {
          // The path only: query strings can hold the places someone is planning between.
          screen: location.pathname,
          platform: 'web',
          appVersion: __APP_VERSION__,
          device: navigator.userAgent.slice(0, 400),
          ...(view ? { mapView: view } : {}),
        },
        ...(shot ? { screenshot: { mediaType: shot.type as 'image/webp' | 'image/jpeg' | 'image/png', data: await toBase64(shot) } } : {}),
      };
      await api('/api/feedback', { method: 'POST', body });
      toast('Thanks — your feedback was sent.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog feedback-dialog" aria-labelledby={`${id}-title`} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }}>
        <h2 id={`${id}-title`} className="dialog-title">Send feedback</h2>
        <div className="segmented" role="radiogroup" aria-label="Kind of feedback">
          {TYPES.map(({ id: t, icon: Icon }) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}>
              <Icon aria-hidden /> {FEEDBACK_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-message`}>
            {type === 'bug' ? 'What went wrong?' : type === 'idea' ? 'What would you like?' : 'Your message'}
          </label>
          <textarea
            id={`${id}-message`}
            className="input textarea"
            rows={5}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={type === 'bug' ? 'What you did, what you expected, and what happened instead.' : ''}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <span className="field-label">Screenshot</span>
          {preview ? (
            <figure className="feedback-shot">
              <img src={preview} alt="Screenshot that will be sent" />
              <div className="feedback-shot-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                  <ImagePlus aria-hidden /> Replace
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShot(null)}>
                  <Trash2 aria-hidden /> Remove
                </button>
              </div>
            </figure>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm feedback-add-shot" onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden /> Add an image
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void replace(e.target.files?.[0])} />
        </div>
        <label className="check">
          <input type="checkbox" checked={includeMap} onChange={(e) => setIncludeMap(e.target.checked)} />
          <span>
            Include what the map is showing
            <span className="field-hint">The map’s centre and zoom. Nothing else about where you are is sent.</span>
          </span>
        </label>
        <p className="field-hint">Also sent: this page, your browser and the app version.</p>
        {error && <p className="field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || message.trim().length < 3}>
            {busy && <span className="spinner" aria-hidden />}
            Send
          </button>
        </div>
      </form>
    </dialog>
  );
}
