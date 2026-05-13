export default function OfflinePage() {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Offline — Tracey</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #fafaf9;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
          }
          .card {
            background: white;
            border-radius: 0.75rem;
            border: 1px solid #e7e5e4;
            padding: 2.5rem;
            max-width: 420px;
            width: 100%;
            text-align: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          }
          .icon { font-size: 3rem; margin-bottom: 1rem; }
          h1 { font-size: 1.25rem; font-weight: 700; color: #1c1917; margin-bottom: 0.5rem; }
          p { color: #78716c; font-size: 0.9375rem; line-height: 1.6; margin-bottom: 0.5rem; }
          .badge {
            display: inline-block;
            background: #fef3c7; color: #92400e;
            border-radius: 1rem; padding: 0.25rem 0.75rem;
            font-size: 0.8125rem; font-weight: 600;
            margin-top: 1.25rem;
          }
          .links { margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem; }
          a {
            display: block; padding: 0.625rem 1rem;
            background: #b91c1c; color: white;
            border-radius: 0.375rem; text-decoration: none;
            font-weight: 600; font-size: 0.875rem;
          }
          a.secondary {
            background: white; color: #292524;
            border: 1px solid #e7e5e4;
          }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="icon">📵</div>
          <h1>You&apos;re offline</h1>
          <p>This page isn&apos;t cached yet. Try one of the department queues below — those are pre-cached and work offline.</p>
          <p>Any changes you make will be queued and synced automatically when your connection is restored.</p>
          <div className="badge">⟳ Changes saved locally — will sync when back online</div>
          <div className="links">
            <a href="/dept/production">🥩 Production Queue</a>
            <a href="/dept/filling">🌭 Filling Queue</a>
            <a href="/dept/cooking">🔥 Cooking Queue</a>
            <a href="/dept/packing">📦 Packing Queue</a>
            <a href="/dept/dispatch" className="secondary">🚚 Dispatch</a>
            <a href="/plans" className="secondary">📋 Demand Plans</a>
          </div>
        </div>
      </body>
    </html>
  );
}
