import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
import api from '@/api/client'
import {
  Image as ImageIcon,
  Plus,
  Pencil,
  Trash2,
  Clock,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Upload,
  Globe,
} from 'lucide-react'

type PostStatus = 'draft' | 'scheduled' | 'pending_approval' | 'published' | 'failed'

interface Post {
  id: number
  thumbnail_url?: string
  caption: string
  caption_instagram?: string
  caption_facebook?: string
  platforms: string[]
  status: PostStatus
  scheduled_at?: string
  campaign_id?: number
  campaign?: { id: number; name: string }
  approval_required?: boolean
  note?: string
}

interface PaginatedPosts {
  data: Post[]
  links: { url: string | null; label: string; active: boolean }[]
  current_page: number
  last_page: number
}

interface Campaign {
  id: number
  name: string
}

const STATUS_CONFIG: Record<PostStatus, { label: string; bg: string; text: string }> = {
  draft: { label: 'Borrador', bg: 'rgba(100,116,139,0.12)', text: '#64748b' },
  scheduled: { label: 'Programado', bg: 'rgba(59,130,246,0.12)', text: '#3b82f6' },
  pending_approval: { label: 'Pend. aprobacion', bg: 'rgba(245,158,11,0.12)', text: '#d97706' },
  published: { label: 'Publicado', bg: 'rgba(34,197,94,0.12)', text: '#16a34a' },
  failed: { label: 'Fallido', bg: 'rgba(239,68,68,0.12)', text: '#dc2626' },
}

function StatusBadge({ status }: { status: PostStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft
  return (
    <span style={{ background: cfg.bg, color: cfg.text, padding: '2px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  if (platform === 'instagram')
    return (
      <span style={{ background: 'rgba(236,72,153,0.12)', color: '#db2777', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <Globe size={11} /> IG
      </span>
    )
  if (platform === 'facebook')
    return (
      <span style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <Globe size={11} /> FB
      </span>
    )
  return null
}

function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Devuelve el mejor caption disponible: general → instagram → facebook
function bestCaption(post: Post): string {
  return post.caption || post.caption_instagram || post.caption_facebook || ''
}

export default function PubContentStudioPage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [editPost, setEditPost] = useState<Post | null | 'new'>(null)
  const [deletePost, setDeletePost] = useState<Post | null>(null)

  const { data, isLoading } = useQuery<PaginatedPosts>({
    queryKey: ['pub-posts', statusFilter, platformFilter, dateFrom, dateTo, page],
    queryFn: () =>
      api.get('/pub/posts', { params: { status: statusFilter || undefined, platform: platformFilter || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, page } }).then((r) => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/pub/posts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pub-posts'] }); setDeletePost(null) },
  })

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Content Studio</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-muted)' }}>Crea, programa y aprueba publicaciones en redes sociales.</p>
        </div>
        <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setEditPost('new')}>
          <Plus size={16} /> Nuevo post
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <select className="form-select" style={{ minWidth: 160, flex: '0 0 auto' }} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="scheduled">Programado</option>
          <option value="pending_approval">Pend. aprobacion</option>
          <option value="published">Publicado</option>
          <option value="failed">Fallido</option>
        </select>
        <select className="form-select" style={{ minWidth: 160, flex: '0 0 auto' }} value={platformFilter} onChange={(e) => { setPlatformFilter(e.target.value); setPage(1) }}>
          <option value="">Todas las plataformas</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
        </select>
        <input type="date" className="form-input" style={{ width: 150, flex: '0 0 auto' }} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} />
        <input type="date" className="form-input" style={{ width: 150, flex: '0 0 auto' }} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} />
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['', 'Caption', 'Plataformas', 'Estado', 'Programado', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--color-muted)' }}>Cargando...</td></tr>
              ) : !data?.data?.length ? (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--color-muted)' }}>No hay posts.</td></tr>
              ) : (
                data.data.map((post) => (
                  <tr key={post.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      {post.thumbnail_url ? (
                        <img src={post.thumbnail_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 6, background: 'var(--color-surface-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ImageIcon size={20} color="var(--color-muted)" />
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', maxWidth: 320 }}>
                      <div style={{ fontSize: 13, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4, marginBottom: post.campaign ? 4 : 0, color: bestCaption(post) ? 'inherit' : 'var(--color-muted)' }}>
                        {bestCaption(post) || <span style={{ fontStyle: 'italic' }}>Sin caption</span>}
                      </div>
                      {post.campaign && (
                        <span style={{ background: 'rgba(var(--color-primary-rgb),0.10)', color: 'var(--color-primary)', padding: '1px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600 }}>
                          {post.campaign.name}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {post.platforms?.map((p) => <PlatformBadge key={p} platform={p} />)}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}><StatusBadge status={post.status} /></td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      {post.scheduled_at ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--color-muted)' }}>
                          <Clock size={13} />{formatDate(post.scheduled_at)}
                        </span>
                      ) : <span style={{ color: 'var(--color-muted)', fontSize: 13 }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {post.status === 'pending_approval' && (
                          <button style={{ background: 'rgba(245,158,11,0.12)', color: '#d97706', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                            Revisar
                          </button>
                        )}
                        <button className="icon-btn" onClick={() => setEditPost(post)} title="Editar"><Pencil size={15} /></button>
                        <button className="icon-btn icon-btn-danger" onClick={() => setDeletePost(post)} title="Eliminar"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data?.links && data.links.length > 3 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '12px 0', borderTop: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
            {data.links.map((link, i) => {
              const isFirst = i === 0
              const isLast = i === data.links.length - 1
              const pageNum = isFirst ? page - 1 : isLast ? page + 1 : parseInt(link.label)
              return (
                <button key={i} disabled={!link.url} onClick={() => link.url && setPage(pageNum)}
                  style={{ minWidth: 32, height: 32, borderRadius: 6, border: link.active ? '1.5px solid var(--color-primary)' : '1px solid var(--color-border)', background: link.active ? 'var(--color-primary)' : 'transparent', color: link.active ? '#fff' : 'var(--color-text)', fontWeight: link.active ? 700 : 400, fontSize: 13, cursor: link.url ? 'pointer' : 'not-allowed', opacity: link.url ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
                  {isFirst ? <ChevronLeft size={14} /> : isLast ? <ChevronRight size={14} /> : <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(link.label) }} />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {editPost !== null && (
        <PostFormModal post={editPost === 'new' ? null : editPost} onClose={() => setEditPost(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['pub-posts'] }); setEditPost(null) }} />
      )}
      {deletePost && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">¿Eliminar este post?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeletePost(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-xl">Cancelar</button>
              <button onClick={() => { deleteMutation.mutate(deletePost.id); setDeletePost(null) }} className="px-4 py-2 text-sm text-white bg-red-500 rounded-xl">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PostFormModal({ post, onClose, onSaved }: { post: Post | null; onClose: () => void; onSaved: () => void }) {
  const [captionTab, setCaptionTab] = useState<'general' | 'instagram' | 'facebook'>('general')
  const [caption, setCaption] = useState(post?.caption ?? '')
  const [captionIg, setCaptionIg] = useState(post?.caption_instagram ?? '')
  const [captionFb, setCaptionFb] = useState(post?.caption_facebook ?? '')
  const [platforms, setPlatforms] = useState<string[]>(post?.platforms ?? [])
  const [campaignId, setCampaignId] = useState<string>(post?.campaign_id ? String(post.campaign_id) : '')
  const [publishMode, setPublishMode] = useState<'draft' | 'scheduled' | 'now'>(post?.scheduled_at ? 'scheduled' : 'draft')
  const [scheduledAt, setScheduledAt] = useState(post?.scheduled_at ? post.scheduled_at.slice(0, 16) : '')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string>(post?.thumbnail_url ?? '')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: campaigns } = useQuery<Campaign[]>({
    queryKey: ['pub-campaigns-list'],
    queryFn: () => api.get('/pub/campaigns').then((r) => r.data?.data ?? r.data),
  })

  const mutation = useMutation({
    mutationFn: (fd: FormData) => post ? api.post(`/pub/posts/${post.id}?_method=PUT`, fd) : api.post('/pub/posts', fd),
    onSuccess: onSaved,
  })

  const handleImage = useCallback((file: File) => {
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/')) handleImage(file)
  }

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const fd = new FormData()
    fd.append('caption', caption)
    fd.append('caption_instagram', captionIg)
    fd.append('caption_facebook', captionFb)
    platforms.forEach((p) => fd.append('platforms[]', p))
    if (campaignId) fd.append('campaign_id', campaignId)
    fd.append('status', publishMode === 'draft' ? 'draft' : publishMode === 'now' ? 'pending_approval' : 'scheduled')
    if (publishMode === 'scheduled' && scheduledAt) fd.append('scheduled_at', scheduledAt)
    if (imageFile) fd.append('image', imageFile)
    mutation.mutate(fd)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640, width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{post ? 'Editar post' : 'Nuevo post'}</h2>
          <button className="icon-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label className="form-label">Imagen</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{ border: `2px dashed ${isDragging ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 10, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', overflow: 'hidden', background: isDragging ? 'rgba(var(--color-primary-rgb),0.04)' : 'var(--color-surface-alt)', transition: 'border-color 0.15s' }}
            >
              {imagePreview ? (
                <>
                  <img src={imagePreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div className="dropzone-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>Cambiar imagen</span>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
                  <Upload size={28} style={{ marginBottom: 6 }} />
                  <p style={{ margin: 0, fontSize: 13 }}>Arrastra una imagen o haz clic para seleccionar</p>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImage(f) }} />
          </div>

          <div>
            <label className="form-label">Caption</label>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 10 }}>
              {(['general', 'instagram', 'facebook'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setCaptionTab(t)}
                  style={{ padding: '6px 14px', fontSize: 13, fontWeight: captionTab === t ? 700 : 400, background: 'none', border: 'none', borderBottom: captionTab === t ? '2px solid var(--color-primary)' : '2px solid transparent', cursor: 'pointer', color: captionTab === t ? 'var(--color-primary)' : 'var(--color-muted)', marginBottom: -1 }}>
                  {t === 'general' ? 'General' : t === 'instagram' ? 'Instagram' : 'Facebook'}
                </button>
              ))}
            </div>
            {captionTab === 'general' && <textarea className="form-input" rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption general..." style={{ width: '100%', resize: 'vertical' }} />}
            {captionTab === 'instagram' && <textarea className="form-input" rows={4} value={captionIg} onChange={(e) => setCaptionIg(e.target.value)} placeholder="Caption especifico para Instagram (opcional)..." style={{ width: '100%', resize: 'vertical' }} />}
            {captionTab === 'facebook' && <textarea className="form-input" rows={4} value={captionFb} onChange={(e) => setCaptionFb(e.target.value)} placeholder="Caption especifico para Facebook (opcional)..." style={{ width: '100%', resize: 'vertical' }} />}
          </div>

          <div>
            <label className="form-label">Plataformas</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {[{ key: 'instagram', label: 'Instagram', icon: <Globe size={15} /> }, { key: 'facebook', label: 'Facebook', icon: <Globe size={15} /> }].map(({ key, label, icon }) => {
                const active = platforms.includes(key)
                return (
                  <button key={key} type="button" onClick={() => togglePlatform(key)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, border: active ? '2px solid var(--color-primary)' : '1.5px solid var(--color-border)', background: active ? 'rgba(var(--color-primary-rgb),0.07)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-muted)', fontWeight: active ? 700 : 400, fontSize: 13, cursor: 'pointer', transition: 'all 0.12s' }}>
                    {icon} {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="form-label">Campana</label>
            <select className="form-select" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ width: '100%' }}>
              <option value="">Sin campana</option>
              {campaigns?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="form-label">Modo de publicacion</label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[{ key: 'draft', label: 'Borrador' }, { key: 'scheduled', label: 'Programar' }, { key: 'now', label: 'Publicar ahora' }].map(({ key, label }) => {
                const active = publishMode === key
                return (
                  <button key={key} type="button" onClick={() => setPublishMode(key as typeof publishMode)}
                    style={{ padding: '7px 16px', borderRadius: 8, border: active ? '2px solid var(--color-primary)' : '1.5px solid var(--color-border)', background: active ? 'rgba(var(--color-primary-rgb),0.07)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-muted)', fontWeight: active ? 700 : 400, fontSize: 13, cursor: 'pointer' }}>
                    {label}
                  </button>
                )
              })}
            </div>
            {publishMode === 'scheduled' && (
              <div style={{ marginTop: 10 }}>
                <input type="datetime-local" className="form-input" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={{ width: '100%' }} />
              </div>
            )}
            {publishMode === 'now' && (
              <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.10)', color: '#92400e', fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertCircle size={16} style={{ marginTop: 1, flexShrink: 0 }} />
                Este post quedara en estado <strong>Pendiente de aprobacion</strong> hasta que un administrador lo apruebe antes de publicarse.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando...' : post ? 'Guardar cambios' : 'Crear post'}
            </button>
          </div>
        </form>
      </div>
      <style>{`.dropzone-overlay { opacity: 0; transition: opacity 0.15s; } div:hover > .dropzone-overlay { opacity: 1; }`}</style>
    </div>
  )
}
