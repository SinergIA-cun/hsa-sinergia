import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { ETAPAS_WHATSAPP, type EtapaWhatsapp } from '@hsa/shared';
import { api } from '../../lib/api.ts';
import { Button, Card } from '../ui.tsx';
import { apiErrorMessage } from './shared.tsx';
import { usePlantillasWhatsapp } from '../whatsapp/plantillas.ts';

/**
 * Los textos de WhatsApp por etapa (reunión del 15-oct-2026: "definir el
 * catálogo de mensajes"). Vacío = el texto de arranque.
 */
export function WhatsappSection() {
  const qc = useQueryClient();
  const { data } = usePlantillasWhatsapp();
  const [borrador, setBorrador] = useState<Partial<Record<EtapaWhatsapp, string>>>({});
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (data) setBorrador(Object.fromEntries(ETAPAS_WHATSAPP.map((k) => [k, data.plantillas[k].texto])));
  }, [data]);

  async function guardar() {
    setError('');
    setInfo('');
    try {
      const cambios = Object.fromEntries(
        ETAPAS_WHATSAPP.map((k) => [k, borrador[k] === data?.plantillas[k].porDefecto ? '' : borrador[k] ?? '']),
      );
      await api.put('/api/admin/whatsapp/plantillas', { plantillas: cambios });
      await qc.invalidateQueries({ queryKey: ['whatsapp-plantillas'] });
      setInfo('Mensajes guardados.');
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudieron guardar.'));
    }
  }

  if (!data) return null;
  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="inline-flex items-center gap-2 font-display text-2xl text-ink">
          <MessageCircle size={20} className="text-[#25D366]" /> Mensajes de WhatsApp
        </h2>
        <p className="mt-1 text-sm text-charcoal-soft">
          Lo que se pre-redacta en el botón de WhatsApp de cada evento y en los apartados. Variables:{' '}
          <code className="text-xs">{'{cliente} {evento} {fecha} {salon} {codigo} {total} {pagado} {saldo} {enlaceRecibo} {marca}'}</code>.
        </p>
      </div>
      {ETAPAS_WHATSAPP.map((k) => (
        <label key={k} className="block">
          <span className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-charcoal-soft">
            {data.plantillas[k].titulo}
            {borrador[k] !== data.plantillas[k].porDefecto && (
              <button type="button" className="normal-case text-gold hover:underline" onClick={() => setBorrador((b) => ({ ...b, [k]: data.plantillas[k].porDefecto }))}>
                Regresar al de arranque
              </button>
            )}
          </span>
          <textarea
            value={borrador[k] ?? ''}
            onChange={(e) => setBorrador((b) => ({ ...b, [k]: e.target.value }))}
            rows={3}
            maxLength={1000}
            className="w-full rounded-lg border border-ink/15 bg-white/80 px-3 py-2 text-sm text-charcoal focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
          />
        </label>
      ))}
      {error && <p className="text-sm text-wine">{error}</p>}
      {info && <p className="text-sm text-gold">{info}</p>}
      <Button variant="gold" onClick={() => void guardar()}>Guardar mensajes</Button>
    </Card>
  );
}
