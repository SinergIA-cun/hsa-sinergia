import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.ts';
import type { SessionUser } from '../lib/types.ts';

interface AuthValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function fetchMe(): Promise<SessionUser | null> {
  try {
    const data = await api.get<{ user: SessionUser | null }>('/api/auth/me');
    return data.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    staleTime: 60_000,
    retry: false,
  });

  async function login(email: string, password: string): Promise<void> {
    await api.post('/api/auth/login', { email, password });
    await qc.invalidateQueries({ queryKey: ['me'] });
  }

  async function logout(): Promise<void> {
    await api.post('/api/auth/logout');
    qc.setQueryData(['me'], null);
    await qc.invalidateQueries();
  }

  return (
    <AuthContext.Provider value={{ user: data ?? null, loading: isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
