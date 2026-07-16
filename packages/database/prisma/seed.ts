import { PrismaClient, AddOnKind, UserRole } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { applyCatalog2027 } from './data/catalog-2027.js';
import { applyTeamBuilding2027 } from './data/team-building-2027.js';
import { applyPaymentRules } from './data/payment-rules.js';
import { applyBanqueteros } from './data/banqueteros.js';

const prisma = new PrismaClient();

async function seedCatalog() {
  // Idempotente: si ya hay espacios, el catálogo ya está sembrado. No re-crear
  // (evita duplicados si el seed corre más de una vez).
  const existing = await prisma.space.count();
  if (existing > 0) {
    console.log(`Catálogo ya sembrado (${existing} espacios) — se omite.`);
    return;
  }

  // Config global
  await prisma.pricingConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', ivaRate: 0.16, extraHourRate: 0.05, foodDiscountRate: 0.05 },
  });

  // Lista de precios 2027
  const priceList = await prisma.priceList.create({
    data: { anio: 2027, activa: true },
  });

  // Espacios
  const arcos = await prisma.space.create({ data: { nombre: 'Salón Los Arcos', capacidadMax: 400 } });
  const campos = await prisma.space.create({ data: { nombre: 'Jardín Los Campos', capacidadMax: 400 } });
  const cupula = await prisma.space.create({ data: { nombre: 'Jardín La Cúpula', capacidadMax: 800 } });
  const capilla = await prisma.space.create({ data: { nombre: 'La Capilla', capacidadMax: 170 } });

  // Renta Los Arcos / Los Campos (misma tabla)
  const arcosCampos = [
    { min: 1, max: 50, viernes: 34500, viernesEspecial: 17250, sabado: 42000, domAJue: 30000 },
    { min: 51, max: 100, viernes: 70000, viernesEspecial: 35000, sabado: 76000, domAJue: 58500 },
    { min: 101, max: 200, viernes: 86000, viernesEspecial: 43000, sabado: 93500, domAJue: 74000 },
    { min: 201, max: 300, viernes: 100000, viernesEspecial: 50000, sabado: 108500, domAJue: 90500 },
    { min: 301, max: 400, viernes: 116500, viernesEspecial: 58250, sabado: 123000, domAJue: 105500 },
  ];
  for (const spaceId of [arcos.id, campos.id]) {
    await prisma.rentalPrice.createMany({
      data: arcosCampos.map((r) => ({ ...r, priceListId: priceList.id, spaceId })),
    });
  }

  // Renta La Cúpula
  await prisma.rentalPrice.createMany({
    data: [
      { min: 50, max: 300, viernes: 157000, viernesEspecial: 78500, sabado: 174000, domAJue: 139000 },
      { min: 301, max: 500, viernes: 170000, viernesEspecial: 85000, sabado: 194000, domAJue: 150000 },
      { min: 501, max: 650, viernes: 197500, viernesEspecial: 98750, sabado: 218500, domAJue: 170000 },
      { min: 651, max: 800, viernes: 210500, viernesEspecial: 105250, sabado: 233500, domAJue: 183000 },
    ].map((r) => ({ ...r, priceListId: priceList.id, spaceId: cupula.id })),
  });

  // Renta Capilla (cortesía salvo sábado)
  await prisma.rentalPrice.create({
    data: { priceListId: priceList.id, spaceId: capilla.id, min: 1, max: 170, viernes: 0, viernesEspecial: 0, sabado: 5000, domAJue: 0 },
  });

  // Reglas de pago por espacio (sección H del contrato). Fuente única compartida
  // con el backfill para que producción siempre las tenga (idempotente).
  await applyPaymentRules(prisma);

  // Add-ons de ejemplo
  await prisma.addOn.createMany({
    data: [
      { nombre: 'Valet parking', kind: AddOnKind.porUnidad, price: 100 },
      { nombre: 'DJ Hora extra', kind: AddOnKind.porUnidad, price: 2950 },
      { nombre: 'Mesa de dulces (por persona)', kind: AddOnKind.porPersona, price: 110 },
    ],
  });

  // Tipos de evento + paquetes de alimentos 2027 (fuente única compartida con el backfill).
  await applyCatalog2027(prisma);

  // Team Building: renta plana + espacios Los Balcones / Los Pajaritos.
  await applyTeamBuilding2027(prisma);

  // Banqueteros base (el cliente agrega más desde el panel).
  await applyBanqueteros(prisma);
}

async function main() {
  await seedCatalog();

  // Usuario admin de arranque (dev). Cambiar contraseña en producción.
  // Siempre se asegura (upsert), aunque el catálogo ya estuviera sembrado.
  const adminEmail = 'admin@haciendasanandres.com.mx';
  const passwordHash = await hash('admin1234');
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { nombre: 'Administrador', email: adminEmail, passwordHash, role: UserRole.admin },
  });

  console.log('Seed HSA completado.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
