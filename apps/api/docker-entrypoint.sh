#!/bin/sh
# Arranque de la API: revisa el entorno, aplica migraciones y levanta el servidor.
#
# La revisión de arriba existe por una falla real que costó dos despliegues. Los
# marcadores de `DATABASE_URL` en la guía se pegaron SIN sustituir, y el error que
# salía era:
#
#   Error: P1001: Can't reach database server at `HOST_INTERNO:5432`
#
# Que es cierto y es inútil: manda a buscar un problema de red cuando lo que pasa
# es que faltó reemplazar un texto. Peor: la primera vez se coló solo el nombre de
# la base y quedó una base llamada `%3Cdb%3E` que la app usó durante meses.
#
# Un guion que revisa antes de arrancar convierte diez minutos de desconcierto en
# un renglón que dice qué hacer.
set -eu

falta() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  LA CONFIGURACIÓN ESTÁ INCOMPLETA — no se arrancó nada"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  echo "  $1"
  echo ""
  echo "  Dónde: EasyPanel → servicio api → pestaña Environment."
  echo "  Los valores reales están en el servicio Postgres → pestaña Connect."
  echo ""
  echo "  DATABASE_URL debe quedar así, con TUS cuatro valores:"
  echo "    postgresql://usuario:contraseña@host-interno:5432/base?schema=public"
  echo ""
  exit 1
}

[ -n "${DATABASE_URL:-}" ] || falta "DATABASE_URL no está definida."

# Los marcadores de la guía, en sus dos generaciones: las MAYÚSCULAS de hoy y los
# <angulares> de antes, que ya se colaron una vez.
#
# Se comparan por POSICIÓN y no como subcadena suelta: una contraseña legítima
# puede contener la palabra "PASSWORD", y una guardia que rechaza una
# configuración válida es peor que no tener guardia. Por eso se parte la URL y se
# revisa cada pieza contra el marcador COMPLETO.
sin_esquema=${DATABASE_URL#*://}
credenciales=${sin_esquema%%@*}
servidor=${sin_esquema##*@}
usuario=${credenciales%%:*}
contrasena=${credenciales#*:}
anfitrion=${servidor%%/*}
anfitrion=${anfitrion%%:*}   # sin el puerto
base=${servidor#*/}
base=${base%%\?*}

for pieza in "$usuario:USUARIO" "$contrasena:PASSWORD" "$anfitrion:HOST_INTERNO" "$base:BASE"; do
  valor=${pieza%:*}
  marcador=${pieza##*:}
  [ "$valor" = "$marcador" ] &&
    falta "DATABASE_URL todavía trae el marcador $marcador sin sustituir."
done

# Los <angulares> se buscan solo en el servidor y la base: una contraseña sí
# puede traer un `<` legítimo, percent-encodeado como %3C.
case "$anfitrion$base" in
  *'<'*|*'%3C'*|*'>'*|*'%3E'*)
    falta "DATABASE_URL trae un marcador <entre angulares> sin sustituir." ;;
esac

[ -n "${JWT_SECRET:-}" ] || falta "JWT_SECRET no está definida. Genérala con: openssl rand -hex 32"

echo "Entorno verificado. Base: $(echo "$DATABASE_URL" | sed -E 's#.*@([^/]+)/([^?]+).*#\2 en \1#')"

cd /app
pnpm --filter @hsa/database run migrate:deploy
for fase in 6 7 8 9 11 12 13 14; do
  pnpm --filter @hsa/database run "backfill:fase$fase"
done
pnpm --filter @hsa/api exec tsx src/scripts/reconcile-statuses.ts
exec pnpm --filter @hsa/api exec tsx src/index.ts
