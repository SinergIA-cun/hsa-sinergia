# Manuales de uso

Dos manuales para el equipo de Hacienda San Andrés, con su marca:

| Archivo | Para quién |
|---|---|
| `manual-vendedor.pdf` | Perfil **ventas**: armar contratos, compartirlos, cobrar |
| `manual-administrador.pdf` | Perfil **admin**: precios, usuarios, dinero de banqueteros, auditoría |

## Cómo se generan

El contenido vive en los `.html`, con `estilo.css` compartido —paleta y tipografía
tomadas de `apps/web/src/index.css`, para que el manual y la aplicación se vean
como la misma cosa—. El PDF lo produce Chrome sin cabecera ni pie:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd docs/manuales
for m in manual-vendedor manual-administrador; do
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=8000 \
    --print-to-pdf="$PWD/$m.pdf" "file://$PWD/$m.html"
done
```

Necesita internet la primera vez: las tipografías (Cormorant Garamond y Archivo)
se traen de Google Fonts.

## Al cambiar la aplicación

Los manuales describen pantallas y nombres de botones REALES; se escribieron
recorriendo la app corriendo, no de memoria. Si una pantalla cambia de nombre o
de comportamiento, hay que actualizar el `.html` y volver a generar el PDF.

Lo que más fácil se desactualiza: los estatus, la tabla de qué puede cada rol, y
la sección del folio y la etiqueta.
