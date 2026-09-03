# Desplegar en EasyPanel — Hacienda San Andrés

Repo: `https://github.com/SinergIA-cun/hsa-sinergia` (rama `main`).

Sigue el mismo patrón que ya funciona para Motipreca en este EasyPanel: **un servicio por
Dockerfile**, con **dominios separados** para web y API (no el modo Docker Compose de un
solo dominio). Usa esa arquitectura porque ya está probada en este VPS.

Dominios **reales, ya en producción** (verificados el 7-ago-2026, ambos resuelven a
`86.38.217.214`, el mismo VPS que Motipreca):
- Web: `hsa.somossinergia.com`
- API: `hsaapi.somossinergia.com`

> **Importante:** para que la cookie de sesión viaje entre los dos dominios sin fricción,
> deben ser **subdominios del mismo dominio raíz** (p.ej. ambos terminan en
> `somossinergia.com`). Si vas a usar el dominio propio de la hacienda
> (`haciendasanandres.com.mx`) para uno de los dos y `somossinergia.com` para el otro,
> avísame antes de desplegar — hay que cambiar `COOKIE_SAME_SITE=none` (ver más abajo).

---

## 0. Prerrequisitos

- Acceso a EasyPanel (mismo VPS/cuenta donde vive Motipreca).
- El repo `SinergIA-cun/hsa-sinergia` conectado a EasyPanel (o dado de alta como fuente
  GitHub si aún no lo está — Settings → Git → conectar cuenta SinergIA-cun).

## 1. Crear el proyecto

En EasyPanel → **Create Project** → nómbralo `hsa` (o el nombre que uses; queda en las
URLs internas, p.ej. `hsa_postgres`).

## 2. Servicio Postgres

Dentro del proyecto `hsa` → **+ Service → Postgres** (plantilla oficial de EasyPanel):
- Nombre del servicio: `postgres`
- Usuario / contraseña / base: los que prefieras (anótalos).
- Espera a que quede en verde ("Running").
- Abre la pestaña **Connect** del servicio y copia el **host interno** que EasyPanel
  te muestre (suele ser `<proyecto>_<servicio>`, p.ej. `hsa_postgres:5432` — cópialo
  exacto de la UI, no lo adivines).

## 3. Servicio API

**+ Service → App → From GitHub**:
- Repo: `SinergIA-cun/hsa-sinergia`, rama `main`.
- Build: **Dockerfile**, ruta `apps/api/Dockerfile`.
- Puerto del contenedor: `3001`.
- Nombre del servicio: `api`.

**Variables de entorno** (pestaña Environment):
```
DATABASE_URL=postgresql://<usuario>:<password>@<host-interno-postgres>:5432/<db>?schema=public
JWT_SECRET=<genera un valor largo y aleatorio, ej. openssl rand -hex 32>
PORT=3001
HOST=0.0.0.0
PUBLIC_WEB_URL=https://hsa.somossinergia.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COMPROBANTES_DIR=/app/data/comprobantes
```

Opcional — solo si quieres el API de solo lectura del BI en línea:
```
BI_API_KEY=<mínimo 32 caracteres, ej. openssl rand -hex 32>
```
Sin esa variable, el módulo `/api/bi` **no se registra** y sus rutas responden 404. No hay
modo "abierto por descuido": la ausencia de la llave cierra el API, no lo abre.

> ### ⚠️ Volumen persistente
>
> `COMPROBANTES_DIR` guarda las fotos de comprobante de pago **y**, desde el Plan B, las
> Constancias de Situación Fiscal de los clientes. Es el único dato de la app que **no
> vive en Postgres**: ningún respaldo de base de datos lo recupera, y sin volumen cada
> redeploy lo borra.
>
> **En producción esto ya está resuelto:** hay un volumen montado y
> `COMPROBANTES_DIR=/app/data/comprobantes`, que es además el valor por defecto del código
> (`WORKDIR /app` + `./data/comprobantes`). Las Constancias caen en ese mismo volumen sin
> configurar nada nuevo.
>
> **No cambies esa ruta.** Mover `COMPROBANTES_DIR` a otro directorio no migra los
> archivos: la app se pone a buscar en el nuevo, vacío, y los comprobantes existentes
> quedan invisibles aunque sigan en disco. Si alguna vez hace falta moverlos, hay que
> copiar el contenido del directorio **antes** de tocar la variable.

**Dominio**: pestaña Domains → agrega `hsaapi.somossinergia.com` → puerto `3001`.
⚠️ **Gotcha conocido (igual que Motipreca):** en la config del dominio, el
**destino del proxy debe ser `http://`, NUNCA `https://`** — el contenedor habla HTTP
plano hacia adentro; con https EasyPanel devuelve `500 Internal Server Error`. El
candado (Let's Encrypt) se queda del lado público, el salto interno es http.

Deploy. En los logs deberías ver `All migrations have been successfully applied.` y
luego `API HSA escuchando en http://0.0.0.0:3001`.

## 4. Servicio Web

**+ Service → App → From GitHub** (mismo repo, misma rama):
- Build: **Dockerfile**, ruta `apps/web/Dockerfile`.
- Puerto del contenedor: `80`.
- Nombre del servicio: `web`.

**Build Arg** — si EasyPanel expone "Build Args" en la UI, define:
```
VITE_API_URL=https://hsaapi.somossinergia.com
```
Si tu versión de EasyPanel **no** expone Build Args (como pasó con Motipreca), edita
directamente el default en `apps/web/Dockerfile`:
```dockerfile
ARG VITE_API_URL="https://hsaapi.somossinergia.com"
```
commitea y vuelve a desplegar. `VITE_API_URL` queda **horneado en el JS** en build-time
(no es una env var runtime) — si cambia el dominio de la API, hay que reconstruir la imagen.

**Dominio**: pestaña Domains → agrega `hsa.somossinergia.com` → puerto `80`.
Mismo gotcha del proxy: destino `http://`, no `https://`.

Deploy.

## 5. Sembrar el catálogo + usuario admin

En la consola del servicio **api** (EasyPanel → servicio api → Console):
```bash
pnpm --filter @hsa/database exec tsx prisma/seed.ts
```
(No uses `run seed`, que trae un `dotenv -e ../../.env` que no existe dentro del
contenedor — igual que en Motipreca.)

Debe imprimir `Seed HSA 2027 completado.`

## 6. Verificar

```bash
curl https://hsaapi.somossinergia.com/health          # {"ok":true}
curl https://hsa.somossinergia.com/          # HTML del SPA
```

Abre `https://hsa.somossinergia.com/login` en el navegador y entra con:
- **admin@haciendasanandres.com.mx / admin1234**

**Cámbiala de inmediato** (no hay UI de cambio de contraseña todavía — pídeme que la
agregue, o actualiza el hash directo en la tabla `User` vía la consola de Postgres).

## Checklist para subir los planes A/B/C/D

La app ya está en línea, pero al 7-ago-2026 servía un build **anterior al Plan A** (el
bundle todavía contenía "Apartada" y "Valet"). Para subir los commits de la rama
`feat/planA-estatus-multisalon`:

1. **Mergear la rama a `main`** (o apuntar los dos servicios de EasyPanel a la rama).
2. **El volumen de `COMPROBANTES_DIR` ya está montado** (`/app/data/comprobantes`); no hay
   nada que hacer, pero tampoco cambies esa ruta. Ver la advertencia del paso 3.
3. **Reconstruir las DOS imágenes.** La de web no es opcional: `VITE_API_URL` se hornea
   en build-time, así que un contenedor web viejo seguirá sirviendo el JS viejo aunque
   la API ya esté nueva.
4. Opcional: `BI_API_KEY` si quieres el BI en línea.
5. **No hace falta ningún paso manual de base de datos.** El `CMD` del `apps/api/Dockerfile`
   corre `migrate:deploy` y todos los backfills al arrancar, incluido el `fase12` que
   desactiva el add-on del valet.

**Verificación después del deploy:**
```bash
curl https://hsaapi.somossinergia.com/health          # {"ok":true}
# El bundle nuevo NO debe contener "Apartada" ni "Valet":
curl -s https://hsa.somossinergia.com/ | grep -o 'src="[^"]*\.js"'
curl -s https://hsa.somossinergia.com/assets/<archivo>.js | grep -c "Apartada"   # → 0
```

En la app: el selector de espacios debe permitir hasta 3 salones con colores de
disponibilidad, y el contrato debe imprimir el complemento como `pct × renta = monto`
por salón.

## Entregar la app al cliente (vaciar los datos de prueba)

Cuando el cliente va a empezar a usarla de verdad, hay que sacarle los datos con
los que se probó. `purgar-datos.ts` borra el **movimiento** —cotizaciones,
clientes, pagos y recibos, depósitos y apartados de banqueteros, bitácora,
histórico y auditoría— y conserva lo que el cliente ya cargó de su operación:
catálogo y precios, banqueteros, personal y cuadrillas, reglas de pago por salón
y usuarios. Los folios de recibo y las referencias de cliente vuelven a 1.

Tres pasos, en la consola del servicio **api** (el segundo va en la del servicio
de **Postgres**):

```bash
# 1. Ensayo: enseña qué se borraría y qué se conserva, sin tocar nada.
pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts

# 2. Respaldo (consola de Postgres). No te lo brinques.
pg_dump -U hsa hsa > /tmp/hsa-antes-de-la-purga.sql

# 3. Vaciar. La bandera tiene que traer el nombre de la base, a propósito.
pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts --confirmo=hsa
```

Sin la bandera **no borra nada**: imprime el censo y el comando que falta. Si la
bandera no coincide con la base conectada, tampoco.

Al final el guion lista los banqueteros, usuarios y catálogos que quedaron en
pie, para borrar a mano desde la app los que hayan nacido de una prueba.

**Esto NO va en la cadena de arranque del contenedor.** Los backfills son
idempotentes y no pierden nada si corren de más; esto pierde todo.

Después de vaciar, **cambia la contraseña del admin**: el seed la deja en
`admin1234`, que está en el repositorio.

## Gotchas (heredados de la experiencia con Motipreca en este mismo EasyPanel)

- **Proxy de dominio siempre en `http://` interno**, nunca `https://` (ver arriba).
- **Cambiar variables de entorno requiere Deploy/restart** del servicio — no se aplican en caliente.
- **El proxy (Traefik) de EasyPanel enmascara los 5xx**: si ves un 502 en el navegador no
  asumas que el contenedor está caído — puede que la app haya respondido 502 y Traefik lo
  esté sustituyendo por su propia página. Revisa los logs del servicio primero.
- **Autodeploy por push puede estar roto** en esta instancia (pasó con Motipreca: EasyPanel
  no podía crear el webhook en GitHub). Si tras un `git push` no ves un nuevo deploy
  automático, usa el botón **Deploy** manual del servicio — sí toma el último commit de `main`.
- Si alguna vez ves `Repository not found` al hacer `git push` desde tu máquina: corre
  `gh auth setup-git` para que git use las credenciales de la cuenta `SinergIA-cun` de `gh`.

## Alternativa: Docker Compose de un solo dominio

Si tu EasyPanel soporta el tipo de servicio "Compose", puedes desplegar
`docker-compose.prod.yml` tal cual (ver `docs/DEPLOY.md`) — un solo dominio, nginx hace
proxy interno de `/api`, sin necesidad de `VITE_API_URL` ni `COOKIE_SAME_SITE`. Es más
simple pero **no está probado en este EasyPanel** (a diferencia del método de arriba, que
es exactamente el que ya funciona con Motipreca). Úsalo solo si el método de servicios
separados no está disponible.
