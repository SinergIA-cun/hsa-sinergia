import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { Button, Card, Field, TextInput } from '../ui.tsx';
import type { AdminConfig } from '../../lib/types.ts';
import { apiErrorMessage } from './shared.tsx';

export function ConfigSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => api.get<{ config: AdminConfig }>('/api/admin/config'),
  });
  const config = data?.config;

  const [ivaPct, setIvaPct] = useState('');
  const [extraHourPct, setExtraHourPct] = useState('');
  const [foodDiscountPct, setFoodDiscountPct] = useState('');
  const [valetRatio, setValetRatio] = useState('');
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);

  // Sincroniza los campos con la config recién cargada, sólo antes de que
  // la usuaria empiece a editar (evita pisar cambios en curso).
  useEffect(() => {
    if (!config || touched) return;
    setIvaPct(String(config.ivaRate * 100));
    setExtraHourPct(String(config.extraHourRate * 100));
    setFoodDiscountPct(String(config.foodDiscountRate * 100));
    setValetRatio(String(config.valetRatio));
  }, [config, touched]);

  const saveConfig = useMutation({
    mutationFn: (data: Partial<AdminConfig>) => api.patch<{ config: AdminConfig }>('/api/admin/config', data),
    onSuccess: async () => {
      setError('');
      setTouched(false);
      setSavedAt(Date.now());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin-config'] }),
        qc.invalidateQueries({ queryKey: ['catalog'] }),
      ]);
    },
    onError: (err) => setError(apiErrorMessage(err, 'No se pudo guardar la configuración.')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const iva = Number(ivaPct);
    const extraHour = Number(extraHourPct);
    const foodDiscount = Number(foodDiscountPct);
    const ratio = Number(valetRatio);
    if ([iva, extraHour, foodDiscount, ratio].some((n) => Number.isNaN(n)) || ratio <= 0) {
      setError('Revisa que todos los campos sean números válidos y el valet sea mayor a 0.');
      return;
    }
    setError('');
    saveConfig.mutate({
      ivaRate: iva / 100,
      extraHourRate: extraHour / 100,
      foodDiscountRate: foodDiscount / 100,
      valetRatio: ratio,
    });
  }

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl text-ink">Configuración</h2>
      <Card className="max-w-2xl p-6">
        {isLoading && <p className="text-sm text-charcoal-soft">Cargando…</p>}
        {!isLoading && (
          <form onSubmit={onSubmit} className="space-y-4" onChange={() => setTouched(true)}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="IVA (%)">
                <TextInput type="number" min={0} max={100} step="0.01" value={ivaPct} onChange={(e) => setIvaPct(e.target.value)} />
              </Field>
              <Field label="Hora extra (%)">
                <TextInput type="number" min={0} max={100} step="0.01" value={extraHourPct} onChange={(e) => setExtraHourPct(e.target.value)} />
              </Field>
              <Field label="Descuento por alimentos (%)">
                <TextInput type="number" min={0} max={100} step="0.01" value={foodDiscountPct} onChange={(e) => setFoodDiscountPct(e.target.value)} />
              </Field>
            </div>
            <Field label="Valet: 1 auto por cada N personas" hint="Ej. 2.5 = 1 auto por cada 2.5 invitados">
              <TextInput type="number" min={0.1} step="0.1" value={valetRatio} onChange={(e) => setValetRatio(e.target.value)} />
            </Field>
            {error && <p className="text-xs text-wine">{error}</p>}
            {savedAt && !error && <p className="text-xs text-emerald-700">Configuración guardada.</p>}
            <Button type="submit" variant="gold" disabled={saveConfig.isPending}>
              <Save size={16} /> {saveConfig.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </form>
        )}
      </Card>
    </section>
  );
}
