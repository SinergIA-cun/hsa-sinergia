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

## Lo que falta para producción (no es parte de la prueba)

- **Facturador:** activar la API en la cuenta de la hacienda. Un admin genera el `client_id` y el
  `client_secret` en Configuración → Desarrolladores, y su agente da las URL productivas.
- **CSD:** el certificado de sello digital de la hacienda, cargado en su cuenta de Facturador.
- **Contador:**
  - el esquema (factura por cada pago, o factura PPD + complemento de pagos por abono);
  - la clave de producto o servicio del SAT (`FACTURADOR_CLAVE_PROD_SERV`; la prueba usa
    `01010101`);
  - la serie (`FACTURADOR_SERIE` y, si la cuenta tiene varias, `FACTURADOR_SERIE_ID`; Facturador
    la exige, y la prueba usa la de su cuenta de pruebas, `Sin Serie`).
- **Variables de producción:** en EasyPanel, nunca en git (este repositorio es público).
