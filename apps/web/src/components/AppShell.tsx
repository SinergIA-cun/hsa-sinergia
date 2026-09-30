import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LogOut, FileText, Plus, CalendarDays, ChefHat, Archive, SlidersHorizontal, Trash2, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../auth/auth.tsx';
import { api } from '../lib/api.ts';
import { Logo } from './Logo.tsx';
import { cn } from '../lib/cn.ts';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const loc = useLocation();

  // Cuántas hay en papelera que este usuario no ha visto. El servidor respeta
  // ownership: una vendedora nunca ve en su contador lo que otra eliminó.
  const sinVer = useQuery({
    queryKey: ['trash-sin-ver'],
    queryFn: () => api.get<{ count: number }>('/api/quotes/trash/sin-ver'),
  });
  const pendientes = sinVer.data?.count ?? 0;

  const navItem = (to: string, icon: ReactNode, label: string, badge = 0) => {
    const active = loc.pathname === to;
    return (
      <Link
        to={to}
        // Debajo de xl solo se ve el icono: con los ocho apartados y el nombre
        // del usuario la barra no cabía y la página entera se corría de lado.
        title={label}
        aria-label={badge > 0 ? undefined : label}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          active ? 'bg-ink text-cream' : 'text-ink hover:bg-ink/5',
        )}
      >
        {icon}
        <span className="hidden xl:inline">{label}</span>
        {/* La insignia se oculta en cero y lleva texto real: un círculo de color
            no le dice nada a un lector de pantalla. */}
        {badge > 0 && (
          <span
            className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-wine px-1.5 py-0.5 text-[0.7rem] font-bold leading-none text-white"
            aria-label={`${badge} ${badge === 1 ? 'cotización eliminada sin ver' : 'cotizaciones eliminadas sin ver'}`}
          >
            {badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-cream-300/70 bg-cream/80 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/">
            <Logo className="items-start" />
          </Link>
          {/* En teléfono la barra baja a su propio renglón (antes simplemente no
              existía debajo de `sm`: no había cómo navegar desde un celular). */}
          <nav className="order-last flex w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] md:order-none md:w-auto [&::-webkit-scrollbar]:hidden">
            {navItem('/', <LayoutDashboard size={16} />, 'Inicio')}
            {navItem('/eventos', <FileText size={16} />, 'Eventos')}
            {navItem('/agenda', <CalendarDays size={16} />, 'Agenda')}
            {navItem('/banqueteros', <ChefHat size={16} />, 'Banqueteros')}
            {navItem('/historico', <Archive size={16} />, 'Histórico')}
            {navItem('/eventos/nuevo', <Plus size={16} />, 'Nuevo')}
            {navItem('/papelera', <Trash2 size={16} />, 'Papelera', pendientes)}
            {user?.role === 'admin' &&
              navItem('/admin', <SlidersHorizontal size={16} />, 'Admin')}
          </nav>
          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden text-right text-xs leading-tight text-charcoal-soft xl:block">
                <span className="block font-semibold text-ink">{user.nombre}</span>
                <span className="uppercase tracking-wide">{user.role}</span>
              </span>
            )}
            <button
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink transition-colors hover:border-ink/40 hover:bg-ink/5"
              title="Cerrar sesión"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
