import { ArrowDivider } from '../components/ui.tsx';
import { UsersSection } from '../components/admin/UsersSection.tsx';
import { BanqueterosSection } from '../components/admin/BanqueterosSection.tsx';
import { PersonalSection } from '../components/admin/PersonalSection.tsx';
import { AddonsSection } from '../components/admin/AddonsSection.tsx';
import { CatalogosSection } from '../components/admin/CatalogosSection.tsx';
import { ConfigSection } from '../components/admin/ConfigSection.tsx';

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
      {/* Catálogos va antes de Configuración: Configuración edita los parámetros
          DEL catálogo activo, así que primero hay que saber cuál es. */}
      <CatalogosSection />
      <ConfigSection />
    </div>
  );
}
