import { createRouter, createHashHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import RouterErrorPanel from "@/components/RouterErrorPanel";

// Static SPA + Capacitor: client navigation must be hash-based so the Android
// WebView never tries to resolve app routes as filesystem/network paths.
const hashHistory = typeof window !== "undefined" ? createHashHistory() : undefined;

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    // Hash history is only active in the browser/native WebView.
    ...(hashHistory ? { history: hashHistory } : {}),
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: RouterErrorPanel,
  });

  return router;
};
