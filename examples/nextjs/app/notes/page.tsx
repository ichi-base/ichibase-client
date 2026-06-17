import { NotesClient } from './notes-client';

export default function NotesPage() {
  return (
    <>
      <h1>Notes (client-side)</h1>
      <p>
        This list is read &amp; written from the browser with the <strong>browser client</strong>{' '}
        (cookie session). It also subscribes to realtime changes. RLS scopes everything to your
        user — you only ever see your own rows.
      </p>
      <NotesClient />
    </>
  );
}
