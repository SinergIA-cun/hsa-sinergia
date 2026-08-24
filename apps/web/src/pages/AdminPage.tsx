import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { ArrowDivider, Card } from '../components/ui.tsx';
import { UsersSection } from '../components/admin/UsersSection.tsx';
import { PersonalSection } from '../components/admin/PersonalSection.tsx';
import { CatalogosSection } from '../components/admin/CatalogosSection.tsx';

export function AdminPage() {
  return (
    <div className="space-y-10">
      <div>
        <ArrowDivider>Administración</ArrowDivider>
        <h1 className="mt-2 font-display text-4xl text-ink">Panel de admin</h1>
      </div>
      <UsersSection />

      {/* La bitácora forense no es una sección más: es una herramienta de
          investigación, y meterla aquí como lista sería competir con la línea de
          tiempo del evento, que es la que el equipo lee todos los días. */}
      <Link to="/admin/auditoria" className="block">
        <Card className="flex items-center gap-4 p-5 transition-shadow hover:shadow-md">
          <ShieldCheck size={22} className="shrink-0 text-gold" />
          <span>
            <span className="block font-display text-xl text-ink">Bitácora forense</span>
            <span className="block text-sm text-charcoal-soft">
              Qué fila cambió, cómo estaba antes y de dónde vino el cambio — incluso si no pasó por
              la aplicación.
            </span>
          </span>
        </Card>
      </Link>
      <PersonalSection />
      {/* Los banqueteros se fueron a su propia pantalla (`/banqueteros`): son
          cartera, no configuración, y ventas también los necesita. */}
      {/* Todo lo que es del CATÁLOGO se edita dentro del catálogo: parámetros
          (IVA, hora extra, descuento, capilla), servicios, alimentos, renta y DJ.
          Las secciones viejas "Configuración" y "Extras" escribían sobre el
          catálogo activo y eran un segundo camino al mismo dato; se retiraron. */}
      <CatalogosSection />
    </div>
  );
}
