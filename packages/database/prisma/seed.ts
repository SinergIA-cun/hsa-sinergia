import { PrismaClient, AddOnKind, UserRole } from '@prisma/client';
import { hash } from '@node-rs/argon2';

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

  // Reglas de pago por espacio (sección H del contrato). La Capilla queda sin
  // regla (pendiente de datos del cliente) — el sistema la maneja como "plan pendiente".
  const spaceRules = [
    { space: cupula, anticipo: 25000, complementoPct: 0.25 },
    { space: arcos, anticipo: 20000, complementoPct: 0.1 },
    { space: campos, anticipo: 15000, complementoPct: 0.15 },
  ];
  for (const r of spaceRules) {
    await prisma.spacePaymentRule.create({
      data: { spaceId: r.space.id, anticipo: r.anticipo, complementoPct: r.complementoPct },
    });
  }

  // Tipos de evento
  const boda = await prisma.eventType.create({ data: { nombre: 'Boda', slug: 'boda' } });
  const empresarial = await prisma.eventType.create({ data: { nombre: 'Empresarial', slug: 'empresarial' } });
  const bautizo = await prisma.eventType.create({ data: { nombre: 'Bautizo', slug: 'bautizo' } });

  // Boda: SUPREME / SUPREME plus
  const supreme = await prisma.foodPackage.create({ data: { eventTypeId: boda.id, nombre: 'SUPREME', ivaIncluido: false } });
  const supremePlus = await prisma.foodPackage.create({ data: { eventTypeId: boda.id, nombre: 'SUPREME plus', ivaIncluido: false } });
  await prisma.foodPackagePrice.createMany({
    data: [
      { packageId: supreme.id, min: 1, max: 50, pricePerPerson: 1459 },
      { packageId: supreme.id, min: 51, max: 100, pricePerPerson: 1019 },
      { packageId: supreme.id, min: 101, max: 150, pricePerPerson: 999 },
      { packageId: supreme.id, min: 151, max: 200, pricePerPerson: 849 },
      { packageId: supreme.id, min: 201, max: 300, pricePerPerson: 799 },
      { packageId: supreme.id, min: 301, max: null, pricePerPerson: 679 },
      { packageId: supremePlus.id, min: 1, max: 50, pricePerPerson: 1729 },
      { packageId: supremePlus.id, min: 51, max: 100, pricePerPerson: 1199 },
      { packageId: supremePlus.id, min: 101, max: 150, pricePerPerson: 1179 },
      { packageId: supremePlus.id, min: 151, max: 200, pricePerPerson: 969 },
      { packageId: supremePlus.id, min: 201, max: 300, pricePerPerson: 899 },
      { packageId: supremePlus.id, min: 301, max: null, pricePerPerson: 789 },
    ],
  });

  // Bautizo: 3 Tiempos / Taquiza
  const bautizo3t = await prisma.foodPackage.create({ data: { eventTypeId: bautizo.id, nombre: '3 Tiempos', ivaIncluido: false } });
  const taquiza = await prisma.foodPackage.create({ data: { eventTypeId: bautizo.id, nombre: 'Taquiza', ivaIncluido: false } });
  await prisma.foodPackagePrice.createMany({
    data: [
      { packageId: bautizo3t.id, min: 50, max: 99, pricePerPerson: 1230 },
      { packageId: bautizo3t.id, min: 100, max: 150, pricePerPerson: 945 },
      { packageId: bautizo3t.id, min: 151, max: 200, pricePerPerson: 930 },
      { packageId: bautizo3t.id, min: 201, max: 300, pricePerPerson: 920 },
      { packageId: taquiza.id, min: 50, max: 99, pricePerPerson: 1210 },
      { packageId: taquiza.id, min: 100, max: 150, pricePerPerson: 935 },
      { packageId: taquiza.id, min: 151, max: 200, pricePerPerson: 920 },
      { packageId: taquiza.id, min: 201, max: 300, pricePerPerson: 910 },
    ],
  });

  // Empresarial: 3 Tiempos / Buffet Mexicano (subconjunto de los 7 del folleto)
  const emp3t = await prisma.foodPackage.create({ data: { eventTypeId: empresarial.id, nombre: '3 Tiempos', ivaIncluido: false } });
  const empBuffet = await prisma.foodPackage.create({ data: { eventTypeId: empresarial.id, nombre: 'Buffet Mexicano', ivaIncluido: false } });
  await prisma.foodPackagePrice.createMany({
    data: [
      { packageId: emp3t.id, min: 1, max: 50, pricePerPerson: 680 },
      { packageId: emp3t.id, min: 51, max: 100, pricePerPerson: 660 },
      { packageId: emp3t.id, min: 101, max: 200, pricePerPerson: 630 },
      { packageId: emp3t.id, min: 201, max: 300, pricePerPerson: 620 },
      { packageId: emp3t.id, min: 301, max: 400, pricePerPerson: 610 },
      { packageId: empBuffet.id, min: 1, max: 50, pricePerPerson: 670 },
      { packageId: empBuffet.id, min: 51, max: 100, pricePerPerson: 630 },
      { packageId: empBuffet.id, min: 101, max: 200, pricePerPerson: 580 },
      { packageId: empBuffet.id, min: 201, max: 300, pricePerPerson: 565 },
      { packageId: empBuffet.id, min: 301, max: 400, pricePerPerson: 555 },
    ],
  });

  // Add-ons de ejemplo
  await prisma.addOn.createMany({
    data: [
      { nombre: 'Valet parking', kind: AddOnKind.porUnidad, price: 100 },
      { nombre: 'DJ', kind: AddOnKind.fijo, price: 2950 },
      { nombre: 'Mesa de dulces (por persona)', kind: AddOnKind.porPersona, price: 110 },
    ],
  });
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
