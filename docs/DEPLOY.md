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

## Opción B — EasyPanel

1. Crea 3 servicios en el proyecto:
   - **postgres**: plantilla Postgres 16 (define usuario/contraseña/BD).
   - **api**: App desde este repo, Dockerfile `apps/api/Dockerfile`. Variables:
     `DATABASE_URL`, `JWT_SECRET`, `PORT=3001`, `PUBLIC_WEB_URL`, `COOKIE_SECURE=true`.
   - **web**: App desde este repo, Dockerfile `apps/web/Dockerfile`. Apunta el **dominio** aquí.
2. En `apps/web/nginx.conf`, `proxy_pass http://api:3001;` asume que el servicio de la
   API se llama `api` en la red interna. Ajusta el host si tu servicio tiene otro nombre.
3. Primer deploy: ejecuta el seed una vez en el contenedor `api`:
   `pnpm --filter @hsa/database run seed:deploy`.

## Variables de entorno

Ver `.env.production.example`. Mínimas:
- `DATABASE_URL` — conexión a Postgres.
- `JWT_SECRET` — ≥16 caracteres, aleatorio.
- `PUBLIC_WEB_URL` — dominio público (para CORS y links del cliente).
- `COOKIE_SECURE=true` en producción.

## Post-deploy

- **Usuario admin inicial:** `admin@haciendasanandres.com.mx` / `admin1234` — **cámbialo de inmediato**.
- Verifica `GET https://<dominio>/health` → `{"ok":true}`.
- Las migraciones se aplican solas al arrancar la API (`prisma migrate deploy`).

## Pendiente antes de producción real

- Cambiar la contraseña del admin y crear usuarios reales (Vendedora/Admin).
- Cargar los precios 2027 faltantes (XV, Cumpleaños, Renta, TB) en el seed/catálogo.
- Fases siguientes: orden de pago + contrato pre-llenado + registro de pagos (Fase 5),
  admin de catálogo (Fase 6), PDF.
