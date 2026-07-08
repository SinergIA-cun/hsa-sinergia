# Deploy — Hacienda San Andrés (Cotizador)

App hermana de Motipreca. Se hostea con **un solo dominio público**: el contenedor `web`
(nginx) sirve el SPA y hace **proxy de `/api` a la API** en la red interna. Así las cookies
son first-party (SameSite=Lax + Secure) y no hay CORS que configurar.

```
Internet ──HTTPS──▶ [proxy EasyPanel/Traefik] ──▶ web (nginx :80)
                                                   ├─ /            → SPA (React)
                                                   └─ /api, /health→ api (:3001) ──▶ postgres (:5432)
```

## Servicios

| Servicio  | Imagen / Dockerfile           | Puerto | Público |
|-----------|-------------------------------|--------|---------|
| web       | `apps/web/Dockerfile` (nginx) | 80     | ✅ (dominio) |
| api       | `apps/api/Dockerfile` (tsx)   | 3001   | ❌ (interno) |
| postgres  | `postgres:16-alpine`          | 5432   | ❌ (interno) |

## Opción A — Docker Compose (VPS)

```bash
cp .env.production.example .env      # y edita los valores
docker compose -f docker-compose.prod.yml up -d --build

# Primer arranque: sembrar catálogo 2027 + usuario admin
docker compose -f docker-compose.prod.yml exec api pnpm --filter @hsa/database run seed:deploy
```

El proxy del VPS (Traefik/Nginx/EasyPanel) debe terminar TLS y apuntar al puerto
`WEB_PORT` (por defecto 8080). **Gotcha conocido (igual que Motipreca):** el proxy habla
`http` con el contenedor aunque de cara al cliente sea `https`; está bien —
`COOKIE_SECURE=true` aplica a la conexión navegador↔proxy (https).

## Opción B — EasyPanel (recomendada, es el método probado con Motipreca)

EasyPanel en este VPS despliega **un servicio por Dockerfile con dominios separados**
(no Docker Compose). Ver la guía paso a paso completa: **[`EASYPANEL.md`](./EASYPANEL.md)**
— incluye variables exactas, el gotcha del proxy `http://` interno, y cómo hornear
`VITE_API_URL` en el build de la web.

## Variables de entorno

Ver `.env.production.example`. Mínimas:
- `DATABASE_URL` — conexión a Postgres.
- `JWT_SECRET` — ≥16 caracteres, aleatorio.
- `PUBLIC_WEB_URL` — dominio público de la web (para CORS y links del cliente).
- `COOKIE_SECURE=true` en producción.
- `COOKIE_SAME_SITE` — `lax` (default) si web y API comparten dominio raíz; `none` si son
  dominios totalmente distintos (requiere `COOKIE_SECURE=true`).
- `VITE_API_URL` (solo build de la web, Opción B) — dominio público de la API si vive en
  un dominio distinto al de la web. Vacío en la Opción A (mismo dominio vía nginx).

## Post-deploy

- **Usuario admin inicial:** `admin@haciendasanandres.com.mx` / `admin1234` — **cámbialo de inmediato**.
- Verifica `GET https://<dominio>/health` → `{"ok":true}`.
- Las migraciones se aplican solas al arrancar la API (`prisma migrate deploy`).

## Pendiente antes de producción real

- Cambiar la contraseña del admin y crear usuarios reales (Vendedora/Admin).
- Cargar los precios 2027 faltantes (XV, Cumpleaños, Renta, TB) en el seed/catálogo.
- Fases siguientes: orden de pago + contrato pre-llenado + registro de pagos (Fase 5),
  admin de catálogo (Fase 6), PDF.
