import { RealtimeClient } from './realtime-client';

export default function RealtimePage() {
  return (
    <>
      <h1>Realtime (client-side)</h1>
      <p>
        Opens a WebSocket from the browser with <code>ichi.realtime.subscribe(...)</code>, authed by
        your cookie session. Subscribe to a Mongo collection or a Postgres table, then make a change
        (e.g. insert on the <a href="/mongo">Mongo</a> page) and watch the event arrive. Your
        realtime rules scope which changes you receive.
      </p>
      <RealtimeClient />
    </>
  );
}
