import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import BootSplash from "@/components/BootSplash";

const LegacyApp = lazy(() => import("@/App"));

export const Route = createFileRoute("/$")({
  component: SplatRoute,
});

function SplatRoute() {
  return (
    <ClientOnly fallback={<BootSplash />}>
      <ErrorBoundary>
        <Suspense fallback={<BootSplash />}>
          <LegacyApp />
        </Suspense>
      </ErrorBoundary>
    </ClientOnly>
  );
}
