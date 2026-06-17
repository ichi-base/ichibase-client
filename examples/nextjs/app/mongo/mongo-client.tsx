'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/ichibase/client';

type Doc = Record<string, unknown> & { _id?: unknown };

export function MongoClient() {
  const [collection, setCollection] = useState('orders');
  const [docJson, setDocJson] = useState('{ "item": "taco", "total": 5 }');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (name: string) => {
    try {
      const ichi = createClient();
      const { data, error } = await ichi.mongo.collection(name).find({}, { sort: { _id: -1 }, limit: 50 });
      if (error) {
        setError(error.detail ?? error.code);
        setDocs([]);
        return;
      }
      setError(null);
      setDocs(data?.docs ?? []);
    } catch (e) {
      // Network/CORS failure throws (rather than returning an error result).
      setError(`${(e as Error).message} — is your origin in the project's CORS allowlist?`);
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    load(collection);
  }, [load, collection]);

  async function insert(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(docJson);
    } catch {
      setError('Document is not valid JSON.');
      setBusy(false);
      return;
    }
    const ichi = createClient();
    const { error } = await ichi.mongo.collection(collection).insertOne(doc);
    setBusy(false);
    if (error) {
      setError(error.detail ?? error.code);
      return;
    }
    load(collection);
  }

  async function remove(id: unknown) {
    setError(null);
    const ichi = createClient();
    // _id comes back from find() as a bare hex string; mongo-gate coerces a
    // 24-hex _id back to an ObjectId, so this matches the stored document.
    const { error } = await ichi.mongo.collection(collection).deleteOne({ _id: id });
    if (error) {
      setError(error.detail ?? error.code);
      return;
    }
    load(collection);
  }

  return (
    <div className="card">
      <label htmlFor="coll">Collection</label>
      <input id="coll" value={collection} onChange={(e) => setCollection(e.target.value.trim())} />

      <form onSubmit={insert}>
        <label htmlFor="doc">Document (JSON)</label>
        <input id="doc" value={docJson} onChange={(e) => setDocJson(e.target.value)} />
        <button disabled={busy}>{busy ? 'Inserting…' : 'insertOne'}</button>
      </form>

      {error && <p className="err">{error}</p>}

      <ul className="list">
        {docs.length === 0 && !error ? (
          <li className="muted">No documents.</li>
        ) : (
          docs.map((d, i) => (
            <li key={String(d._id ?? i)} className="row" style={{ justifyContent: 'space-between' }}>
              <code style={{ overflowX: 'auto' }}>{JSON.stringify(d)}</code>
              {d._id != null && (
                <button className="secondary" style={{ marginTop: 0 }} onClick={() => remove(d._id)}>
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
