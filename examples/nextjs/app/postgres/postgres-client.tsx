'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/ichibase/client';

type Row = Record<string, unknown> & { id?: unknown };

export function PostgresClient() {
  const [table, setTable] = useState('notes');
  const [body, setBody] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (name: string) => {
    try {
      const ichi = createClient();
      const { data, error } = await ichi.from<Row>(name).select('*').limit(50);
      if (error) {
        setError(error.detail ?? error.code);
        setRows([]);
        return;
      }
      setError(null);
      setRows((data as Row[]) ?? []);
    } catch (e) {
      setError(`${(e as Error).message} — is your origin in the project's CORS allowlist?`);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load(table);
  }, [load, table]);

  async function insert(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const ichi = createClient();
    const { error } = await ichi.from(table).insert({ body });
    setBusy(false);
    if (error) {
      setError(error.detail ?? error.code);
      return;
    }
    setBody('');
    load(table);
  }

  async function remove(id: unknown) {
    setError(null);
    const ichi = createClient();
    const { error } = await ichi.from(table).delete().eq('id', id);
    if (error) {
      setError(error.detail ?? error.code);
      return;
    }
    load(table);
  }

  return (
    <div className="card">
      <label htmlFor="table">Table</label>
      <input id="table" value={table} onChange={(e) => setTable(e.target.value.trim())} />

      <form className="row" onSubmit={insert}>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="body…" aria-label="body" />
        <button disabled={busy || !body.trim()}>{busy ? 'Inserting…' : 'insert'}</button>
      </form>

      {error && <p className="err">{error}</p>}

      <ul className="list">
        {rows.length === 0 && !error ? (
          <li className="muted">No rows.</li>
        ) : (
          rows.map((r, i) => (
            <li key={String(r.id ?? i)} className="row" style={{ justifyContent: 'space-between' }}>
              <code style={{ overflowX: 'auto' }}>{JSON.stringify(r)}</code>
              {r.id != null && (
                <button className="secondary" style={{ marginTop: 0 }} onClick={() => remove(r.id)}>
                  Delete
                </button>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
