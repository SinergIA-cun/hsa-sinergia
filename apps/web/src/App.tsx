import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/auth.tsx';
import { AppShell } from './components/AppShell.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { QuotesListPage } from './pages/QuotesListPage.tsx';
import { NewQuotePage } from './pages/NewQuotePage.tsx';
import { EditQuotePage } from './pages/EditQuotePage.tsx';
import { AgendaPage } from './pages/AgendaPage.tsx';
import { PublicQuotePage } from './pages/PublicQuotePage.tsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper text-ink-500">
        <span className="animate-pulse font-display text-2xl">Cargando…</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/c/:token" element={<PublicQuotePage />} />
            <Route
              path="/cotizaciones"
              element={
                <Protected>
                  <QuotesListPage />
                </Protected>
              }
            />
            <Route
              path="/cotizaciones/nueva"
              element={
                <Protected>
                  <NewQuotePage />
                </Protected>
              }
            />
            <Route
              path="/cotizaciones/:id"
              element={
                <Protected>
                  <EditQuotePage />
                </Protected>
              }
            />
            <Route
              path="/agenda"
              element={
                <Protected>
                  <AgendaPage />
                </Protected>
              }
            />
            <Route path="/" element={<Navigate to="/cotizaciones" replace />} />
            <Route path="*" element={<Navigate to="/cotizaciones" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
