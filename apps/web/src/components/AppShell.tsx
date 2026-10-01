import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LogOut,
  FileText,
  Plus,
  CalendarDays,
  ChefHat,
  Archive,
  SlidersHorizontal,
  Trash2,
  LayoutDashboard,
  ChevronsLeft,
} from 'lucide-react';
import { useAuth } from '../auth/auth.tsx';
import { api } from '../lib/api.ts';
import { MARCA } from '../lib/marca.ts';
import { Logo } from './Logo.tsx';
import { cn } from '../lib/cn.ts';

const CLAVE_COLAPSADO = 'hsaMenuColapsado';

/** La preferencia guardada. En modo privado no hay storage: se queda abierta. */
function leerColapsado(): boolean {
  try {
    return localStorage.getItem(CLAVE_COLAPSADO) === '1';
  } catch {
    return false;
  }
}

interface Apartado {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
}

/**
 * El marco de la aplicación.
 *
 * En pantalla grande la navegación es una **barra lateral** que se contrae a una
 * columna de iconos con la flecha de abajo (como en Cenacolo Reserve). Antes era
 * una barra arriba: con los ocho apartados, el logo y el usuario no cabía a lo
 * ancho y se partía en dos renglones. De lado caben siempre, y contraída le deja
 * la pantalla al contenido sin perder la navegación. La preferencia se recuerda.
 *
 * En teléfono y tablet sigue arriba, con solo los iconos y deslizable.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  // Se lee en el inicializador y no en un efecto: así el primer pintado ya sale
  // con el ancho correcto y la barra no brinca en cada carga.
  const [colapsado, setColapsado] = useState(leerColapsado);

  function alternar() {
    setColapsado((c) => {
      try {
        localStorage.setItem(CLAVE_COLAPSADO, c ? '0' : '1');
      } catch {
        /* sin storage: dura lo que dure la pestaña */
      }
      return !c;
    });
  }

  // Cuántas hay en papelera que este usuario no ha visto. El servidor respeta
  // ownership: una vendedora nunca ve en su contador lo que otra eliminó.
  const sinVer = useQuery({
    queryKey: ['trash-sin-ver'],
    queryFn: () => api.get<{ count: number }>('/api/quotes/trash/sin-ver'),
  });
  const pendientes = sinVer.data?.count ?? 0;

  const apartados: Apartado[] = [
    { to: '/', icon: <LayoutDashboard size={18} />, label: 'Inicio' },
    { to: '/eventos', icon: <FileText size={18} />, label: 'Eventos' },
    { to: '/agenda', icon: <CalendarDays size={18} />, label: 'Agenda' },
    { to: '/banqueteros', icon: <ChefHat size={18} />, label: 'Banqueteros' },
    { to: '/historico', icon: <Archive size={18} />, label: 'Histórico' },
    { to: '/eventos/nuevo', icon: <Plus size={18} />, label: 'Nuevo' },
    { to: '/papelera', icon: <Trash2 size={18} />, label: 'Papelera', badge: pendientes },
    ...(user?.role === 'admin' ? [{ to: '/admin', icon: <SlidersHorizontal size={18} />, label: 'Admin' }] : []),
  ];

  const insignia = (badge: number, punto: boolean) =>
    badge > 0 && (
      // Lleva texto real: un círculo de color no le dice nada a un lector de pantalla.
      <span
        className={cn(
          'inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-wine px-1.5 py-0.5 text-[0.7rem] font-bold leading-none text-white',
          punto && 'absolute -right-1 -top-1',
        )}
        aria-label={`${badge} ${badge === 1 ? 'cotización eliminada sin ver' : 'cotizaciones eliminadas sin ver'}`}
      >
        {badge}
      </span>
    );

  return (
    <div className="min-h-screen bg-paper">
      {/* ── Pantalla grande: barra lateral ─────────────────────────────── */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-cream-300/70 bg-cream/90 backdrop-blur transition-[width] duration-200 lg:flex print:hidden',
          colapsado ? 'w-[4.5rem]' : 'w-60',
        )}
      >
        <Link
          to="/"
          className="flex h-20 shrink-0 items-center justify-center border-b border-cream-300/70 px-3"
          aria-label={MARCA.nombre}
          title={MARCA.nombre}
        >
          {colapsado ? (
            <span className="grid h-10 w-10 place-items-center rounded-full border border-gold/50 font-display text-sm font-semibold tracking-tight text-ink">
              HSA
            </span>
          ) : (
            <Logo />
          )}
        </Link>

        <nav aria-label="Principal" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {apartados.map((a) => {
            const activo = loc.pathname === a.to;
            return (
              <Link
                key={a.to}
                to={a.to}
                title={colapsado ? a.label : undefined}
                aria-current={activo ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60',
                  colapsado ? 'justify-center px-0' : 'px-3',
                  activo ? 'bg-ink text-cream' : 'text-ink hover:bg-ink/5',
                )}
              >
                {a.icon}
                {colapsado ? <span className="sr-only">{a.label}</span> : <span className="flex-1">{a.label}</span>}
                {insignia(a.badge ?? 0, colapsado)}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-2 border-t border-cream-300/70 px-3 py-3">
          {user && !colapsado && (
            <p className="px-1 text-xs leading-tight text-charcoal-soft">
              <span className="block font-semibold text-ink">{user.nombre}</span>
              <span className="uppercase tracking-wide">{user.role}</span>
            </p>
          )}
          <button
            onClick={() => void logout()}
            title="Cerrar sesión"
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border border-ink/15 py-2 text-sm text-ink transition-colors hover:border-ink/40 hover:bg-ink/5',
              colapsado ? 'justify-center px-0' : 'px-3',
            )}
          >
            <LogOut size={16} />
            {colapsado ? <span className="sr-only">Salir</span> : 'Salir'}
          </button>
          <button
            type="button"
            onClick={alternar}
            aria-expanded={!colapsado}
            aria-label={colapsado ? 'Expandir el menú' : 'Contraer el menú a iconos'}
            title={colapsado ? 'Expandir el menú' : 'Contraer a iconos'}
            className="flex w-full items-center justify-center rounded-lg py-1.5 text-charcoal-soft transition-colors hover:bg-ink/5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            {/* La flecha gira para señalar hacia dónde abre. */}
            <ChevronsLeft size={18} className={cn('transition-transform duration-200', colapsado && 'rotate-180')} />
          </button>
        </div>
      </aside>

      {/* ── Teléfono y tablet: barra arriba, solo iconos ──────────────── */}
      <header className="sticky top-0 z-20 border-b border-cream-300/70 bg-cream/80 backdrop-blur lg:hidden print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/">
            <Logo className="items-start" />
          </Link>
          <nav
            aria-label="Principal"
            className="order-last flex w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] md:order-none md:w-auto [&::-webkit-scrollbar]:hidden"
          >
            {apartados.map((a) => (
              <Link
                key={a.to}
                to={a.to}
                title={a.label}
                aria-label={a.badge ? undefined : a.label}
                aria-current={loc.pathname === a.to ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  loc.pathname === a.to ? 'bg-ink text-cream' : 'text-ink hover:bg-ink/5',
                )}
              >
                {a.icon}
                {insignia(a.badge ?? 0, false)}
              </Link>
            ))}
          </nav>
          <button
            onClick={() => void logout()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink transition-colors hover:border-ink/40 hover:bg-ink/5"
            title="Cerrar sesión"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <main
        className={cn(
          'px-4 py-8 transition-[padding] duration-200 sm:px-6 print:p-0',
          colapsado ? 'lg:pl-[calc(4.5rem+2rem)]' : 'lg:pl-[calc(15rem+2rem)]',
        )}
      >
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
