import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";

// Hybrid mount: the original Vite SPA App lives entirely on the client.
// TanStack Start owns the SSR shell; the legacy state router handles in-app
// navigation inside <App />. Nothing in the app graph is evaluated on the
// server, so native/P2P/crypto modules can never break SSR.
// Cache-busting version pin forces ClientOnly to remount on hot reload.
const LEGACY_APP_VERSION = "trivo-p2p-v1";
const LegacyApp = lazy(() => import("@/App"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Trivo Chat Elite | Private Tor Messenger" },
      { name: "description", content: "Private peer-to-peer messaging over Tor onion services with local end-to-end encrypted storage." },
      { property: "og:title", content: "Trivo Chat Elite | Private Tor Messenger" },
      { property: "og:description", content: "Private peer-to-peer messaging over Tor onion services with local end-to-end encrypted storage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <ClientOnly fallback={<div style={{ minHeight: "100vh", background: "#000" }} />}>
      <ErrorBoundary>
        <Suspense fallback={<div style={{ minHeight: "100vh", background: "#000" }} />}>
          <LegacyApp key={LEGACY_APP_VERSION} />
        </Suspense>
      </ErrorBoundary>
    </ClientOnly>
  );
}
