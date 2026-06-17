'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/ichibase/client';

type Note = { id: string | number; body: string; created_at?: string };

export function NotesClient() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const ichi = createClient();
    const { data, error } = await ichi
      .from<Note>('notes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      setError(error.detail ?? error.code);
      return;
    }
    setError(null);
    setNotes((data as Note[]) ?? []);
  }, []);

  useEffect(() => {
    load();
    // Live updates: re-load whenever a row changes (RLS narrows this to the
    // user's own rows on the server side).
    const ichi = createClient();
    const sub = ichi.realtime.subscribe({ kind: 'postgres', table: 'notes' }, () => {
      load();
    });
    return () => sub.unsubscribe();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const ichi = createClient();
    const { error } = await ichi.from('notes').insert({ body });
    setBusy(false);
    if (error) {
      setError(error.detail ?? error.code);
      return;
    }
    setBody('');
    load(); // realtime will also fire, but refresh immediately for snappiness
  }

  return (
    <div className="card">
      <form className="row" onSubmit={add}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a note…"
          aria-label="Note body"
        />
        <button disabled={busy || !body.trim()}>{busy ? 'Adding…' : 'Add'}</button>
      </form>
      {error && <p className="err">{error} — see the README for the `notes` table + RLS.</p>}
      <ul className="list">
        {notes.length === 0 && !error ? (
          <li className="muted">No notes yet.</li>
        ) : (
          notes.map((n) => <li key={String(n.id)}>{n.body}</li>)
        )}
      </ul>
    </div>
  );
}
