-- "Cerrar evento": bloquea cambios tras conciliar (reunión del 15-oct-2026).
ALTER TABLE "Quote" ADD COLUMN "cerradoAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN "cerradoById" TEXT;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_cerradoById_fkey" FOREIGN KEY ("cerradoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
