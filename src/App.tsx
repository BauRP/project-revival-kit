import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { IdentityProvider } from "@/contexts/IdentityContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import Index from "./pages/Index.tsx";
import { useEffect } from "react";
import gun from "@/lib/gun-setup";
import { whenBridgeReady } from "@/lib/native-bridge";
import { safeStorage } from "@/lib/safe-storage";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    let cancelled = false;

    // Boot sequence: every step is independently guarded so a failure in one
    // module can never abort the launch of the others (or the React tree).
    const boot = async () => {
      // 1. Never touch a plugin or storage before the bridge is ready.
      await whenBridgeReady();
      if (cancelled) return;

      // 2. Warm local preferences through the crash-proof storage wrapper.
      try {
        safeStorage.set("trivo-last-boot", String(Date.now()));
      } catch (err) {
        console.warn("[trivo] boot stamp failed:", err);
      }

      // 3. Local realtime shim (BroadcastChannel/localStorage backed) — the
      //    support bot listener. Fully optional; failures are non-fatal.
      try {
        gun.get("trivo-chat-messages")
          .map()
          .once((data: any) => {
            try {
              if (data && data.text && data.sender !== "TrivoBot") {
                if (String(data.text).toLowerCase().includes("привет")) {
                  const msgId = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  gun.get("trivo-chat-messages").get(msgId).put({
                    text: "Привет, Босс! Я на связи и готов к работе.",
                    sender: "TrivoBot",
                    timestamp: Date.now(),
                  });
                }
              }
            } catch (err) {
              console.warn("[trivo] bot handler failed:", err);
            }
          });
      } catch (err) {
        console.warn("[trivo] realtime shim unavailable in this environment:", err);
      }
    };

    void boot().catch((err) => console.warn("[trivo] boot sequence error:", err));

    return () => {
      cancelled = true;
    };
  }, []);


  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <LanguageProvider>
            <IdentityProvider>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                <Index />
              </TooltipProvider>
            </IdentityProvider>
          </LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
