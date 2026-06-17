import { PostgresClient } from './postgres-client';

export default function PostgresPage() {
  return (
    <>
      <h1>Postgres (client-side)</h1>
      <p>
        Reads &amp; writes a Postgres table from the browser with <code>ichi.from(table)</code>{' '}
        (PostgREST). Row-Level Security scopes rows to your user. Needs a table (e.g.{' '}
        <code>notes</code> with RLS — see the README) on a project that has Postgres; a Mongo-only
        project will return an error here.
      </p>
      <PostgresClient />
    </>
  );
}
