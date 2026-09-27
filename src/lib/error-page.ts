// ============================================================================
//  Dependency-free SSR error page.
//  ---------------------------------------------------------------------------
//  This module MUST NOT import any application code. It is rendered exactly in
//  the situations where the app itself failed to initialise (module-init throw,
//  h3-swallowed request error, request-middleware failure), so any import here
//  could fail for the very same reason and leave the user with a blank frame.
// ============================================================================

export function renderErrorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="cache-control" content="no-store" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Trivo Chat — temporarily unavailable</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: #08090d;
        color: #e8ecf5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .card {
        width: 100%;
        max-width: 420px;
        padding: 32px 24px;
        border-radius: 20px;
        text-align: center;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      h1 { margin: 0 0 8px; font-size: 20px; font-weight: 700; }
      p { margin: 0 0 24px; font-size: 14px; line-height: 1.5; color: rgba(232, 236, 245, 0.7); }
      .row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
      a.btn {
        appearance: none;
        cursor: pointer;
        border-radius: 12px;
        padding: 12px 20px;
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #e8ecf5;
      }
      .primary { background: #4f7cff; border-color: #4f7cff; color: #fff; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Something went wrong</h1>
      <p>The app could not be started on the server. Your local messages and keys are untouched — they never leave this device.</p>
      <div class="row">
        <a class="btn primary" href="" target="_self">Refresh</a>
        <a class="btn" href="./" target="_self">Go home</a>
      </div>
    </main>
  </body>
</html>`;
}
