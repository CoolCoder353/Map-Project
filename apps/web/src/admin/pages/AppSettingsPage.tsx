import { COPY, type Voice } from '@wayfinder/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { configQueryKey } from '../../lib/config';
import { useToast } from '../../lib/toast';
import { useAppSettings, useIsAdmin } from '../hooks';
import { PageHeader, QueryState } from './common';

const VOICES: Array<{ id: Voice; label: string; description: string }> = [
  { id: 'plain', label: 'Plain and friendly', description: 'Clear, calm, a little warm.' },
  { id: 'playful', label: 'Playful explorer', description: 'Adventure flavour in prompts and empty states.' },
  { id: 'minimal', label: 'Minimal and technical', description: 'Terse labels, numbers first.' },
];

export function AppSettingsPage() {
  const settings = useAppSettings();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const [appName, setAppName] = useState('');
  const [voice, setVoice] = useState<Voice>('plain');
  useEffect(() => {
    if (settings.data) {
      setAppName(settings.data.appName);
      setVoice(settings.data.voice);
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api('/api/admin/app-settings', { method: 'PATCH', body: { appName, voice } }),
    onSuccess: () => {
      toast('Saved. Everyone sees the change within a minute.');
      void qc.invalidateQueries({ queryKey: configQueryKey });
      void qc.invalidateQueries({ queryKey: ['admin', 'app-settings'] });
    },
  });
  const dirty = settings.data && (appName.trim() !== settings.data.appName || voice !== settings.data.voice);
  const sample = COPY[voice];

  return (
    <>
      <PageHeader title="App settings" description="The app’s name and the tone of its wording, for everyone on web and Android." />
      <QueryState isLoading={settings.isLoading} error={settings.error}>
        <form
          className="admin-section settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label className="field">
            <span className="field-label">App name</span>
            <input className="input" value={appName} maxLength={40} onChange={(e) => setAppName(e.target.value)} disabled={!isAdmin} required />
            <span className="field-hint">Shown in the header, sign-in page, browser tab and Android app.</span>
          </label>
          <fieldset className="field voice-options" disabled={!isAdmin}>
            <legend className="field-label">Voice</legend>
            {VOICES.map((v) => (
              <label key={v.id} className={`voice-option ${voice === v.id ? 'is-selected' : ''}`}>
                <input type="radio" name="voice" value={v.id} checked={voice === v.id} onChange={() => setVoice(v.id)} />
                <span>
                  <strong>{v.label}</strong>
                  <span className="field-hint" style={{ display: 'block' }}>{v.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="voice-preview" aria-live="polite">
            <p className="field-label">Preview</p>
            <ul>
              <li><span className="muted">Search box</span> {sample.searchPlaceholder}</li>
              <li><span className="muted">Route badge</span> <span className="badge badge-new">{sample.newKm(4.2)}</span></li>
              <li><span className="muted">Explore heading</span> {sample.exploreHeading}</li>
              <li><span className="muted">No trips yet</span> {sample.tripsEmpty}</li>
            </ul>
            <p className="field-hint">Buttons, errors and this dashboard always stay plain.</p>
          </div>
          {save.error && <p className="notice notice-error">{errorMessage(save.error)}</p>}
          {isAdmin ? (
            <div>
              <button type="submit" className="btn btn-primary" disabled={!dirty || save.isPending || !appName.trim()}>
                {save.isPending && <span className="spinner" aria-hidden />} Save changes
              </button>
            </div>
          ) : (
            <p className="field-hint">Only admins can change these.</p>
          )}
        </form>
      </QueryState>
    </>
  );
}
