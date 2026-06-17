import { MongoClient } from './mongo-client';

export default function MongoPage() {
  return (
    <>
      <h1>MongoDB (client-side)</h1>
      <p>
        Reads &amp; writes a Mongo collection from the browser with{' '}
        <code>ichi.mongo.collection(name)</code>. Your collection&apos;s Mongo policy
        (<code>_mongo_policy</code>) gates every op — e.g. an own-docs policy scopes results to your
        user. Requires your app origin in the project&apos;s CORS allowlist.
      </p>
      <MongoClient />
    </>
  );
}
