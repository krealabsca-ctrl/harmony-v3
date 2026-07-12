import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart2,
  Heart,
  MessageCircle,
  Share2,
  Users,
  TrendingUp,
  Loader2,
  CalendarDays,
  ChevronUp,
  Award,
} from 'lucide-react'
import DOMPurify from 'dompurify'
import api from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = 'facebook' | 'instagram' | 'tiktok' | 'twitter' | 'linkedin' | ''

interface KPIs {
  reach: number
  likes: number
  comments: number
  shares: number
  leads: number
}

interface PostMetric {
  id: number
  title: string
  platform: Exclude<Platform, ''>
  published_at: string
  reach: number
  likes: number
  comments: number
  shares: number
  ctr: number
  thumbnail_url: string | null
}

interface PaginationLink {
  url: string | null
  label: string
  active: boolean
}

interface AnalyticsResponse {
  kpis: KPIs
  top_posts: PostMetric[]
  posts: {
    data: PostMetric[]
    current_page: number
    last_page: number
    per_page: number
    total: number
    links: PaginationLink[]
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<Exclude<Platform, ''>, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'X / Twitter',
  linkedin: 'LinkedIn',
}

const PLATFORM_BADGE: Record<Exclude<Platform, ''>, string> = {
  facebook: 'bg-blue-100 text-blue-700',
  instagram: 'bg-pink-100 text-pink-700',
  tiktok: 'bg-gray-900 text-white',
  twitter: 'bg-sky-100 text-sky-700',
  linkedin: 'bg-indigo-100 text-indigo-700',
}

const PLATFORM_DOT: Record<Exclude<Platform, ''>, string> = {
  facebook: 'bg-blue-500',
  instagram: 'bg-pink-500',
  tiktok: 'bg-gray-800',
  twitter: 'bg-sky-500',
  linkedin: 'bg-indigo-500',
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtPercent(n: number): string {
  return n.toFixed(2) + '%'
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function thirtyDaysAgoStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode
  label: string
  value: string
  accent?: boolean
}

function KpiCard({ icon, label, value, accent }: KpiCardProps) {
  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm px-5 py-4 flex items-center gap-4"
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-white"
        style={accent ? { backgroundColor: 'var(--color-primary)' } : undefined}
        {...(!accent
          ? { className: 'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' }
          : {})}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide leading-none mb-1">
          {label}
        </p>
        <p
          className="text-2xl font-bold leading-none tabular-nums"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </p>
      </div>
    </div>
  )
}

interface TopPostCardProps {
  post: PostMetric
  rank: number
}

function TopPostCard({ post, rank }: TopPostCardProps) {
  const rankColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600']
  const rankLabel = ['#1', '#2', '#3']

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Award size={16} className={rankColors[rank] ?? 'text-gray-400'} />
          <span className={`text-xs font-bold ${rankColors[rank] ?? 'text-gray-400'}`}>
            {rankLabel[rank]}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              PLATFORM_BADGE[post.platform] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                PLATFORM_DOT[post.platform] ?? 'bg-gray-400 dark:bg-gray-500'
              }`}
            />
            {PLATFORM_LABELS[post.platform] ?? post.platform}
          </span>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
          {new Date(post.published_at).toLocaleDateString('es-CR', {
            day: '2-digit',
            month: 'short',
          })}
        </span>
      </div>

      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">
        {post.title}
      </p>

      <div className="grid grid-cols-3 gap-2 pt-1">
        <div className="text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">Alcance</p>
          <p className="text-sm font-bold text-gray-800 dark:text-gray-200 tabular-nums">{fmt(post.reach)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">Likes</p>
          <p className="text-sm font-bold text-gray-800 dark:text-gray-200 tabular-nums">{fmt(post.likes)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">CTR</p>
          <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-primary)' }}>
            {fmtPercent(post.ctr)}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PubAnalyticsPage() {
  const [from, setFrom] = useState(thirtyDaysAgoStr())
  const [to, setTo] = useState(todayStr())
  const [platform, setPlatform] = useState<Platform>('')
  const [page, setPage] = useState(1)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [from, to, platform])

  const { data, isLoading, isFetching } = useQuery<AnalyticsResponse>({
    queryKey: ['pub-analytics', from, to, platform, page],
    queryFn: async () => {
      const res = await api.get('/pub/analytics', {
        params: { from, to, platform: platform || undefined, page },
      })
      return res.data
    },
    placeholderData: (prev) => prev,
  })

  const kpis = data?.kpis
  const posts = data?.posts
  const topPosts = data?.top_posts ?? []

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Analíticas de publicaciones</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Rendimiento de publicaciones por plataforma y período
          </p>
        </div>
        {isFetching && !isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
            <Loader2 size={13} className="animate-spin" />
            Actualizando...
          </span>
        )}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 bg-white dark:bg-gray-700 focus-within:ring-2 focus-within:ring-[var(--color-primary)]/30 focus-within:border-[var(--color-primary)] flex-1 max-w-xs">
          <CalendarDays size={15} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-transparent text-sm text-gray-700 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none w-full"
            aria-label="Fecha de inicio"
          />
        </div>
        <div className="relative flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 bg-white dark:bg-gray-700 focus-within:ring-2 focus-within:ring-[var(--color-primary)]/30 focus-within:border-[var(--color-primary)] flex-1 max-w-xs">
          <CalendarDays size={15} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-transparent text-sm text-gray-700 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none w-full"
            aria-label="Fecha de fin"
          />
        </div>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
        >
          <option value="">Todas las plataformas</option>
          {(Object.keys(PLATFORM_LABELS) as Exclude<Platform, ''>[]).map((p) => (
            <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
          ))}
        </select>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm h-20 animate-pulse" />
          ))}
        </div>
      ) : kpis ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            icon={<Users size={20} />}
            label="Alcance total"
            value={fmt(kpis.reach)}
            accent
          />
          <KpiCard
            icon={<Heart size={20} />}
            label="Likes totales"
            value={fmt(kpis.likes)}
          />
          <KpiCard
            icon={<MessageCircle size={20} />}
            label="Comentarios"
            value={fmt(kpis.comments)}
          />
          <KpiCard
            icon={<Share2 size={20} />}
            label="Shares"
            value={fmt(kpis.shares)}
          />
          <KpiCard
            icon={<TrendingUp size={20} />}
            label="Leads generados"
            value={fmt(kpis.leads)}
          />
        </div>
      ) : null}

      {/* ── Top 3 Posts ────────────────────────────────────────────────────── */}
      {topPosts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ChevronUp size={16} className="text-gray-400 dark:text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
              Top publicaciones del período
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topPosts.slice(0, 3).map((post, i) => (
              <TopPostCard key={post.id} post={post} rank={i} />
            ))}
          </div>
        </div>
      )}

      {/* ── Posts Table ────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <BarChart2 size={16} style={{ color: 'var(--color-primary)' }} />
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Rendimiento por publicación
          </h2>
          {posts && (
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
              {posts.total} publicación{posts.total !== 1 ? 'es' : ''}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            Cargando datos...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-6 py-3">
                    Publicación
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-4 py-3">
                    Plataforma
                  </th>
                  <th className="text-right text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-4 py-3">
                    Alcance
                  </th>
                  <th className="text-right text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-4 py-3">
                    Likes
                  </th>
                  <th className="text-right text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-4 py-3">
                    Comentarios
                  </th>
                  <th className="text-right text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-6 py-3">
                    CTR
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {posts?.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400 dark:text-gray-500">
                      No hay publicaciones para este período
                    </td>
                  </tr>
                )}
                {posts?.data.map((post) => (
                  <tr key={post.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700 transition-colors">
                    {/* Title + date */}
                    <td className="px-6 py-4 max-w-xs">
                      <p className="font-medium text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">
                        {post.title}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {new Date(post.published_at).toLocaleDateString('es-CR', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                    </td>

                    {/* Platform */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          PLATFORM_BADGE[post.platform] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            PLATFORM_DOT[post.platform] ?? 'bg-gray-400 dark:bg-gray-500'
                          }`}
                        />
                        {PLATFORM_LABELS[post.platform] ?? post.platform}
                      </span>
                    </td>

                    {/* Reach */}
                    <td className="px-4 py-4 text-right text-gray-700 dark:text-gray-300 tabular-nums font-medium">
                      {fmt(post.reach)}
                    </td>

                    {/* Likes */}
                    <td className="px-4 py-4 text-right tabular-nums">
                      <span className="flex items-center justify-end gap-1 text-pink-600">
                        <Heart size={12} />
                        {fmt(post.likes)}
                      </span>
                    </td>

                    {/* Comments */}
                    <td className="px-4 py-4 text-right tabular-nums">
                      <span className="flex items-center justify-end gap-1 text-blue-500">
                        <MessageCircle size={12} />
                        {fmt(post.comments)}
                      </span>
                    </td>

                    {/* CTR */}
                    <td className="px-6 py-4 text-right tabular-nums">
                      <span
                        className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-lg ${
                          post.ctr >= 3
                            ? 'bg-green-100 text-green-700'
                            : post.ctr >= 1
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {fmtPercent(post.ctr)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {posts && posts.last_page > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Mostrando {posts.data.length} de {posts.total} publicaciones
            </p>
            <div className="flex items-center gap-1">
              {posts.links.map((link, i) => {
                const isDisabled = !link.url
                const isCurrent = link.active
                const label = link.label
                  .replace('&laquo;', '«')
                  .replace('&raquo;', '»')
                return (
                  <button
                    key={i}
                    disabled={isDisabled}
                    onClick={() => {
                      if (!link.url) return
                      const url = new URL(link.url, window.location.origin)
                      const p = url.searchParams.get('page')
                      if (p) setPage(Number(p))
                    }}
                    className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
                      isCurrent
                        ? 'text-white shadow-sm'
                        : isDisabled
                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    style={isCurrent ? { backgroundColor: 'var(--color-primary)' } : undefined}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(label) }}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
