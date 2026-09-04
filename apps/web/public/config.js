// Lo reescribe el contenedor al arrancar, con las variables de su entorno (ver
// apps/web/docker-entrypoint.sh). Vacío = manda lo que se horneó al compilar,
// que es lo que se quiere en `pnpm dev`.
window.__HSA_CONFIG__ = {};
