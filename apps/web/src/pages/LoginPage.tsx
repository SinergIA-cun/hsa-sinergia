import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth.tsx';
import { Logo } from '../components/Logo.tsx';
import { Button, Field, TextInput } from '../components/ui.tsx';
import { ApiError } from '../lib/api.ts';

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Credenciales inválidas. Verifica tu correo y contraseña.';
    return `Error del servidor (${err.status}): ${err.message}`;
  }
  return 'No se pudo conectar con el servidor. Verifica tu conexión o inténtalo de nuevo.';
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    navigate('/cotizaciones', { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/cotizaciones', { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca */}
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 25% 20%, rgba(199,163,103,0.35), transparent 45%), radial-gradient(circle at 80% 80%, rgba(199,163,103,0.15), transparent 40%)',
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12 text-cream">
          <Logo tone="cream" className="items-start" />
          <div>
            <p className="mb-3 text-xs uppercase tracking-[0.3em] text-gold-200">Salones · Jardines · Capilla</p>
            <h1 className="max-w-md font-display text-5xl leading-[1.05] text-cream">
              Todo tu evento en un sólo lugar.
            </h1>
            <p className="mt-4 max-w-sm text-sm text-cream/70">
              Un oasis dentro de la ciudad. Cotizador interno para el equipo de ventas.
            </p>
          </div>
          <p className="text-xs text-cream/40">Atlacomulco No. 1, Naucalpan, Estado de México</p>
        </div>
      </div>

      {/* Formulario */}
      <div className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo className="items-start" />
          </div>
          <h2 className="font-display text-3xl text-ink">Iniciar sesión</h2>
          <p className="mb-8 mt-1 text-sm text-charcoal-soft">Accede a tu panel de cotizaciones.</p>

          <div className="space-y-4">
            <Field label="Correo">
              <TextInput
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@haciendasanandres.com.mx"
                required
              />
            </Field>
            <Field label="Contraseña" error={error}>
              <TextInput
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </Field>
          </div>

          <Button type="submit" disabled={busy} className="mt-6 w-full py-3">
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
