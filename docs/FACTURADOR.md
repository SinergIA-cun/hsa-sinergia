# Facturador.com (PAC) — prueba de compatibilidad

Facturador.com pide una prueba de compatibilidad antes de activar la API productiva. La
prueba corre en **su ambiente de pruebas** (`stagefacturador.com`): no timbra nada real
ni gasta folios.

## Qué prueba

`apps/api/src/scripts/prueba-facturador.ts` hace el recorrido completo con un pago de ejemplo
armado igual que los del punto de venta: un anticipo de **$1,000 con IVA incluido**, pagado con
transferencia ($600) y efectivo ($400). Los pasos son estos:

1. **Autenticación:** token OAuth2 con usuario (RFC), contraseña en MD5, `client_id` y `client_secret`.
2. **Emisor:** obtiene su `emisorId` en `/connect/userinfo`.
3. **Factura:** CFDI 4.0 de ingreso, pago en una exhibición (PUE), IVA 16 % trasladado. Base
   $862.07 + IVA $137.93 = $1,000. Forma de pago 03, porque es la parte más grande. Receptor
   de pruebas `EKU9003173C9`.
4. **XML timbrado:** lo descarga y revisa que el total y el IVA salgan correctos.
5. **PDF:** pide la representación impresa y da el enlace.
6. **Cancelación:** va aparte, 15 minutos después, porque el SAT de pruebas tarda en dejar
   cancelar. Usa `--cancelar <UUID>` con motivo 02.

El JSON enviado, el XML y el enlace al PDF quedan en la carpeta temporal del sistema
(`hsa-facturador-prueba`), para mandárselos a Facturador si los piden.

## Cómo correrla

1. En el `.env` de la raíz, llena las variables `FACTURADOR_*` (ver `.env.example`) con los
   **datos de prueba** de apidocs.facturador.com → Autenticación:
   - usuario, contraseña en MD5, `CLIENT_ID` y `CLIENT_SECRET`;
   - el emisor de pruebas: razón social, régimen fiscal y CP.

   No pongas `FACTURADOR_AUTH_URL` ni `FACTURADOR_API_URL`: sin ellas se usa el ambiente de
   pruebas, y la prueba se niega a correr contra producción.
2. Corre:

   ```
   pnpm --filter @hsa/api exec dotenv -e ../../.env -- tsx src/scripts/prueba-facturador.ts
   ```

3. A los 15 minutos, cancela la factura de prueba con el UUID que imprimió:

   ```
   pnpm --filter @hsa/api exec dotenv -e ../../.env -- tsx src/scripts/prueba-facturador.ts --cancelar <UUID>
   ```

## Resultado de la prueba (12-oct-2026)

Timbró bien en el ambiente de pruebas: UUID `33743926-4632-493A-B0F1-3E4E843CB361`, serie 001,
total $1,000 (subtotal $862.07 + IVA $137.93), forma de pago 03, PUE. Lo que aprendimos:
- Facturador exige una **serie que exista** en la cuenta, con su `serieId`. Con la serie vacía
  responde FAC100; con una que no existe, FAC112. Se consultan con `GET /emisores/{id}/series`.
- En el `.env`, `CLIENT_ID` es el valor corto y `CLIENT_SECRET` el largo con guiones. Invertidos
  dan `invalid_client`.

## Direcciones de producción (las mandó Facturador el 13-oct-2026)

| | Pruebas | Producción |
|---|---|---|
| Token y emisor | `https://authcli.stagefacturador.com` | `https://auth.facturador.com` |
| API | `https://pruebas.stagefacturador.com/BusinessEmision/api/v1` | `https://emision-api.facturador.com/api/v1` |

En producción la API **no lleva** `/BusinessEmision`. Las rutas son las mismas:
- `/connect/token` y `/connect/userinfo`;
- `/emisores/{id}/comprobantes?emitir=true` (emitir);
- `/comprobantes/{uuid}` (consultar con GET, cancelar con DELETE);
- `/descargacomprobantes/{uuid}?tipoContenido=xml`;
- `/pdfs/{uuid}` y `/comprobantes/{uuid}/pdf`;
- `/enviocorreo`.

Para producción, en EasyPanel y nunca en git:

```
FACTURADOR_AUTH_URL=https://auth.facturador.com
FACTURADOR_API_URL=https://emision-api.facturador.com/api/v1
FACTURADOR_USUARIO=<RFC de la hacienda>
FACTURADOR_PASSWORD_MD5=<contraseña de la cuenta, en MD5>
FACTURADOR_CLIENT_ID=<del menú Desarrolladores de la cuenta de la hacienda>
FACTURADOR_CLIENT_SECRET=<ídem>
```

La prueba de compatibilidad se niega a correr con estas direcciones: en producción cada factura
es real.

## Lo que falta para producción (no es parte de la prueba)

- **Facturador:** activar la API en la cuenta de la hacienda. Un admin genera el `client_id` y el
  `client_secret` en Configuración → Desarrolladores, y su agente da las URL productivas.
- **CSD:** el certificado de sello digital de la hacienda, cargado en su cuenta de Facturador.
- **Contador:**
  - el esquema (factura por cada pago, o factura PPD + complemento de pagos por abono);
  - la clave de producto o servicio del SAT (`FACTURADOR_CLAVE_PROD_SERV`; la prueba usa
    `01010101`);
  - la serie. Facturador exige una que exista en la cuenta (nombre e id). La prueba consulta las
    series de la cuenta y usa la primera de facturas, o la que diga `FACTURADOR_SERIE`.
- **Variables de producción:** en EasyPanel, nunca en git (este repositorio es público).
