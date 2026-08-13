import { ArrowDivider } from '../components/ui.tsx';
import { UsersSection } from '../components/admin/UsersSection.tsx';
import { BanqueterosSection } from '../components/admin/BanqueterosSection.tsx';
import { PersonalSection } from '../components/admin/PersonalSection.tsx';
import { AddonsSection } from '../components/admin/AddonsSection.tsx';
import { CatalogosSection } from '../components/admin/CatalogosSection.tsx';

export function AdminPage() {
  return (
    <div className="space-y-10">
      <div>
        <ArrowDivider>Administración</ArrowDivider>
        <h1 className="mt-2 font-display text-4xl text-ink">Panel de admin</h1>
      </div>
      <UsersSection />
      <BanqueterosSection />
      <PersonalSection />
      <AddonsSection />
      {/* Los parámetros (IVA, hora extra, descuento, capilla) se editan DENTRO
          del catálogo, no en una sección aparte: la vieja "Configuración"
          escribía sobre el activo y era un segundo camino al mismo dato. */}
      <CatalogosSection />
    </div>
  );
}
