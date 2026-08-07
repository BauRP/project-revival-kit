import { Outlet, createRootRoute, HeadContent, Scripts, useRouter } from "@tanstack/react-router";

// Earliest possible execution: installs the storage fallback and the global
// window.onerror / unhandledrejection traps before any app module evaluates.
import "@/lib/boot-guard";

import appCss from "../styles.css?url";
import legacyCss from "../index.css?url";


export const Route = createRootRoute({
  ssr: false,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover",
      },
      { title: "Trivo Chat" },
      { name: "description", content: "Защищенный мессенджер нового поколения" },
      { name: "author", content: "Lovable" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Trivo Chat" },
      { property: "og:description", content: "Защищенный мессенджер нового поколения" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Trivo Chat" },
      { name: "twitter:description", content: "Защищенный мессенджер нового поколения" },
    ],
    links: [
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: legacyCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: () => null,
});

/**
 * Router-level error boundary. Catches every throw from loaders and from the
 * React tree (including a failed lazy chunk for the legacy app shell) before
 * it can reach h3 and become an opaque 500.
 */
function RootErrorComponent({ error }: { error: Error }) {
  console.error("[trivo] route error boundary:", error);
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#08090d",
        color: "#e8ecf5",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          padding: "32px 24px",
          borderRadius: 20,
          textAlign: "center",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>
          Something went wrong
        </h1>
        <p
          style={{
            margin: "0 0 24px",
            fontSize: 14,
            lineHeight: 1.5,
            color: "rgba(232,236,245,0.7)",
          }}
        >
          {error?.message || "An unexpected error occurred."}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              void router.invalidate();
            }}
            style={{
              cursor: "pointer",
              borderRadius: 12,
              padding: "12px 20px",
              fontSize: 14,
              fontWeight: 600,
              border: "1px solid #4f7cff",
              background: "#4f7cff",
              color: "#fff",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") window.location.href = "/";
            }}
            style={{
              cursor: "pointer",
              borderRadius: 12,
              padding: "12px 20px",
              fontSize: 14,
              fontWeight: 600,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.06)",
              color: "#e8ecf5",
            }}
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
