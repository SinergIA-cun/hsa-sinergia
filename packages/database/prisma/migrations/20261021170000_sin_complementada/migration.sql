-- Sin hitos intermedios (21-oct-2026): "Pago a cuenta cubierto" (complementada)
-- ya no existe como paso; esos eventos quedan formalizados. El valor sigue en el
-- enum porque la bitácora y el histórico lo citan. Cada cambio deja su renglón.
INSERT INTO "ActivityLog" ("id", "quoteId", "tipo", "descripcion", "meta", "actorId", "createdAt")
SELECT 'actv_' || md5(q."id" || 'sin_complementada'), q."id", 'estatus',
       'Estatus: complementada → formalizada (ya no hay hito "a cuenta")',
       '{"de": "complementada", "a": "formalizada", "motivo": "sin hitos intermedios"}'::jsonb, NULL, now()
FROM "Quote" q
WHERE q."status" = 'complementada';

UPDATE "Quote" SET "status" = 'formalizada' WHERE "status" = 'complementada';
