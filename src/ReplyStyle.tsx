import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { defaultReplyStyle, type Profile, type ReplyLength } from '../shared/types';
import { api, json } from './api';

export default function ReplyStyle({
  open,
  onToggle,
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [style, setStyle] = useState(defaultReplyStyle);
  const [savedLength, setSavedLength] = useState<ReplyLength>('concise');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void api<Profile>('/profile')
      .then((profile) => {
        if (cancelled) return;
        setStyle({
          replyLength: profile.replyLength,
          replyInstructions: profile.replyInstructions,
        });
        setSavedLength(profile.replyLength);
        setLoading(false);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const save = async () => {
    if (!loaded) return;
    setSaving(true);
    setError('');
    try {
      const profile = await api<Profile>('/profile', json('PUT', style));
      setSavedLength(profile.replyLength);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="reply-style">
      <button
        className="reply-style-toggle"
        aria-expanded={open}
        aria-controls="reply-style-settings"
        aria-label={`Reply style: ${savedLength}`}
        title={`Reply style: ${savedLength}`}
        onClick={onToggle}
      >
        <SlidersHorizontal size={14} /> Reply style
      </button>
      {open && (
        <div id="reply-style-settings" className="reply-style-settings">
          <label>
            Answer length
            <select
              value={style.replyLength}
              disabled={!loaded || loading || saving}
              onChange={(e) => setStyle({ ...style, replyLength: e.target.value as ReplyLength })}
            >
              <option value="concise">Concise · a few sentences</option>
              <option value="balanced">Balanced · a few paragraphs</option>
              <option value="detailed">Detailed · work through the reasoning</option>
            </select>
          </label>
          <label>
            Writing instructions
            <textarea
              rows={3}
              maxLength={2000}
              disabled={!loaded || loading || saving}
              value={style.replyInstructions}
              onChange={(e) => setStyle({ ...style, replyInstructions: e.target.value })}
            />
          </label>
          <p>
            Applies to future replies across your library. You can still ask for more detail
            anytime.
          </p>
          <button
            className="primary small"
            disabled={!loaded || loading || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save reply style'}
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          {!loaded && (
            <button disabled={loading} onClick={() => setAttempt((value) => value + 1)}>
              Retry reply style
            </button>
          )}
        </div>
      )}
    </div>
  );
}
