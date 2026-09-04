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

# Un aviso en los logos del despliegue vale más que un 502 sin explicación.
# Con VITE_API_URL vacío la app pide /api al MISMO dominio, y ahí nginx intenta
# resolver el host `api` de la red de docker-compose: en EasyPanel, donde la API
# vive en otro dominio, eso responde 502 y nadie sabe por qué.
if [ -z "${VITE_API_URL:-}" ]; then
  echo "AVISO: VITE_API_URL no está definida."
  echo "       Correcto SOLO si la API se sirve en este mismo dominio (modo docker-compose)."
  echo "       Con dominios separados (EasyPanel), /api responderá 502 hasta que la definas."
fi

# `HSA_SOLO_CONFIG` lo usa la prueba: escribe el archivo y no levanta nginx.
[ -n "${HSA_SOLO_CONFIG:-}" ] && exit 0

exec nginx -g 'daemon off;'
