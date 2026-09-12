import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import type { GenerationOptions, GenerationSettings } from '../shared/types';
import { api, json } from './api';

const effortLabel = (effort: string) =>
  (({ xhigh: 'Extra high', max: 'Maximum' }) as Record<string, string>)[effort] ??
  effort.charAt(0).toUpperCase() + effort.slice(1);

export default function ModelSettings({
  open,
  onToggle,
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<GenerationOptions>();
  const [draft, setDraft] = useState<GenerationSettings>({ model: '', effort: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void api<GenerationOptions>('/generation')
      .then((value) => {
        if (!cancelled) {
          setOptions(value);
          setDraft(value.settings);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);
  const refresh = () => {
    // Disable the form in the same event that opens it, before the refresh effect runs.
    setLoading(true);
    setReload((value) => value + 1);
  };
  const model = options?.models.find((item) => item.id === draft.model);
  const savedModel = options?.models.find((item) => item.id === options.settings.model);
  const summary = options
    ? `${savedModel?.name ?? options.settings.model} · ${effortLabel(options.settings.effort)}`
    : 'Model and effort';
  const valid = !!model?.efforts.some((effort) => effort.id === draft.effort);
  const save = async () => {
    if (!options || !valid) return;
    setSaving(true);
    setError('');
    try {
      const settings = await api<GenerationSettings>('/generation', json('PUT', draft));
      setOptions({ ...options, settings });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="generation-controls">
      <button
        className="generation-toggle"
        aria-label={`Model and effort: ${summary}`}
        title={summary}
        aria-expanded={open}
        aria-controls="generation-settings"
        onClick={() => {
          if (!open) refresh();
          onToggle();
        }}
      >
        <Cpu size={14} />
        <span>{summary}</span>
      </button>
      {open && (
        <div id="generation-settings" className="reply-style-settings">
          {loading && <p role="status">Loading models…</p>}
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {options && (
            <>
              <label>
                Model
                <select
                  value={draft.model}
                  disabled={loading || saving}
                  onChange={(e) => {
                    const next = options.models.find((item) => item.id === e.target.value)!;
                    setDraft({
                      model: next.id,
                      effort: next.efforts.some((effort) => effort.id === draft.effort)
                        ? draft.effort
                        : next.defaultEffort,
                    });
                  }}
                >
                  {!model && (
                    <option value={draft.model} disabled>
                      {draft.model || 'No default model'} (unavailable)
                    </option>
                  )}
                  {options.models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.supportsImages ? '' : ' (text only)'}
                    </option>
                  ))}
                </select>
              </label>
              {model && <p className="model-id">{model.id}</p>}
              <label>
                Reasoning effort
                <select
                  value={draft.effort}
                  disabled={loading || saving || !model}
                  onChange={(e) => setDraft({ ...draft, effort: e.target.value })}
                >
                  {!valid && (
                    <option value={draft.effort} disabled>
                      {draft.effort || 'Choose an effort'} (unavailable)
                    </option>
                  )}
                  {model?.efforts.map((effort) => (
                    <option key={effort.id} value={effort.id}>
                      {effortLabel(effort.id)}
                    </option>
                  ))}
                </select>
              </label>
              <p>{model?.efforts.find((effort) => effort.id === draft.effort)?.description}</p>
              {model && !model.supportsImages && (
                <p>This model uses the paper’s extracted text. Page images are unavailable.</p>
              )}
              <p>
                Applies to future replies across your library. Answer length follows Reply style.
              </p>
              <button
                className="primary small"
                disabled={loading || saving || !valid}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save model settings'}
              </button>
            </>
          )}
          {!loading && (
            <button className="text-button" onClick={refresh}>
              Reload models
            </button>
          )}
        </div>
      )}
    </div>
  );
}
