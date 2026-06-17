'use client';

import { useEffect, useRef, useState } from 'react';
import type { Subscription } from '@ichibase/client';
import { createClient } from '@/lib/ichibase/client';

export function RealtimeClient() {
  const [kind, setKind] = useState<'mongo' | 'postgres'>('mongo');
  const [name, setName] = useState('orders');
  const [active, setActive] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const subRef = useRef<Subscription | null>(null);

  function stop() {
    subRef.current?.unsubscribe();
    subRef.current = null;
    setActive(null);
  }

  function subscribe(e: React.FormEvent) {
    e.preventDefault();
    stop();
    setEvents([]);
    const ichi = createClient();
    const opts =
      kind === 'mongo'
        ? ({ kind: 'mongo', collection: name } as const)
        : ({ kind: 'postgres', table: name } as const);
    subRef.current = ichi.realtime.subscribe(opts, (msg) => {
      setEvents((prev) => [`${new Date().toLocaleTimeString()}  ${JSON.stringify(msg)}`, ...prev].slice(0, 50));
    });
    setActive(`${kind}:${name}`);
  }

  // Clean up the socket when leaving the page.
  useEffect(() => () => stop(), []);

  return (
    <div className="card">
      <form className="row" onSubmit={subscribe}>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'mongo' | 'postgres')} aria-label="kind">
          <option value="mongo">mongo</option>
          <option value="postgres">postgres</option>
        </select>
        <input value={name} onChange={(e) => setName(e.target.value.trim())} placeholder={kind === 'mongo' ? 'collection' : 'table'} aria-label="name" />
        <button>Subscribe</button>
        {active && (
          <button type="button" className="secondary" style={{ marginTop: 0 }} onClick={stop}>
            Stop
          </button>
        )}
      </form>

      <p className="muted">
        {active ? `Listening on ${active} — change a document/row (e.g. on the Mongo page) to see events.` : 'Not subscribed.'}
      </p>

      <ul className="list">
        {events.length === 0 ? (
          <li className="muted">No events yet.</li>
        ) : (
          events.map((ev, i) => (
            <li key={i}>
              <code style={{ overflowX: 'auto' }}>{ev}</code>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
