import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, FileText, Plus, CalendarDays } from 'lucide-react';
import { useAuth } from '../auth/auth.tsx';
import { Logo } from './Logo.tsx';
import { cn } from '../lib/cn.ts';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const loc = useLocation();

  const navItem = (to: string, icon: ReactNode, label: string) => {
    const active = loc.pathname === to;
    return (
      <Link
        to={to}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          active ? 'bg-ink text-cream' : 'text-ink hover:bg-ink/5',
        )}
      >
        {icon}
        {label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-cream-300/70 bg-cream/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/cotizaciones">
            <Logo className="items-start" />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {navItem('/cotizaciones', <FileText size={16} />, 'Cotizaciones')}
            {navItem('/agenda', <CalendarDays size={16} />, 'Agenda')}
            {navItem('/cotizaciones/nueva', <Plus size={16} />, 'Nueva')}
          </nav>
          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden text-right text-xs leading-tight text-charcoal-soft md:block">
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
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
