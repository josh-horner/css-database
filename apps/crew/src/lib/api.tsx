import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import superjson from "superjson";
import type { AppRouter } from "@css/api";
import type { Pairing } from "./pairing";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

const ClientContext = createContext<{ client: TRPCClient<AppRouter>; pairing: Pairing } | null>(null);

/** Vanilla client + pairing, for the offline outbox and photo uploads. */
export function useApiClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("ApiProvider missing");
  return ctx;
}

export function ApiProvider({ pairing, children }: { pairing: Pairing; children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 2, refetchInterval: 15_000 } } }),
  );
  const client = useMemo(
    () =>
      createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `${pairing.apiUrl}/trpc`,
            transformer: superjson,
            headers: () => ({ authorization: `Bearer ${pairing.token}` }),
          }),
        ],
      }),
    [pairing],
  );
  return (
    <ClientContext.Provider value={{ client, pairing }}>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={client} queryClient={queryClient}>
          {children}
        </TRPCProvider>
      </QueryClientProvider>
    </ClientContext.Provider>
  );
}
