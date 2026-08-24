import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // 'lax' funciona si web y api comparten dominio raíz (p.ej. subdominios de
  // somossinergia.com). Si terminan en dominios totalmente distintos, usar
  // 'none' (requiere COOKIE_SECURE=true, que los navegadores exigen para None).
  COOKIE_SAME_SITE: z.enum(['lax', 'none', 'strict']).default('lax'),
  // Directorio donde se guardan las fotos de comprobante de pago. En producción
  // debe apuntar a un volumen persistente del VPS. (El adaptador Drive futuro
  // ignorará este valor.)
  COMPROBANTES_DIR: z.string().default('./data/comprobantes'),
  // Cuánto se guarda la bitácora forense. Cinco años por omisión, que es lo que
  // el SAT exige conservar de la contabilidad; esta bitácora acompaña a los
  // movimientos de dinero que sustentan esos comprobantes.
  AUDITORIA_RETENCION_DIAS: z.coerce.number().int().positive().default(1825),
  // Llave del API de solo lectura para el BI. Si no está, el módulo /api/bi
  // NO se registra y sus rutas responden 404: no hay modo "abierto" por descuido.
  //
  // La cadena vacía (BI_API_KEY= en el .env) llega como '' y fallaría el min(32);
  // se traduce a `undefined` primero para que se comporte como ausente y la API
  // arranque igual.
  BI_API_KEY: z
    .string()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().min(32, 'BI_API_KEY debe tener al menos 32 caracteres').optional())
    .optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Valida `process.env` y devuelve la configuración tipada. Lanza si falta algo. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  return parsed.data;
}

export const COOKIE_NAME = 'hsa_token';
