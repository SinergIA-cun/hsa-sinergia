import { ArrowDivider } from '../components/ui.tsx';
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
