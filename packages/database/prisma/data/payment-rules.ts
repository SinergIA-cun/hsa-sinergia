import type { PrismaClient } from '@prisma/client';

// Reglas de pago por espacio (sección H del contrato). El plan de pagos se mide
// sobre la RENTA: anticipo fijo para apartar, complemento = % de la renta para
// formalizar, y el finiquito cubre el resto de la renta.
// La Capilla / Balcones / Pajaritos quedan sin regla hasta tener sus montos.
const RULES: { nombre: string; anticipo: number; complementoPct: number }[] = [
  { nombre: 'Jardín La Cúpula', anticipo: 25000, complementoPct: 0.25 },
  { nombre: 'Salón Los Arcos', anticipo: 20000, complementoPct: 0.1 },
  { nombre: 'Jardín Los Campos', anticipo: 15000, complementoPct: 0.15 },
];

/**
 * Garantiza (idempotente) las reglas de pago de los espacios principales.
 * Busca por nombre para funcionar en cualquier BD. Sin estas reglas el estado
 * de cuenta queda en "plan pendiente" y el auto-avance de estatus nunca dispara.
 */
export async function applyPaymentRules(prisma: PrismaClient): Promise<void> {
  for (const r of RULES) {
    const space = await prisma.space.findFirst({ where: { nombre: r.nombre } });
    if (!space) continue;
    await prisma.spacePaymentRule.upsert({
      where: { spaceId: space.id },
      update: { anticipo: r.anticipo, complementoPct: r.complementoPct },
      create: { spaceId: space.id, anticipo: r.anticipo, complementoPct: r.complementoPct },
    });
  }
}
