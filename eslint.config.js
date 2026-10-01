import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.vite/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    // La dirección de la API se lee al ARRANCAR (`/config.js`), no al compilar:
    // `VITE_API_URL` ya viene vacía en la imagen. Leerla directo dejaba las
    // subidas con foto apuntando al dominio de la web, sin API (los pagos con
    // comprobante dejaron de registrarse en producción). Usa `apiUrl`/`API_BASE`.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/lib/api.ts', 'apps/web/src/lib/config.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='VITE_API_URL']",
          message: 'Usa API_BASE o apiUrl() de lib/api.ts: la dirección de la API se lee al arrancar.',
        },
      ],
    },
  },
);
