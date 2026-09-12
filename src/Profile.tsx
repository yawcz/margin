import { useEffect, useState } from 'react';
import { Check, Download, Pencil, Trash2, UserRound } from 'lucide-react';
import type { Profile as ProfileData, Signal } from '../shared/types';
import { api, json } from './api';
export default function Profile() {
  const [profile, setProfile] = useState<ProfileData>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState('');
  const [assessment, setAssessment] = useState('');
  const refresh = () =>
    api<ProfileData>('/profile')
      .then(setProfile)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
  }, []);
  const save = async () => {
    if (!profile) return;
    try {
      const { background, goals, preferences } = profile;
      await api('/profile', json('PUT', { background, goals, preferences }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const correct = async (signal: Signal) => {
    try {
      await api(`/signals/${signal.id}`, json('PATCH', { assessment }));
      setEditing('');
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (signal: Signal) => {
    try {
      await api(`/signals/${signal.id}`, { method: 'DELETE' });
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="profile-page">
      <div className="eyebrow">
        <UserRound size={15} /> YOUR LEARNING PROFILE
      </div>
      <h1>Start from what you know.</h1>
      <p className="page-description">
        Your background gives the tutor a starting point. Your questions and reasoning help it find
        better explanations over time.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {profile && (
        <>
          <div className="profile-grid">
            <section className="profile-form">
              <h2>In your own words</h2>
              {(['background', 'goals', 'preferences'] as const).map((field) => (
                <label key={field}>
                  <span>
                    {field === 'background'
                      ? 'Your background'
                      : field === 'goals'
                        ? 'What you want to learn'
                        : 'How you like to learn'}
                  </span>
                  <textarea
                    rows={field === 'background' ? 5 : 4}
                    value={profile[field]}
                    onChange={(e) => setProfile({ ...profile, [field]: e.target.value })}
                  />
                </label>
              ))}
              <button className="primary" onClick={() => void save()}>
                {saved ? (
                  <>
                    <Check size={16} /> Saved
                  </>
                ) : (
                  'Save profile'
                )}
              </button>
            </section>
            <section className="learning-notes">
              <h2>What the tutor is learning about you</h2>
              <p className="muted">
                These are observations, with the evidence behind them. Correct or remove anything
                that doesn’t fit.
              </p>
              {profile.signals.length === 0 ? (
                <div className="notes-empty">
                  <Pencil size={25} />
                  <p>Your first learning notes will appear after a conversation.</p>
                  <small>
                    Opening a paper or highlighting text doesn’t count as proof of understanding.
                  </small>
                </div>
              ) : (
                profile.signals.map((signal) => (
                  <article className="signal" key={signal.id}>
                    <div className="signal-heading">
                      <strong>{signal.concept}</strong>
                      <span className="badge">
                        {signal.source === 'you' ? 'Corrected by you' : signal.confidence}
                      </span>
                    </div>
                    {editing === signal.id ? (
                      <>
                        <textarea
                          value={assessment}
                          onChange={(e) => setAssessment(e.target.value)}
                          rows={3}
                        />
                        <button className="text-button" onClick={() => void correct(signal)}>
                          Save correction
                        </button>
                        <button className="text-button" onClick={() => setEditing('')}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <p>{signal.assessment}</p>
                    )}
                    <blockquote>{signal.evidence}</blockquote>
                    <div className="signal-footer">
                      <span>
                        {new Date(signal.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <button
                        aria-label={`Correct ${signal.concept}`}
                        onClick={() => {
                          setEditing(signal.id);
                          setAssessment(signal.assessment);
                        }}
                      >
                        <Pencil size={14} /> Correct
                      </button>
                      <button
                        aria-label={`Remove ${signal.concept}`}
                        onClick={() => void remove(signal)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </section>
          </div>
          <div className="export-note">
            <div>
              <strong>Your learning history belongs to you.</strong>
              <p>
                Export your profile, conversations, and reading suggestions as JSON. PDFs stay in
                your server’s library.
              </p>
            </div>
            <a className="secondary" href="/api/export">
              <Download size={16} /> Export history
            </a>
          </div>
        </>
      )}
    </main>
  );
}
