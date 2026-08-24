-- Bitácora forense a nivel base de datos.
--
-- El pedido del dueño fue literal: "quiero que la bitácora capte TODO, aún si yo
-- inyecto algo o borro directo de SQL". La bitácora que ya existe (`ActivityLog`)
-- la escribe la API, así que un UPDATE hecho por psql nunca pasa por ella. Es
-- pedirle a la recepción que registre a quien entró por la ventana.
--
-- Un trigger se dispara DENTRO de la base, así que ve el cambio venga de donde
-- venga: la API, psql, una migración, la consola del proveedor.
--
-- La promesa honesta no es "imposible de burlar" —quien tiene las llaves del
-- servidor puede tirar el trigger—. Es: capta todo lo accidental y lo rutinario,
-- y obliga a que manipular algo a propósito requiera pasos extra y visibles.

CREATE TABLE "AuditoriaDb" (
  "id"          bigserial PRIMARY KEY,
  "tabla"       text        NOT NULL,
  "operacion"   text        NOT NULL,
  "registroId"  text,
  "antes"       jsonb,
  "despues"     jsonb,
  -- Contexto de ORIGEN. Es lo que distingue la app de un SQL directo.
  "usuarioDb"   text        NOT NULL DEFAULT current_user,
  "aplicacion"  text,
  "direccionIp" text,
  -- Lo sella la API dentro de su transacción. NULL = NO vino de la app, que es
  -- justo la señal que se busca.
  "actorId"     text,
  "txid"        text        NOT NULL DEFAULT txid_current()::text,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "AuditoriaDb_createdAt_idx" ON "AuditoriaDb" ("createdAt" DESC);
CREATE INDEX "AuditoriaDb_tabla_createdAt_idx" ON "AuditoriaDb" ("tabla", "createdAt" DESC);
CREATE INDEX "AuditoriaDb_registroId_idx" ON "AuditoriaDb" ("registroId");
-- Parcial y pequeño: la pregunta forense frecuente es "¿qué entró sin pasar por
-- la app?", y ese es un puñado de filas entre cientos de miles.
CREATE INDEX "AuditoriaDb_externos_idx" ON "AuditoriaDb" ("createdAt" DESC) WHERE "actorId" IS NULL;

-- --------------------------------------------------------------------------
-- La bitácora es de solo escritura.
--
-- Sin esto, "borra el renglón que te delata" es un DELETE de una línea. Con
-- esto, hay que tirar el trigger primero: sigue siendo posible para quien tiene
-- las llaves, pero deja de ser un descuido y se vuelve un acto deliberado.
--
-- La purga por retención es la única excepción, y tiene que decirlo en voz alta
-- prendiendo `app.purga_auditoria` dentro de su propia transacción.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auditoria_solo_escritura() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('app.purga_auditoria', true), '') <> 'si' THEN
    RAISE EXCEPTION 'La bitácora forense no se edita ni se borra (intento de % sobre AuditoriaDb)', TG_OP;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "auditoria_solo_escritura"
  BEFORE UPDATE OR DELETE ON "AuditoriaDb"
  FOR EACH ROW EXECUTE FUNCTION auditoria_solo_escritura();

-- --------------------------------------------------------------------------
-- El registrador.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auditar_cambio() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_antes   jsonb;
  v_despues jsonb;
BEGIN
  -- TRUNCATE no tiene filas: se registra el hecho, no el contenido. Es un límite
  -- de Postgres, no un olvido — y por eso mismo vale la pena dejar constancia de
  -- que alguien truncó una tabla.
  IF TG_OP = 'TRUNCATE' THEN
    INSERT INTO "AuditoriaDb" ("tabla", "operacion", "aplicacion", "direccionIp", "actorId")
    VALUES (TG_TABLE_NAME, 'TRUNCATE',
            current_setting('application_name', true),
            inet_client_addr()::text,
            NULLIF(current_setting('app.actor_id', true), ''));
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_antes := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN
    v_despues := to_jsonb(NEW);
  ELSE
    v_antes   := to_jsonb(OLD);
    v_despues := to_jsonb(NEW);
    -- Un UPDATE que deja la fila igual no es noticia. Sin este corte, cada
    -- "guardar" sin cambios ensucia la bitácora y esconde lo que sí importa.
    IF v_antes = v_despues THEN
      RETURN NULL;
    END IF;
  END IF;

  -- El hash de la contraseña no se copia a la bitácora. Se quita DESPUÉS de
  -- comparar, no antes: si se quitara antes, un cambio de contraseña —donde lo
  -- único distinto es ese campo— se leería como "no cambió nada" y no quedaría
  -- registrado justo el movimiento de seguridad que más importa ver.
  v_antes   := v_antes   - 'passwordHash';
  v_despues := v_despues - 'passwordHash';

  INSERT INTO "AuditoriaDb" (
    "tabla", "operacion", "registroId", "antes", "despues",
    "aplicacion", "direccionIp", "actorId"
  ) VALUES (
    TG_TABLE_NAME, TG_OP,
    COALESCE(v_despues->>'id', v_antes->>'id'),
    v_antes, v_despues,
    current_setting('application_name', true),
    inet_client_addr()::text,
    NULLIF(current_setting('app.actor_id', true), '')
  );
  RETURN NULL;
END;
$$;

-- --------------------------------------------------------------------------
-- Engancha el trigger a toda tabla del esquema que todavía no lo tenga.
--
-- Es idempotente a propósito y se llama en DOS lugares: aquí, para las tablas de
-- hoy, y al arrancar el contenedor, para las que traiga cualquier migración
-- futura. Sin esa segunda llamada, una tabla nueva se escaparía en silencio de
-- la bitácora y nadie se enteraría hasta necesitarla.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION asegurar_auditoria() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  r  record;
  n  integer := 0;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = current_schema()
       AND c.relkind = 'r'
       -- Auditar la bitácora con la bitácora es una recursión infinita; su
       -- protección es el trigger de solo escritura, no otro registro.
       AND c.relname NOT IN ('AuditoriaDb', '_prisma_migrations')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = r.oid AND t.tgname = 'auditoria_cambio'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER "auditoria_cambio" AFTER INSERT OR UPDATE OR DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION auditar_cambio()', r.relname);
      n := n + 1;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = r.oid AND t.tgname = 'auditoria_truncate'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER "auditoria_truncate" AFTER TRUNCATE ON %I
           FOR EACH STATEMENT EXECUTE FUNCTION auditar_cambio()', r.relname);
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

SELECT asegurar_auditoria();
