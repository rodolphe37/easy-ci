import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApiError } from "./lib/api";
import "./i18n";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      // Inutile de réessayer une erreur d'authentification ou une ressource absente.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && ["unauthorized", "not_found", "forbidden", "not_authenticated", "rate_limited"].includes(error.code)) &&
        failureCount < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
