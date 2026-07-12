import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Eye, ImageOff, Globe } from 'lucide-react';
import api from '@/api/client';

// -- Types --------------------------------------------------------------------

interface PubDashboardData {
  kpis: {
    postsThisMonth: number;
    pendingApproval: number;
    leadsCapturados: number;
    totalReach: number;
  };
  recentPosts: RecentPost[];
  recentLeads: RecentLead[];
}

interface RecentPost {
  id: string | number;
  thumbnail?: string;
  title: string;
  platform: 'instagram' | 'facebook';
  status: 'published' | 'pending' | 'scheduled' | 'draft';
  scheduledAt?: string;
}

interface RecentLead {
  id: string | number;
  name: string;
  message: string;
  createdAt: string;
  platform: 'instagram' | 'facebook';
}

// -- Helpers ------------------------------------------------------------------

function formatReach(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// -- Sub-components -----------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

function KpiCard({ label, value, accent }: KpiCardProps) {
  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col gap-1"
      style={accent ? { borderTopColor: 'var(--color-primary)', borderTopWidth: 3 } : undefined}
    >
      <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide">{label}</span>
      <span
        className="text-3xl font-bold"
        style={{
          color: accent ? 'var(--color-primary)' : undefined,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PlatformBadge({ platform }: { platform: 'instagram' | 'facebook' }) {
  if (platform === 'instagram') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-pink-50 text-pink-600">
        <Globe size={11} />
        Instagram
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-600">
      <Globe size={11} />
      Facebook
    </span>
  );
}

function StatusBadge({ status }: { status: RecentPost['status'] }) {
  const map: Record<RecentPost['status'], { label: string; className: string }> = {
    published: { label: 'Publicado', className: 'bg-green-50 text-green-700' },
    pending: { label: 'Pendiente', className: 'bg-yellow-50 text-yellow-700' },
    scheduled: { label: 'Programado', className: 'bg-sky-50 text-sky-700' },
    draft: { label: 'Borrador', className: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 dark:text-gray-500' },
  };
  const { label, className } = map[status] ?? map.draft;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-10 flex flex-col items-center gap-2 text-gray-400 dark:text-gray-500">
      <ImageOff size={32} strokeWidth={1.5} />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// -- Fetch --------------------------------------------------------------------

async function fetchPubDashboard(): Promise<PubDashboardData> {
  const res = await api.get('/pub/dashboard');
  return res.data;
}

// -- Page ---------------------------------------------------------------------

export default function PubDashboardPage() {
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery<PubDashboardData>({
    queryKey: ['pub-dashboard'],
    queryFn: fetchPubDashboard,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500 text-sm">
        Cargando panel de publicaciones...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400 text-sm">
        No se pudo cargar el panel. Intenta de nuevo.
      </div>
    );
  }

  const { kpis, recentPosts, recentLeads } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Publicaciones</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-0.5">Resumen de actividad en redes sociales</p>
        </div>
        <button
          onClick={() => navigate('/pub/content-studio')}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Eye size={15} />
          Content Studio
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Posts este mes" value={kpis.postsThisMonth} accent />
        <KpiCard label="Pendientes de aprobacion" value={kpis.pendingApproval} />
        <KpiCard label="Leads capturados" value={kpis.leadsCapturados} />
        <KpiCard label="Alcance total" value={formatReach(kpis.totalReach)} />
      </div>

      {/* Two-column panels */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Posts */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Posts recientes</h2>
            <button
              onClick={() => navigate('/pub/calendar')}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 transition-colors"
            >
              Ver todos
            </button>
          </div>

          <div className="overflow-x-auto">
            {recentPosts.length === 0 ? (
              <EmptyState message="Sin posts recientes" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                    <th className="px-5 py-2 text-left">Post</th>
                    <th className="px-3 py-2 text-left">Plataforma</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                    <th className="px-3 py-2 text-left" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      Fecha
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentPosts.map((post) => (
                    <tr key={post.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {post.thumbnail ? (
                            <img
                              src={post.thumbnail}
                              alt=""
                              className="h-9 w-9 rounded-lg object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                              <Eye size={14} className="text-gray-400 dark:text-gray-500" />
                            </div>
                          )}
                          <span className="truncate max-w-[140px] text-gray-800 dark:text-gray-200">{post.title}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <PlatformBadge platform={post.platform} />
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={post.status} />
                      </td>
                      <td className="px-3 py-3 text-gray-500 dark:text-gray-400 dark:text-gray-500 whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {post.scheduledAt
                          ? new Date(post.scheduledAt).toLocaleDateString('es-CR', {
                              day: '2-digit',
                              month: 'short',
                            })
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Recent Leads */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Leads recientes</h2>
            <button
              onClick={() => navigate('/pub/leads')}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 transition-colors"
            >
              Ver todos
            </button>
          </div>

          {recentLeads.length === 0 ? (
            <EmptyState message="Sin leads recientes" />
          ) : (
            <ul className="divide-y divide-gray-50">
              {recentLeads.map((lead) => (
                <li key={lead.id} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors">
                  <div
                    className="h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    {initials(lead.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{lead.name}</span>
                      <PlatformBadge platform={lead.platform} />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 truncate mt-0.5">{lead.message}</p>
                  </div>
                  <span
                    className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap mt-0.5"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {relativeTime(lead.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
