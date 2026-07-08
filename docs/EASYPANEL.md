# Desplegar en EasyPanel — Hacienda San Andrés

Repo: `https://github.com/SinergIA-cun/hsa-sinergia` (rama `main`).

Sigue el mismo patrón que ya funciona para Motipreca en este EasyPanel: **un servicio por
Dockerfile**, con **dominios separados** para web y API (no el modo Docker Compose de un
solo dominio). Usa esa arquitectura porque ya está probada en este VPS.

Dominios de ejemplo usados abajo — sustitúyelos por los reales:
- Web: `hsacotizador.somossinergia.com`
- API: `hsapi.somossinergia.com`

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
PUBLIC_WEB_URL=https://hsacotizador.somossinergia.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
```

**Dominio**: pestaña Domains → agrega `hsapi.somossinergia.com` → puerto `3001`.
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
VITE_API_URL=https://hsapi.somossinergia.com
```
Si tu versión de EasyPanel **no** expone Build Args (como pasó con Motipreca), edita
directamente el default en `apps/web/Dockerfile`:
```dockerfile
ARG VITE_API_URL="https://hsapi.somossinergia.com"
```
commitea y vuelve a desplegar. `VITE_API_URL` queda **horneado en el JS** en build-time
(no es una env var runtime) — si cambia el dominio de la API, hay que reconstruir la imagen.

**Dominio**: pestaña Domains → agrega `hsacotizador.somossinergia.com` → puerto `80`.
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
curl https://hsapi.somossinergia.com/health          # {"ok":true}
curl https://hsacotizador.somossinergia.com/          # HTML del SPA
```

Abre `https://hsacotizador.somossinergia.com/login` en el navegador y entra con:
- **admin@haciendasanandres.com.mx / admin1234**

**Cámbiala de inmediato** (no hay UI de cambio de contraseña todavía — pídeme que la
agregue, o actualiza el hash directo en la tabla `User` vía la consola de Postgres).

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
