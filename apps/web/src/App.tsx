import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/auth.tsx';
import { AppShell } from './components/AppShell.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { InicioPage } from './pages/InicioPage.tsx';
import { QuotesListPage } from './pages/QuotesListPage.tsx';
import { NewQuotePage } from './pages/NewQuotePage.tsx';
import { EditQuotePage } from './pages/EditQuotePage.tsx';
import { AgendaPage } from './pages/AgendaPage.tsx';
import { PublicQuotePage } from './pages/PublicQuotePage.tsx';
import { BanqueterosPage } from './pages/BanqueterosPage.tsx';
import { BanqueteroPage } from './pages/BanqueteroPage.tsx';
import { BanqueteroPublicoPage } from './pages/BanqueteroPublicoPage.tsx';
import { ContratoPage } from './pages/ContratoPage.tsx';
import { ReciboPage } from './pages/ReciboPage.tsx';
import { HojaOperativaPage } from './pages/HojaOperativaPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { PapeleraPage } from './pages/PapeleraPage.tsx';

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

/** Requiere sesión pero sin el shell de la app (vista de impresión limpia). */
function ProtectedBare({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Restringe a usuarios con role === 'admin'; redirige al resto. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/cotizaciones" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/c/:token" element={<PublicQuotePage />} />
            {/* El estado de cuenta del banquetero por enlace, mismo patrón que
                `/c/:token` del cliente: sin sesión y de solo lectura. */}
            <Route path="/b/:token" element={<BanqueteroPublicoPage />} />
            <Route path="/c/:token/recibo/:paymentId" element={<ReciboPage />} />
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
              path="/cotizaciones/:id/contrato"
              element={
                <ProtectedBare>
                  <ContratoPage />
                </ProtectedBare>
              }
            />
            <Route
              path="/cotizaciones/:id/operativa"
              element={
                <ProtectedBare>
                  <HojaOperativaPage />
                </ProtectedBare>
              }
            />
            {/* La cartera de banqueteros tampoco es AdminOnly: ventas vende a
                nombre de un banquetero y reparte sus depósitos, así que necesita
                la lista. Lo que solo un admin puede hacer —alta, baja, edición—
                no se pinta, y la API lo bloquea igual. */}
            <Route
              path="/banqueteros"
              element={
                <Protected>
                  <BanqueterosPage />
                </Protected>
              }
            />
            {/* La ficha del banquetero NO es AdminOnly: ventas reparte un depósito
                sobre sus eventos —es la instrucción del banquetero sobre dinero
                que ya entró, no un movimiento nuevo— y la página esconde lo que
                solo un admin puede hacer. */}
            <Route
              path="/banqueteros/:id"
              element={
                <Protected>
                  <BanqueteroPage />
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
            <Route
              path="/papelera"
              element={
                <Protected>
                  <PapeleraPage />
                </Protected>
              }
            />
            <Route
              path="/admin"
              element={
                <Protected>
                  <AdminOnly>
                    <AdminPage />
                  </AdminOnly>
                </Protected>
              }
            />
            <Route
              path="/"
              element={
                <Protected>
                  <InicioPage />
                </Protected>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
