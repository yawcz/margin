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
  useEffect(() => {
    void api<Profile>('/profile')
      .then((profile) => {
        setStyle({
          replyLength: profile.replyLength,
          replyInstructions: profile.replyInstructions,
        });
        setSavedLength(profile.replyLength);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);
  const save = async () => {
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
              disabled={loading || saving}
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
              disabled={loading || saving}
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
            disabled={loading || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save reply style'}
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
