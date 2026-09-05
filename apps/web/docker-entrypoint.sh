#!/bin/sh
# Escribe /config.js con lo que traiga el entorno del contenedor, y arranca nginx.
#
# Existe para que UNA imagen sirva a las dos instalaciones —la del cliente y la
# del demo— sin reconstruirla. Antes `VITE_API_URL` se horneaba al compilar, con
# el dominio de la API de producción como valor por omisión: una segunda
# instancia construida del mismo repo servía una app que le pegaba a la base del
# cliente, y nada en la pantalla lo delataba.
#
# Una variable que NO está definida no se escribe: la app cae a su valor por
# omisión. Una definida pero VACÍA sí se escribe, porque vacío es una respuesta
# legítima (así se esconde el año bajo el logo).
set -eu

# La ruta es variable para poder probar este guion fuera del contenedor.
CONFIG=${HSA_CONFIG_PATH:-/usr/share/nginx/html/config.js}
: > "$CONFIG"

escapa() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

primera=si
agrega() {
  llave=$1
  variable=$2
  eval "definida=\${$variable+si}"
  [ -n "${definida:-}" ] || return 0
  eval "valor=\$$variable"
  if [ "$primera" = si ]; then primera=no; else printf ',' >> "$CONFIG"; fi
  printf '"%s":"%s"' "$llave" "$(escapa "$valor")" >> "$CONFIG"
}

printf 'window.__HSA_CONFIG__ = {' >> "$CONFIG"
agrega apiUrl              VITE_API_URL
agrega marcaNombre         VITE_MARCA_NOMBRE
agrega marcaAnio           VITE_MARCA_ANIO
agrega marcaRazonSocial    VITE_MARCA_RAZON_SOCIAL
agrega marcaDireccion      VITE_MARCA_DIRECCION
agrega marcaDireccionCorta VITE_MARCA_DIRECCION_CORTA
agrega marcaTelefono       VITE_MARCA_TELEFONO
agrega marcaTelefono2      VITE_MARCA_TELEFONO_2
agrega marcaSitio          VITE_MARCA_SITIO
agrega marcaDominioCorreo  VITE_MARCA_DOMINIO_CORREO
agrega marcaContrato       VITE_MARCA_CONTRATO
printf '};\n' >> "$CONFIG"

echo "config.js: $(cat "$CONFIG")"

# Sin `VITE_API_URL` la app pide /api a su PROPIO dominio, y ahí nginx intenta
# resolver el host `api` de la red de docker-compose. En EasyPanel, donde la API
# vive en otro dominio, eso es un 502 y la pantalla dice "No se pudo conectar con
# el servidor": suena a problema de red y es un ajuste que falta.
#
# Pasó de verdad. El 5-sep-2026 la configuración dejó de hornearse en la imagen y
# pasó a leerse al arrancar; al reconstruir producción sin agregar la variable, la
# app del cliente se quedó sin API. Un aviso en los logs no sirvió de nada, porque
# nadie mira los logs de un contenedor que arrancó bien.
#
# Se distingue NO DEFINIDA de DEFINIDA VACÍA:
#   · no definida  = nadie decidió → se detiene y lo dice;
#   · vacía        = decisión explícita de servir la API en el mismo dominio, que
#                    es el modo docker-compose con el proxy /api de nginx.
if [ -z "${VITE_API_URL+definida}" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  FALTA VITE_API_URL — no se arrancó nada"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  echo "  Sin ella la app le pide /api a su propio dominio, y responde 502."
  echo "  En pantalla se ve como \"No se pudo conectar con el servidor\"."
  echo ""
  echo "  Dónde: EasyPanel → servicio web → pestaña Environment."
  echo ""
  echo "    VITE_API_URL=https://el-dominio-de-tu-api"
  echo ""
  echo "  Si de verdad sirves la API en ESTE mismo dominio (docker-compose con"
  echo "  el proxy /api de nginx), déjala definida pero VACÍA:"
  echo ""
  echo "    VITE_API_URL="
  echo ""
  exit 1
fi

# `HSA_SOLO_CONFIG` lo usa la prueba: escribe el archivo y no levanta nginx.
[ -n "${HSA_SOLO_CONFIG:-}" ] && exit 0

exec nginx -g 'daemon off;'
