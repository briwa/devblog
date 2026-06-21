// Stub /admin components in prod builds so their heavy deps aren't compiled into an orphaned chunk (withastro/astro#4564).
const ADMIN_ONLY_DIR = 'components/admin/';

function isAdminModule(source) {
  return source.replaceAll('\\', '/').includes(ADMIN_ONLY_DIR);
}

function stubAdminModules() {
  const prefix = '\0admin-stub:';
  return {
    name: 'stub-admin-only-modules',
    apply: 'build',
    enforce: 'pre', // before Astro's own resolvers
    resolveId(source) {
      return isAdminModule(source) ? prefix + source : null;
    },
    load(id) {
      return id.startsWith(prefix) ? 'export default function AdminStub() { return null; }' : null;
    },
  };
}

export function adminBuild() {
  return {
    name: 'admin-build',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({ vite: { plugins: [stubAdminModules()] } });
      },
    },
  };
}
