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
DATABASE_URL=postgresql://USUARIO:PASSWORD@HOST_INTERNO:5432/BASE?schema=public
JWT_SECRET=<genera un valor largo y aleatorio, ej. openssl rand -hex 32>
PORT=3001
HOST=0.0.0.0
PUBLIC_WEB_URL=https://hsa.somossinergia.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COMPROBANTES_DIR=/app/data/comprobantes
```

> **Sustituye las CUATRO mayúsculas** de `DATABASE_URL` con lo que copiaste de la
> pestaña Connect. Esto ya falló dos veces: el 3-sep-2026 se coló el marcador
> `<db>` y quedó una base llamada `%3Cdb%3E`; el 5-sep-2026 se pegó la línea
> completa sin tocar y la API se cicló con un `P1001: Can't reach database server
> at HOST_INTERNO:5432`, que suena a problema de red y no lo es.
>
> Desde entonces el contenedor **se niega a arrancar** si detecta un marcador sin
> sustituir, y lo dice en los logs con el nombre del que falta. Verifícalo de
> todos modos en la consola del servicio api:
>
> ```bash
> pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts | head -1
> ```
>
> Debe imprimir `Base conectada:` con el nombre que elegiste. Sin bandera ese
> guion no borra nada.


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

**Variables de entorno** (pestaña Environment, como en cualquier otro servicio):
```
VITE_API_URL=https://hsaapi.somossinergia.com
```

Se leen **al arrancar el contenedor**, no al compilar: el entrypoint escribe
`/config.js` con lo que traiga el entorno y la app lo lee de ahí. No hacen falta Build
Args —que esta versión de EasyPanel no siempre expone— y cambiar el dominio de la API es
reiniciar, no reconstruir.

`VITE_API_URL` es **obligatoria**: sin ella el contenedor no arranca y lo dice en los
logs. Es a propósito — el 5-sep-2026 se reconstruyó producción sin agregarla y la app
del cliente se quedó pidiéndole `/api` a su propio dominio, con un 502 que en pantalla
se lee "No se pudo conectar con el servidor". Solo el modo de un dominio
(docker-compose, con el proxy `/api` de nginx) la lleva definida pero **vacía**.

> Antes esto se horneaba en el JS, con el dominio de la API de producción como valor por
> omisión de la imagen. Una segunda instancia construida del mismo repo sin build arg
> servía una app que le pegaba a **la base del cliente**, y nada en la pantalla lo
> delataba. Si ves una instalación vieja, revisa que tenga su `VITE_API_URL`.

**Dominio**: pestaña Domains → agrega `hsa.somossinergia.com` → puerto `80`.
Mismo gotcha del proxy: destino `http://`, no `https://`.

Deploy.

## 5. El catálogo + usuario admin: ya se sembraron solos

**No hay que hacer nada aquí.** El contenedor corre el seed al arrancar, antes de
los backfills. En los logs del primer arranque verás `Seed HSA completado.`; en
los siguientes, `Catálogo ya sembrado (N espacios) — se omite.`

Va en el arranque porque tenerlo como paso manual era un huevo-y-gallina: los
backfills parchan datos que ya existen, así que en una base nueva `backfill:fase6`
moría con *"No hay catálogo (PriceList) activo"*, la cadena se caía y el
contenedor se reciclaba sin dejar llegar nunca a una consola desde la cual
sembrar. Le pasó a la instancia del demo el 5-sep-2026.

Si alguna vez hace falta correrlo a mano:
```bash
pnpm --filter @hsa/database exec tsx prisma/seed.ts
```
(No uses `run seed`, que trae un `dotenv -e ../../.env` que no existe dentro del
contenedor — igual que en Motipreca.)

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

## La instancia de DEMO (para vender a clientes nuevos)

Una copia aparte, con una hacienda ficticia adentro, para enseñarle el sistema a
prospectos sin tocar la del cliente.

**Cómo se monta:** los mismos pasos 1 a 4 de arriba, en un proyecto nuevo de
EasyPanel (p. ej. `hsa-demo`), con su propio Postgres y sus propios dominios
(p. ej. `demo.somossinergia.com` y `demoapi.somossinergia.com` — subdominios del
mismo dominio raíz, por la cookie). **No** corras el seed del paso 5; en su lugar:

```bash
pnpm --filter @hsa/api exec tsx src/scripts/seed-demo.ts --confirmo=<nombre-de-la-base>
```

Usuarios que deja: `demo@haciendademo.mx` y `ventas@haciendademo.mx`, los dos con
la contraseña de `DEMO_PASSWORD` o `demo-hsa-2027` si no defines esa variable.

**Qué siembra:** un catálogo inventado (3 espacios, 5 tipos de evento, 6
banqueteros), 30 eventos repartidos entre el histórico y los próximos meses, 39
pagos, un depósito de banquetero a medio repartir y 2 fechas apartadas. Nada de
eso son datos de la hacienda: sus precios y sus banqueteros son información suya
y el demo se le muestra a otros salones de eventos.

**Todas las fechas cuelgan del reloj**, no son constantes: la agenda y el tablero
se ven vivos hoy y seguirán viéndose vivos el año que entra.

**Vuelve a correrlo cuando el demo se ensucie.** Es la manera de borrar las
cotizaciones de "aaa" y "prueba 123" que deja un prospecto y regresar al estado
de exhibición. Vacía la base COMPLETA antes de sembrar, así que exige la misma
bandera `--confirmo=<nombre-de-la-base>` que la purga: **jamás lo corras contra
la instancia del cliente.**

> El demo sigue diciendo "Hacienda San Andrés" en el encabezado y su contrato es
> el de la hacienda: la marca está escrita en el código, no en una variable. Si
> quieres que el demo se vea sin marca (o con otra), hay que sacarla a
> configuración — pídemelo y lo hago aparte.

## La instancia de DEMO (para vender a clientes nuevos)

Es un despliegue aparte: **su propia base**, sus propios servicios y su propio
dominio. Nunca comparte base con la del cliente.

**1. Base de datos.** Un servicio Postgres nuevo, con su base propia
(`hsa_demo`). Verifica el nombre con el ensayo de la purga, como arriba.

**2. Servicios api y web.** Mismas imágenes y mismas variables que la instalación
normal, apuntando a la base del demo. Al servicio **web** se le agregan éstas,
que le cambian la identidad a toda la app —encabezado, recibo y las nueve
páginas del contrato:

```
VITE_MARCA_NOMBRE=Hacienda Los Encinos
VITE_MARCA_ANIO=1902
VITE_MARCA_RAZON_SOCIAL=Eventos Los Encinos, S.A. de C.V.
VITE_MARCA_DIRECCION=Camino Real 240, Col. Centro, Metepec, Estado de México
VITE_MARCA_DIRECCION_CORTA=Camino Real 240, Metepec, Estado de México
VITE_MARCA_TELEFONO=722 555 0140
VITE_MARCA_TELEFONO_2=
VITE_MARCA_SITIO=www.haciendalosencinos.mx
VITE_MARCA_DOMINIO_CORREO=haciendalosencinos.mx
VITE_MARCA_CONTRATO=neutro
```

`VITE_MARCA_CONTRATO=neutro` es la que cambia el clausulado: imprime términos
genéricos en vez de los de Hacienda San Andrés. Sin ella el contrato del demo
traería su tabulador de cancelación, su multa por pirotecnia, su tarifa de valet
y su reglamento de proveedores.

Son de arranque: basta reiniciar el servicio web para que tomen, sin reconstruir. Sin
ellas la app dice Hacienda San Andrés, que es justo lo que no debe ver un prospecto.

**Y la más importante del demo:**

```
VITE_API_URL=https://<el dominio de la API DEL DEMO>
```

Sin ella el web del demo le pega a la API que tenga configurada por omisión. Verifícalo
en el navegador antes de enseñárselo a nadie: abre la consola del navegador en el demo y
escribe `window.__HSA_CONFIG__` — debe listar el dominio del demo, no el del cliente.

**3. Sembrar el demo.** En la consola del servicio api del DEMO:

```bash
pnpm --filter @hsa/api exec tsx src/scripts/seed-demo.ts --confirmo=hsa_demo
```

Vacía la base COMPLETA —catálogo incluido— y siembra una hacienda ficticia con
~30 eventos repartidos contra la fecha de hoy, para que el tablero y la agenda se
vean vivos. Se vuelve a correr cada vez que un prospecto deje el demo sucio.

Usuarios: `demo@haciendademo.mx` y `ventas@haciendademo.mx`, con la contraseña de
`DEMO_PASSWORD` (o `demo-hsa-2027` si no se define).

> **El clausulado neutro es texto de demostración**, no revisado por un abogado:
> cubre el mismo terreno que el de verdad —pagos, cancelación, daños,
> responsabilidades, proveedores, firma— con condiciones inventadas y redondas, y
> lo dice en el propio documento. La tabla del plan de pagos sí es la de verdad,
> calculada por el sistema, que es justo lo que la demo quiere lucir.

## Entregar la app a un cliente (vaciar los datos de prueba)

En la consola del servicio **api**. El ensayo no borra nada:

```bash
pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts
```

Imprime contra qué base está conectado, qué se borraría y qué se conserva
(catálogo, banqueteros, personal, usuarios). Para vaciar de verdad hay que
teclear el nombre de la base:

```bash
pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts --confirmo=NOMBRE_DE_LA_BASE
```

Antes de vaciar **respalda solo**: copia el movimiento y la bitácora forense a un
esquema `respaldo_AAAAMMDDHHMM` dentro de la misma base, e imprime cómo
devolverlo. No usa `pg_dump` — **ese binario no existe en el contenedor de la
api** (`node:24-slim`), y buscarlo en las consolas de EasyPanel es una pérdida de
tiempo.

```bash
pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts --respaldos            # listar
pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts --restaurar=respaldo_… # devolver
```

Ese respaldo cubre "vacié y me arrepentí". **No** cubre que se muera el disco,
porque vive en la misma base: para una copia fuera del servidor está la pestaña
Backups del servicio de Postgres.

Y lo último antes de entregar: **cambiar la contraseña del admin**, que el seed
deja en `admin1234` y está en el repositorio.

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
