"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState } from "react";
import type { Me } from "@dixon/types";
export const SessionContext = createContext<{
  me: Me | null;
  setMe: (me: Me | null) => void;
}>({ me: null, setMe: () => {} });
export const useSession = () => useContext(SessionContext);
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );
  const [me, setMe] = useState<Me | null>(null);
  return (
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ me, setMe }}>
        {children}
      </SessionContext.Provider>
    </QueryClientProvider>
  );
}
