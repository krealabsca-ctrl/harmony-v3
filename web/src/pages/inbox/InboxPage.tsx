import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Send, Paperclip, CheckCheck, MessageSquare, Search, X,
  UserPlus, Tag, RotateCcw, PhoneCall, Plus,
  AlertTriangle, Clock, Lock, ChevronDown, ChevronLeft, Pencil, FileText,
  Volume2, History,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { useWebSocket } from '@/hooks/useWebSocket'

// ─── Descripción ───────────────────────────────────────────────────────────────
/*
 * InboxPage — Bandeja de entrada omnicanal de Harmony v3
 *
 * Propósito:
 *   Página principal de atención al cliente. Muestra la lista de conversaciones
 *   activas con filtros por estado (Todos / Abiertos / No leídos) y permite
 *   al agente seleccionar una conversación para leer y enviar mensajes en tiempo real.
 *
 * Sub-componentes principales:
 *   - ConversationRow    : fila de la lista lateral con avatar, nombre, etiquetas e indicadores
 *   - WindowBadge        : contador regresivo de la ventana de 24h de WhatsApp
 *   - MessageBubble      : burbuja de mensaje entrante/saliente con adjuntos
 *   - AttachmentPreview  : previsualización de imagen/audio/video/documento
 *   - ChannelIcon        : ícono SVG del canal (WhatsApp, Messenger, Instagram, etc.)
 *   - TransferModal      : modal de reasignación de conversación a departamento/agente
 *   - TemplateModal      : modal para seleccionar y enviar plantillas de WhatsApp
 *   - TagDropdown        : menú desplegable para agregar/quitar etiquetas
 *   - BulkReassignModal  : modal de reasignación masiva (solo admin/supervisor)
 *   - EditContactModal   : modal para editar nombre, teléfono y email del contacto
 *
 * Flujo de datos:
 *   1. useQuery(['conversations']) carga la lista lateral cada 12 s (polling).
 *   2. Al seleccionar una conversación, useQuery(['messages', id]) carga el historial.
 *   3. Los mensajes entrantes se reciben en tiempo real vía WebSocket (canal
 *      `conversation.{id}`, evento `MessageReceived`) y se insertan optimistamente
 *      en el caché de React Query sin refetch completo.
 *   4. El envío de mensajes usa useMutation → POST /conversations/{id}/messages y
 *      actualiza el caché local al completar (onSuccess).
 *   5. La lógica de ventana de 24h de WhatsApp bloquea el textarea y muestra
 *      banners contextuales cuando la ventana está por expirar o ya expiró.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface Contact {
  id: number; name: string; phone: string; email?: string; avatar_url?: string
}
interface TagObj { id: number; name: string; color: string }
interface Conversation {
  id: number; case_number: string; status: 'open' | 'pending' | 'closed'
  unread_count: number; department_id?: number; last_message_at?: string
  window_expires_at?: string
  contact?: Contact
  agent?: { id: number; name: string; department_id?: number }
  channel?: { id: number; name: string; type: string }
  tags: TagObj[]
}
interface Attachment {
  id: number; message_id: number; azure_path: string
  original_name: string; mime_type: string; size: number
}
interface Message {
  id: number; conversation_id: number; body: string; type: string
  direction: 'inbound' | 'outbound'; status: string; created_at: string
  attachments?: Attachment[]
}
interface Department { id: number; name: string; color: string }
interface Agent { id: number; name: string; is_online: boolean; department_id?: number }
interface Template {
  id: number; name: string; body: string; status: string
  components?: { type: string; format?: string; text?: string }[]
}
type TabKey = 'all' | 'open' | 'unread'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/* Genera las iniciales de hasta dos palabras del nombre para el avatar */
function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
}

/* Convierte una fecha ISO a texto relativo legible (ahora / Xm / Xh / Xd) */
function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'ahora'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/**
 * ChannelIcon
 *
 * Renderiza el ícono SVG correspondiente al canal de mensajería.
 * Usa el color de marca por defecto de cada canal, pero acepta un color
 * explícito (útil para pintar en blanco sobre fondos de marca).
 *
 * @param type  - Tipo de canal: 'whatsapp' | 'messenger' | 'instagram' | 'telegram' | 'email'
 * @param size  - Tamaño en px del SVG (por defecto 16)
 * @param color - Color de relleno opcional; si se omite usa el color de marca del canal
 *
 * Nota: Instagram tiene un caso especial: sin `color` explícito usa un gradiente CSS
 * (defs + linearGradient); con `color` explícito usa relleno sólido.
 */
// Íconos SVG de canales — color "white" cuando van sobre fondo de marca (igual que v2)
function ChannelIcon({ type, size = 16, color }: { type: string; size?: number; color?: string }) {
  const s = size
  const brandColor = color ?? (
    type === 'whatsapp' ? '#25D366' : type === 'messenger' ? '#0099FF' :
    type === 'instagram' ? '#E1306C' : type === 'telegram' ? '#229ED9' :
    type === 'email' ? '#EA4335' : '#6b7280'
  )
  if (type === 'whatsapp') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={brandColor}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.131.558 4.13 1.535 5.864L0 24l6.335-1.518A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.9 0-3.68-.518-5.21-1.42l-.374-.22-3.763.902.94-3.668-.243-.386A9.955 9.955 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
    </svg>
  )
  if (type === 'messenger') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={brandColor}>
      <path d="M12 0C5.373 0 0 5.149 0 11.499c0 3.613 1.797 6.834 4.608 8.941V24l4.208-2.312A13.17 13.17 0 0012 22.998c6.627 0 12-5.148 12-11.499C24 5.149 18.627 0 12 0zm1.191 15.517l-3.059-3.265-5.966 3.265L10.732 8.2l3.131 3.265L19.766 8.2l-6.575 7.317z"/>
    </svg>
  )
  if (type === 'instagram') return (
    color ? (
      <svg width={s} height={s} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
      </svg>
    ) : (
      // Sin color explícito: usa gradiente de marca de Instagram
      <svg width={s} height={s} viewBox="0 0 24 24">
        <defs>
          <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FD1D1D"/>
            <stop offset="50%" stopColor="#E1306C"/>
            <stop offset="100%" stopColor="#833AB4"/>
          </linearGradient>
        </defs>
        <path fill="url(#ig-grad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
      </svg>
    )
  )
  if (type === 'telegram') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={brandColor}>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.942z"/>
    </svg>
  )
  if (type === 'email') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={brandColor}>
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
    </svg>
  )
  return <svg width={s} height={s} viewBox="0 0 24 24" fill={brandColor}><circle cx="12" cy="12" r="10"/></svg>
}

/* Mapa de colores de fondo de marca por tipo de canal */
const CHANNEL_BG: Record<string, string> = {
  whatsapp: '#25D366', messenger: '#0099FF', instagram: '#E1306C',
  telegram: '#229ED9', email: '#EA4335',
}

/* Calcula cuántos segundos quedan en la ventana de 24h de WhatsApp.
   Retorna null si el canal no es WhatsApp o si no hay fecha de expiración. */
function windowSecondsLeft(conv: Conversation): number | null {
  if (conv.channel?.type !== 'whatsapp') return null
  if (!conv.window_expires_at) return null
  return Math.floor((new Date(conv.window_expires_at).getTime() - Date.now()) / 1000)
}

/* Formatea segundos como "HH:MM" o "Xh Ym" para el contador de la ventana */
function formatCountdown(secs: number): string {
  if (secs <= 0) return '00:00'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}h ${m}m`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─── WindowBadge ──────────────────────────────────────────────────────────────

/**
 * WindowBadge
 *
 * Muestra un badge con el tiempo restante de la ventana de conversación libre
 * de WhatsApp (24h desde el último mensaje del cliente).
 *
 * - Si la ventana ya expiró: badge rojo "Ventana cerrada" con ícono de candado.
 * - Si quedan ≤ 1h: badge naranja con cuenta regresiva.
 * - Si queda más de 1h: badge verde con cuenta regresiva.
 * - Si el canal no es WhatsApp o no hay fecha: no renderiza nada.
 *
 * Efecto secundario: registra un setInterval que decrementa el contador cada
 * segundo y lo limpia al desmontar o al cambiar la conversación.
 *
 * @param conv - Conversación activa; se usa `window_expires_at` y `channel.type`
 */
function WindowBadge({ conv }: { conv: Conversation }) {
  const [secs, setSecs] = useState(() => windowSecondsLeft(conv))
  useEffect(() => {
    const remaining = windowSecondsLeft(conv)
    if (remaining === null) return
    setSecs(remaining)
    // Decrementa el contador cada segundo para mantener la UI sincronizada
    const id = setInterval(() => setSecs(prev => (prev !== null ? prev - 1 : null)), 1000)
    return () => clearInterval(id)
  }, [conv.window_expires_at, conv.channel?.type])
  if (secs === null) return null
  if (secs <= 0) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <Lock size={10} /> Ventana cerrada
    </span>
  )
  if (secs <= 3600) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
      <Clock size={10} /> {formatCountdown(secs)}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
      <Clock size={10} /> {formatCountdown(secs)}
    </span>
  )
}

// ─── ConversationRow ──────────────────────────────────────────────────────────
// Layout igual a v2: avatar | info | [unread + channel icon]

/**
 * ConversationRow
 *
 * Fila de la lista lateral de conversaciones. Muestra:
 *   - Avatar con iniciales del contacto
 *   - Nombre, número de caso y etiquetas (hasta 2 visibles + contador)
 *   - Tiempo relativo del último mensaje, badge de no leídos, ícono del canal y
 *     badge de estado (No leído / Abierto / Pendiente)
 *   - Indicador "⏰ Exp." si la ventana de WhatsApp ya expiró
 *
 * @param conv     - Objeto de conversación con todos sus datos
 * @param selected - Si es true, aplica estilo de selección activa (borde izquierdo)
 * @param onClick  - Callback para seleccionar la conversación
 */
function ConversationRow({ conv, selected, onClick }: {
  conv: Conversation; selected: boolean; onClick: () => void
}) {
  const winSecs = windowSecondsLeft(conv)
  const winExpired = winSecs !== null && winSecs <= 0
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 border-b border-gray-100 dark:border-gray-700 transition-colors ${
        selected
          ? 'bg-violet-50 dark:bg-violet-900/20 border-l-[3px] border-l-[var(--color-primary)]'
          : 'hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {initials(conv.contact?.name ?? 'Sin nombre')}
        </div>

        {/* Middle: name + case + tags */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-tight">
            {conv.contact?.name ?? 'Sin nombre'}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{conv.case_number}</span>
            {/* Indicador visual de ventana expirada en la lista */}
            {winExpired && (
              <span className="text-[10px] px-1 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 font-medium">⏰ Exp.</span>
            )}
          </div>
          {/* Tags row — igual a v2 */}
          {(conv.tags ?? []).length > 0 && (
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              {/* Solo muestra las primeras 2 etiquetas para no saturar el espacio */}
              {(conv.tags ?? []).slice(0, 2).map(tag => (
                <span key={tag.id} className="px-1.5 py-0 rounded-full text-[10px] font-medium text-white"
                  style={{ backgroundColor: tag.color || '#6366f1' }}>
                  {tag.name}
                </span>
              ))}
              {(conv.tags ?? []).length > 2 && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">+{conv.tags.length - 2}</span>
              )}
            </div>
          )}
        </div>

        {/* Right side: time + unread badge + channel icon (igual a v2) */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {conv.last_message_at && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {relativeTime(conv.last_message_at)}
            </span>
          )}
          <div className="flex items-center gap-1">
            {/* Badge de mensajes no leídos — máximo "99+" */}
            {conv.unread_count > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full text-white text-[9px] flex items-center justify-center font-bold"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {conv.unread_count > 99 ? '99+' : conv.unread_count}
              </span>
            )}
            {/* Ícono del canal con color de marca de fondo */}
            {conv.channel && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0"
                style={{ backgroundColor: CHANNEL_BG[conv.channel.type] ?? '#6b7280' }}>
                <ChannelIcon type={conv.channel.type} size={11} color="white" />
              </span>
            )}
          </div>
          {/* Badge de estado — igual a v2: "No leído" (naranja) cuando hay unread, "Abierto" (verde) cuando no */}
          {conv.unread_count > 0 ? (
            <span className="text-[9px] px-1.5 py-0 rounded-full font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 whitespace-nowrap">
              No leído
            </span>
          ) : (
            <span className="text-[9px] px-1.5 py-0 rounded-full font-medium whitespace-nowrap bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Abierto
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── AttachmentPreview ────────────────────────────────────────────────────────

/**
 * AttachmentPreview
 *
 * Renderiza el adjunto de un mensaje según su tipo MIME:
 *   - image/*  → <img> con enlace a la URL original (abre en nueva pestaña)
 *   - audio/*  → reproductorHTML5 <audio controls>
 *   - video/*  → reproductor HTML5 <video controls>
 *   - otros    → enlace con nombre del archivo y tamaño en KB
 *
 * La URL del archivo se construye desde `azure_path`; si ya es una URL
 * absoluta (http/https) se usa directamente, si no se prefija con la base
 * del API (VITE_API_URL sin el segmento '/api').
 *
 * @param att - Objeto Attachment con mime_type, azure_path, original_name y size
 * @param out - true si el mensaje es saliente (cambia el estilo de color del enlace)
 */
function AttachmentPreview({ att, out }: { att: Attachment; out: boolean }) {
  const isImage = att.mime_type.startsWith('image/')
  const isAudio = att.mime_type.startsWith('audio/')
  const isVideo = att.mime_type.startsWith('video/')
  // Determina la URL final: usa la ruta absoluta si empieza con http, si no construye desde la base del API
  const apiBase = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace('/api', '')
  const url = att.azure_path.startsWith('http') ? att.azure_path : apiBase + att.azure_path

  if (isImage) return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block mt-1">
      <img src={url} alt={att.original_name}
        className="max-w-[240px] max-h-[200px] rounded-xl object-cover border border-white/20" />
    </a>
  )
  if (isAudio) return (
    <div className="mt-1 flex items-center gap-2">
      <Volume2 size={14} className={out ? 'text-white/80' : 'text-gray-500'} />
      <audio controls src={url} className="h-7 max-w-[200px]" />
    </div>
  )
  if (isVideo) return (
    <div className="mt-1">
      <video controls src={url} className="max-w-[240px] max-h-[180px] rounded-xl" />
    </div>
  )
  // Documento genérico
  const sizeKB = Math.round(att.size / 1024)
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className={`mt-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors hover:opacity-80 ${
        out ? 'border-white/30 text-white bg-white/10' : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700'
      }`}>
      <FileText size={14} />
      <span className="truncate max-w-[180px]">{att.original_name}</span>
      <span className="opacity-60 flex-shrink-0">{sizeKB}KB</span>
    </a>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

/**
 * MessageBubble
 *
 * Burbuja de mensaje individual en el hilo de conversación.
 *
 * - Mensajes salientes (outbound): alineados a la derecha, fondo de color primario.
 * - Mensajes entrantes (inbound): alineados a la izquierda, fondo blanco/gris.
 * - Muestra el texto del cuerpo, excepto si el cuerpo es idéntico al nombre del
 *   adjunto (para evitar duplicar el nombre del archivo como texto).
 * - Renderiza cada adjunto usando AttachmentPreview.
 * - Los mensajes salientes muestran íconos de doble tick; si status === 'read'
 *   el tick se pinta en azul.
 *
 * @param msg - Objeto Message con direction, body, attachments, status y created_at
 */
function MessageBubble({ msg }: { msg: Message }) {
  const out = msg.direction === 'outbound'
  const hasAttachments = (msg.attachments?.length ?? 0) > 0
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[72%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
          out ? 'text-white' : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-100 dark:border-gray-600'
        }`}
        style={out ? { backgroundColor: 'var(--color-primary)' } : undefined}
      >
        {/* Texto del mensaje (si tiene, o si no es solo adjunto) */}
        {msg.body && !(hasAttachments && msg.body === msg.attachments?.[0]?.original_name) && (
          <p className="whitespace-pre-wrap break-words">{msg.body}</p>
        )}
        {/* Adjuntos */}
        {msg.attachments?.map(att => (
          <AttachmentPreview key={att.id} att={att} out={out} />
        ))}
        <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${out ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>
          <span>{new Date(msg.created_at).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}</span>
          {/* Doble tick azul si el mensaje fue leído por el destinatario */}
          {out && <CheckCheck size={12} className={msg.status === 'read' ? 'text-blue-300' : ''} />}
        </div>
      </div>
    </div>
  )
}

// ─── TransferModal ────────────────────────────────────────────────────────────

/**
 * TransferModal
 *
 * Modal de reasignación de conversación. Permite seleccionar un departamento
 * y opcionalmente un agente específico dentro de ese departamento.
 *
 * La lista de agentes se filtra dinámicamente según el departamento elegido.
 * Al cambiar de departamento se limpia la selección de agente para evitar
 * asignar a alguien de otro departamento.
 *
 * @param conv        - Conversación actual (usada para el departamento inicial)
 * @param departments - Lista completa de departamentos disponibles
 * @param agents      - Lista completa de agentes; se filtra por department_id
 * @param onClose     - Callback para cerrar el modal sin guardar
 * @param onTransfer  - Callback con (deptId, agentId | null) al confirmar
 */
function TransferModal({ conv, departments, agents, onClose, onTransfer }: {
  conv: Conversation; departments: Department[]; agents: Agent[]
  onClose: () => void; onTransfer: (deptId: number, agentId: number | null) => void
}) {
  const [deptId, setDeptId] = useState<number>(conv.department_id ?? 0)
  const [agentId, setAgentId] = useState<number | null>(null)
  // Filtra agentes al departamento seleccionado; si deptId es 0, muestra todos
  const filtered = agents.filter(a => !deptId || a.department_id === deptId)
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Reasignar conversación</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Departamento</label>
            <select value={deptId} onChange={e => { setDeptId(Number(e.target.value)); setAgentId(null) }}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
              <option value={0}>Todos los departamentos</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Agente <span className="text-gray-400">(opcional)</span>
            </label>
            <select value={agentId ?? ''} onChange={e => setAgentId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
              <option value="">Sin agente asignado</option>
              {filtered.map(a => <option key={a.id} value={a.id}>{a.is_online ? '🟢' : '⚫'} {a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancelar</button>
          <button onClick={() => onTransfer(deptId || conv.department_id || 0, agentId)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            Reasignar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TemplateModal ────────────────────────────────────────────────────────────

/**
 * TemplateModal
 *
 * Modal para seleccionar y enviar una plantilla de WhatsApp aprobada (HSM).
 *
 * Flujo interno:
 *   1. Filtra las plantillas con status 'approved' / 'APPROVED'.
 *   2. El agente selecciona una plantilla de la lista.
 *   3. Se detectan los marcadores {{N}} en el cuerpo usando una expresión regular.
 *   4. Por cada marcador se muestra un campo de texto para que el agente ingrese
 *      el valor de la variable.
 *   5. Se genera una vista previa en tiempo real reemplazando los marcadores con
 *      los valores ingresados.
 *   6. Al confirmar, se llama onSend con el texto final interpolado.
 *
 * @param templates - Lista de plantillas cargada del API
 * @param onClose   - Callback para cerrar sin enviar
 * @param onSend    - Callback con el texto final de la plantilla lista para enviar
 */
function TemplateModal({ templates, onClose, onSend }: {
  templates: Template[]; onClose: () => void; onSend: (body: string) => void
}) {
  // Solo se muestran plantillas aprobadas (maneja tanto minúsculas como mayúsculas)
  const approved = templates.filter(t => t.status === 'approved' || t.status === 'APPROVED')
  const [selected, setSelected] = useState<Template | null>(approved[0] ?? null)
  const [vars, setVars] = useState<Record<number, string>>({})

  /* Extrae los índices únicos de los marcadores {{N}} presentes en la plantilla seleccionada */
  const placeholders = useMemo(() => {
    if (!selected) return []
    const matches = selected.body.match(/\{\{(\d+)\}\}/g) ?? []
    return [...new Set(matches.map(m => Number(m.replace(/[{}]/g, ''))))].sort((a, b) => a - b)
  }, [selected])

  /* Construye la vista previa sustituyendo cada {{N}} por el valor ingresado o dejando el marcador si aún vacío */
  const preview = useMemo(() => {
    if (!selected) return ''
    return selected.body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[Number(n)] || `{{${n}}}`)
  }, [selected, vars])
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Enviar plantilla</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {approved.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No hay plantillas aprobadas</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Plantilla</label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                  {approved.map(t => (
                    <label key={t.id} className="flex items-start gap-2 cursor-pointer p-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 rounded">
                      {/* Al cambiar de plantilla se limpian las variables para evitar valores cruzados */}
                      <input type="radio" name="template" checked={selected?.id === t.id}
                        onChange={() => { setSelected(t); setVars({}) }} className="mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{t.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{t.body.slice(0, 60)}…</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {placeholders.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Variables</label>
                  <div className="space-y-2">
                    {placeholders.map(n => (
                      <div key={n} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-12">{'{{' + n + '}}'}</span>
                        <input type="text" placeholder={`Variable ${n}`} value={vars[n] ?? ''}
                          onChange={e => setVars(prev => ({ ...prev, [n]: e.target.value }))}
                          className="flex-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selected && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Vista previa</label>
                  <div className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                    {preview}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancelar</button>
          {/* El botón está deshabilitado hasta que haya una plantilla seleccionada y una vista previa no vacía */}
          <button onClick={() => { if (preview) onSend(preview) }} disabled={!selected || !preview}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            Enviar plantilla
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TagDropdown ──────────────────────────────────────────────────────────────

/**
 * TagDropdown
 *
 * Menú desplegable para agregar o quitar etiquetas de la conversación activa.
 * Las etiquetas ya asignadas muestran un tilde de verificación (✓).
 * Hacer clic en una etiqueta llama a onToggle, que en InboxPage dispara
 * la mutación de sincronización al API.
 *
 * @param conv     - Conversación activa (para determinar qué etiquetas están activas)
 * @param allTags  - Lista global de etiquetas disponibles
 * @param onToggle - Callback con el id de la etiqueta a agregar/quitar
 * @param onClose  - Callback para cerrar el dropdown
 */
function TagDropdown({ conv, allTags, onToggle, onClose }: {
  conv: Conversation; allTags: TagObj[]; onToggle: (tagId: number) => void; onClose: () => void
}) {
  // Construye un Set con los IDs de etiquetas actualmente asignadas para búsqueda O(1)
  const activeIds = new Set((conv.tags ?? []).map(t => t.id))
  return (
    <div className="absolute right-0 top-8 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg w-48 py-1">
      {allTags.length === 0
        ? <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">Sin etiquetas</p>
        : allTags.map(tag => (
          <button key={tag.id} onClick={() => onToggle(tag.id)}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-800 dark:text-gray-200">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color || '#6366f1' }} />
            <span className="flex-1 truncate">{tag.name}</span>
            {activeIds.has(tag.id) && <span style={{ color: 'var(--color-primary)' }}>✓</span>}
          </button>
        ))
      }
      <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
        <button onClick={onClose} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700">Cerrar</button>
      </div>
    </div>
  )
}

// ─── BulkReassignModal ────────────────────────────────────────────────────────

/**
 * BulkReassignModal
 *
 * Modal de reasignación masiva de conversaciones (solo visible para admin/supervisor).
 * Permite mover todas las conversaciones de un agente origen a un agente destino,
 * filtrando por estado (Abiertos y/o Pendientes).
 *
 * El botón "Reasignar" se deshabilita si no se seleccionó un agente destino o
 * si no hay ningún estado marcado.
 *
 * @param agents     - Lista de agentes para los selectores Desde/Hacia
 * @param onClose    - Callback para cerrar sin ejecutar
 * @param onConfirm  - Callback con (fromId | null, toId, statuses[]) al confirmar
 */
function BulkReassignModal({ agents, onClose, onConfirm }: {
  agents: Agent[]; onClose: () => void
  onConfirm: (fromId: number | null, toId: number, statuses: string[]) => void
}) {
  const [fromId, setFromId] = useState<number | null>(null)
  const [toId, setToId] = useState<number | null>(null)
  const [statuses, setStatuses] = useState<string[]>(['open', 'pending'])

  /* Alterna la selección de un estado: si ya está seleccionado lo quita, si no lo agrega */
  const toggleStatus = (s: string) =>
    setStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Reasignación masiva</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Desde</label>
            <select value={fromId ?? ''} onChange={e => setFromId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
              <option value="">Sin asignar</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Hacia</label>
            <select value={toId ?? ''} onChange={e => setToId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
              <option value="">Selecciona agente</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.is_online ? '🟢' : '⚫'} {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Estados</label>
            <div className="flex gap-3">
              {(['open', 'pending'] as const).map(s => (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggleStatus(s)} className="rounded" />
                  <span className="text-sm">{s === 'open' ? 'Abiertos' : 'Pendientes'}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancelar</button>
          <button onClick={() => toId && onConfirm(fromId, toId, statuses)} disabled={!toId || statuses.length === 0}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            Reasignar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── NewConvModal ─────────────────────────────────────────────────────────────

interface Channel { id: number; name: string; type: string }
interface AvailableTemplate { id: number; name: string; body: string; category: string; language: string; department_id?: number }

function NewConvModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2>(1)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState<number | ''>('')
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [tplSearch, setTplSearch] = useState('')

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels-list'],
    queryFn: () => api.get('/channels').then(r => r.data.data ?? []),
    staleTime: 60000,
  })

  const { data: templates = [], isLoading: loadingTpls } = useQuery<AvailableTemplate[]>({
    queryKey: ['templates-available'],
    queryFn: () => api.get('/templates/available').then(r => r.data.data ?? []),
    enabled: step === 2,
    staleTime: 30000,
  })

  const filteredTpls = useMemo(() => {
    if (!tplSearch.trim()) return templates
    const q = tplSearch.toLowerCase()
    return templates.filter(t => t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q))
  }, [templates, tplSearch])

  const selectedTpl = templates.find(t => t.id === templateId) ?? null

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/conversations', {
        contact_phone: phone.trim(),
        contact_name: name.trim() || undefined,
        channel_id: channelId,
        template_id: templateId,
      }).then(r => r.data.data),
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      onClose()
      toast.success(`Conversación ${conv?.case_number ?? ''} creada`)
    },
    onError: () => toast.error('No se pudo crear la conversación'),
  })

  const step1Valid = phone.trim().length >= 7 && channelId !== ''

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button onClick={() => setStep(1)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 -ml-1">
                <ChevronDown size={18} className="rotate-90" />
              </button>
            )}
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Nueva conversación</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {step === 1 ? 'Paso 1 de 2 — Datos del contacto' : 'Paso 2 de 2 — Selecciona una plantilla'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        {/* Indicador de pasos */}
        <div className="flex px-6 pt-3 pb-1 gap-2 flex-shrink-0">
          {([1, 2] as const).map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-[var(--color-primary)]' : 'bg-gray-200 dark:bg-gray-700'}`} />
          ))}
        </div>

        {/* Contenido paso 1 */}
        {step === 1 && (
          <div className="px-6 py-4 space-y-3 flex-shrink-0">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Teléfono <span className="text-red-400">*</span></label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="50688887777"
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nombre del contacto</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Opcional"
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Canal <span className="text-red-400">*</span></label>
              <select value={channelId} onChange={e => setChannelId(Number(e.target.value) || '')}
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
                <option value="">Selecciona un canal</option>
                {channels.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Contenido paso 2 */}
        {step === 2 && (
          <>
            {/* Buscador fijo */}
            <div className="px-6 pt-3 pb-2 flex-shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={tplSearch} onChange={e => setTplSearch(e.target.value)}
                  placeholder="Buscar plantilla…"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
            </div>

            {/* Lista de plantillas — scroll */}
            <div className="px-6 overflow-y-auto flex-1 pb-3 space-y-2">
              {loadingTpls && (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">Cargando plantillas…</p>
              )}
              {!loadingTpls && filteredTpls.length === 0 && (
                <div className="py-8 text-center">
                  <FileText size={32} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {tplSearch ? 'Sin resultados para esa búsqueda' : 'No hay plantillas disponibles para tu departamento'}
                  </p>
                </div>
              )}
              {filteredTpls.map(tpl => {
                const selected = tpl.id === templateId
                return (
                  <button key={tpl.id} onClick={() => setTemplateId(tpl.id)}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                      selected
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 ring-1 ring-[var(--color-primary)]/30'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className={`text-sm font-medium ${selected ? 'text-[var(--color-primary)]' : 'text-gray-900 dark:text-gray-100'}`}>
                        {tpl.name}
                      </span>
                      <div className="flex gap-1 flex-shrink-0">
                        <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                          {tpl.language}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                          {tpl.category}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 whitespace-pre-line">{tpl.body}</p>
                  </button>
                )
              })}
            </div>

            {/* Preview de plantilla seleccionada */}
            {selectedTpl && (
              <div className="mx-6 mb-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 flex-shrink-0">
                <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">Vista previa — {selectedTpl.name}</p>
                <p className="text-xs text-green-800 dark:text-green-300 whitespace-pre-line line-clamp-3">{selectedTpl.body}</p>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
            Cancelar
          </button>
          {step === 1 && (
            <button onClick={() => setStep(2)} disabled={!step1Valid}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              Siguiente <ChevronDown size={14} className="-rotate-90" />
            </button>
          )}
          {step === 2 && (
            <button onClick={() => createMutation.mutate()} disabled={templateId === null || createMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {createMutation.isPending ? 'Creando…' : 'Crear conversación'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── EditContactModal ─────────────────────────────────────────────────────────

/**
 * EditContactModal
 *
 * Modal para editar los datos básicos del contacto asociado a la conversación.
 * Permite modificar nombre, teléfono y correo electrónico.
 *
 * Los campos se inicializan con los valores actuales del contacto y se
 * envían al API mediante la mutación editContactMutation en InboxPage.
 *
 * @param contact - Objeto Contact con los valores actuales (name, phone, email)
 * @param onClose - Callback para cerrar sin guardar
 * @param onSave  - Callback con { name, phone, email } al confirmar
 */
function EditContactModal({ contact, onClose, onSave }: {
  contact: Contact
  onClose: () => void
  onSave: (data: { name: string; phone: string; email: string }) => void
}) {
  const [name, setName] = useState(contact.name)
  const [phone, setPhone] = useState(contact.phone)
  const [email, setEmail] = useState(contact.email ?? '')

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar contacto</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          {/* Genera los campos de formulario de forma declarativa con un array de configuración */}
          {[
            { label: 'Nombre', value: name, setter: setName, type: 'text' },
            { label: 'Teléfono', value: phone, setter: setPhone, type: 'tel' },
            { label: 'Correo', value: email, setter: setEmail, type: 'email' },
          ].map(({ label, value, setter, type }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
              <input type={type} value={value} onChange={e => setter(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancelar</button>
          <button onClick={() => onSave({ name, phone, email })}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PreviousChatsModal ───────────────────────────────────────────────────────

interface PrevConversation {
  id: number; case_number: string; status: string; created_at: string
  channel?: { name: string; type: string }
  agent?: { name: string }
}

function PreviousChatsModal({ contactName, contactId, currentConvId, onClose, onView }: {
  contactName: string
  contactId: number
  currentConvId: number
  onClose: () => void
  onView: (id: number) => void
}) {
  const { data: convs = [], isLoading } = useQuery<PrevConversation[]>({
    queryKey: ['contact-conversations', contactId],
    queryFn: () => api.get(`/contacts/${contactId}/conversations`).then(r => r.data.data ?? []),
    staleTime: 30000,
  })

  const others = convs.filter(c => c.id !== currentConvId)

  const statusLabel = (s: string) => {
    if (s === 'open') return <span className="px-1.5 py-0 rounded-full text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Abierto</span>
    if (s === 'closed') return <span className="px-1.5 py-0 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">Cerrado</span>
    return <span className="px-1.5 py-0 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Pendiente</span>
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Casos anteriores</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{contactName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-gray-400 dark:text-gray-500 text-sm">
              Cargando…
            </div>
          )}
          {!isLoading && others.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-300 dark:text-gray-600 gap-2">
              <History size={32} />
              <p className="text-sm">Sin casos anteriores</p>
            </div>
          )}
          {!isLoading && others.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left px-6 py-2.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Caso</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Canal</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Agente</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Estado</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {others.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-3">
                      <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{c.case_number}</span>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                        {new Date(c.created_at).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {c.channel ? (
                        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          <span className="w-3 h-3 rounded-full inline-flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: CHANNEL_BG[c.channel.type] ?? '#6b7280' }}>
                            <ChannelIcon type={c.channel.type} size={8} color="white" />
                          </span>
                          {c.channel.name}
                        </span>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-gray-600 dark:text-gray-300">{c.agent?.name ?? <span className="text-gray-400">—</span>}</span>
                    </td>
                    <td className="px-3 py-3">{statusLabel(c.status)}</td>
                    <td className="px-3 py-3 text-right">
                      <button onClick={() => onView(c.id)}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors text-white"
                        style={{ backgroundColor: 'var(--color-primary)' }}>
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {others.length} caso{others.length !== 1 ? 's' : ''} anterior{others.length !== 1 ? 'es' : ''}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── InboxPage ────────────────────────────────────────────────────────────────

/**
 * InboxPage (export default)
 *
 * Componente raíz de la bandeja de entrada. Orquesta toda la lógica de:
 *   - Carga y refresco de conversaciones, mensajes, departamentos, agentes y etiquetas
 *   - Selección de conversación activa y marcado automático como leída
 *   - Recepción de mensajes en tiempo real vía WebSocket
 *   - Envío de mensajes de texto y archivos adjuntos
 *   - Control de la ventana de 24h de WhatsApp (bloqueo de input, banners, toast)
 *   - Apertura/cierre de modales (TransferModal, TemplateModal, TagDropdown,
 *     BulkReassignModal, EditContactModal)
 *   - Actualización del título del navegador con el conteo de no leídos
 *
 * Sin props — consume el store de autenticación (useAuthStore) para obtener
 * el usuario actual y determinar permisos de admin/supervisor.
 */
export default function InboxPage() {
  const qc = useQueryClient()
  const { subscribe } = useWebSocket()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  // Solo admin y supervisor pueden reasignar conversaciones o usar la reasignación masiva
  const canManage = user?.role === 'admin' || user?.role === 'supervisor'

  const [tab, setTab] = useState<TabKey>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [body, setBody] = useState('')
  const [sendError, setSendError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [showTransfer, setShowTransfer] = useState(false)
  const [showTemplate, setShowTemplate] = useState(false)
  const [showTagDrop, setShowTagDrop] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [showNewConv, setShowNewConv] = useState(false)
  const [showEditContact, setShowEditContact] = useState(false)
  const [showPrevChats, setShowPrevChats] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)        // Para auto-scroll al último mensaje
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)   // Input de archivo oculto activado por el botón Paperclip

  /* Debounce de 300ms en el campo de búsqueda para no disparar queries con cada pulsación */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  /* Lista de conversaciones. El tiempo real llega por WebSocket (ver efecto más abajo);
     el polling queda solo como respaldo por si el socket se cae — de 12s a 60s. */
  const { data: convData } = useQuery({
    queryKey: ['conversations', tab, debouncedSearch],
    queryFn: () =>
      api.get('/conversations', { params: { status: tab, q: debouncedSearch || undefined } })
        .then(r => r.data as { data: Conversation[]; counts: { all: number; open: number; unread: number } }),
    refetchInterval: 60000,
  })
  const convList: Conversation[] = convData?.data ?? []
  const counts = convData?.counts ?? { all: 0, open: 0, unread: 0 }

  /* Detalle de la conversación seleccionada. Los mensajes llegan por WS; el polling de
     metadatos (estado/agente) baja de 10s a 30s como respaldo. */
  const { data: conv } = useQuery<Conversation>({
    queryKey: ['conversation', selectedId],
    queryFn: () => api.get(`/conversations/${selectedId}`).then(r => r.data.data),
    enabled: !!selectedId,
    refetchInterval: 30000,
  })

  /* Carga el historial de mensajes de la conversación seleccionada */
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ['messages', selectedId],
    queryFn: () => api.get(`/conversations/${selectedId}/messages`).then(r => r.data.data ?? []),
    enabled: !!selectedId,
  })

  /* Departamentos: caché de 60s ya que cambian con poca frecuencia */
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then(r => r.data.data ?? []),
    staleTime: 60000,
  })

  /* Lista de agentes: caché de 30s para reflejar cambios de presencia relativamente rápido */
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then(r => r.data.data ?? []),
    staleTime: 30000,
  })

  /* Etiquetas disponibles: caché de 60s */
  const { data: allTags = [] } = useQuery<TagObj[]>({
    queryKey: ['tags'],
    queryFn: () => api.get('/tags').then(r => r.data.data ?? []),
    staleTime: 60000,
  })

  /* Plantillas disponibles para el inbox: solo las aprobadas y habilitadas para agentes.
   * Se carga solo cuando se abre el modal de plantillas (lazy). Endpoint /templates/available
   * es accesible para todos los roles (admin, supervisor, agente). */
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['templates-available'],
    queryFn: () => api.get('/templates/available').then(r => r.data.data ?? []),
    enabled: showTemplate,
    staleTime: 60000,
  })

  // ── Lógica de ventana de WhatsApp ─────────────────────────────────────────
  const winSecs = conv ? windowSecondsLeft(conv) : null
  // La ventana expiró: ya no se pueden enviar mensajes libres
  const windowExpired = winSecs !== null && winSecs <= 0
  // La ventana está por expirar (menos de 1h): muestra banner de advertencia naranja
  const windowWarning = winSecs !== null && winSecs > 0 && winSecs <= 3600
  // El canal es WhatsApp pero el cliente nunca inició conversación (no hay fecha de expiración)
  const windowNA = conv?.channel?.type === 'whatsapp' && !conv.window_expires_at
  // Si inputLocked es true, el textarea se oculta y se muestra solo el botón de plantillas
  const inputLocked = windowExpired || windowNA

  /* Programa un toast de alerta cuando la ventana de WhatsApp esté por expirar */
  useEffect(() => {
    if (!conv || winSecs === null || winSecs <= 0) return
    // Dispara el toast exactamente cuando el contador llegue a 0
    const id = setTimeout(() => {
      toast.error('⏰ La ventana de 24h de WhatsApp ha expirado', { duration: 7000 })
    }, winSecs * 1000)
    return () => clearTimeout(id)
  }, [conv?.id, winSecs])

  // ── Mutaciones React Query ────────────────────────────────────────────────

  /* Envío de mensaje de texto: agrega el mensaje al caché local (optimistic-like) y limpia el textarea */
  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      api.post(`/conversations/${selectedId}/messages`, { body: text }).then(r => r.data.data),
    onSuccess: (msg: Message) => {
      // Inserta el mensaje retornado por el API directamente en el caché sin invalidar todo
      qc.setQueryData<Message[]>(['messages', selectedId], prev => [...(prev ?? []), msg])
      setBody('')
      setSendError('')
    },
    onError: () => {
      toast.error('Error al enviar mensaje')
      setSendError('No se pudo enviar el mensaje. Intenta de nuevo.')
    },
  })

  /* Cierre de conversación: deselecciona e invalida la lista */
  const closeMutation = useMutation({
    mutationFn: () => api.put(`/conversations/${selectedId}/close`),
    onSuccess: () => {
      toast.success('Conversación cerrada')
      setSelectedId(null)
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  /* Reapertura de conversación: invalida tanto el detalle como la lista */
  const reopenMutation = useMutation({
    mutationFn: () => api.put(`/conversations/${selectedId}/reopen`),
    onSuccess: () => {
      toast.success('Conversación reabierta')
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  /* Reasignación de conversación a departamento/agente; cierra el modal al completar */
  const assignMutation = useMutation({
    mutationFn: (payload: { agent_id?: number | null; department_id?: number }) =>
      api.put(`/conversations/${selectedId}/assign`, payload),
    onSuccess: () => {
      toast.success('Reasignado correctamente')
      setShowTransfer(false)
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  /* Auto-asignación: asigna la conversación al agente autenticado */
  const claimMutation = useMutation({
    mutationFn: () => api.put(`/conversations/${selectedId}/assign`, { agent_id: user?.id }),
    onSuccess: () => {
      toast.success('Conversación asignada a ti')
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  /* Sincronización de etiquetas: envía el array completo de IDs resultante (no diff) */
  const tagsMutation = useMutation({
    mutationFn: (tagIds: number[]) =>
      api.put(`/conversations/${selectedId}/tags`, { tag_ids: tagIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  /* Reasignación masiva: muestra el count de conversaciones afectadas en el toast */
  const bulkMutation = useMutation({
    mutationFn: (payload: { from_agent_id: number | null; to_agent_id: number; statuses: string[] }) =>
      api.post('/conversations/bulk-reassign', payload),
    onSuccess: (res) => {
      toast.success(`${res.data.count} conversaciones reasignadas`)
      setShowBulk(false)
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  /* Marca como leída: invalida la lista para actualizar el badge de no leídos */
  const markReadMutation = useMutation({
    mutationFn: (id: number) => api.put(`/conversations/${id}/mark-read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  /* Edición de contacto: actualiza nombre/teléfono/email vía PUT /contacts/{id} */
  const editContactMutation = useMutation({
    mutationFn: (data: { name: string; phone: string; email: string }) =>
      api.put(`/contacts/${conv?.contact?.id}`, data),
    onSuccess: () => {
      toast.success('Contacto actualizado')
      setShowEditContact(false)
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] })
    },
    onError: () => toast.error('Error al actualizar contacto'),
  })

  /*
   * Flujo de subida de archivo:
   *   1. El usuario hace clic en el ícono Paperclip, que dispara fileInputRef.current.click()
   *   2. El input file (oculto) dispara onChange con el archivo seleccionado
   *   3. Se crea un FormData con el archivo y se POST a /conversations/{id}/attachments
   *   4. El API devuelve el mensaje creado, que se inserta en el caché local
   *   5. Se resetea el valor del input para permitir subir el mismo archivo nuevamente
   */
  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/conversations/${selectedId}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data.data)
    },
    onSuccess: (msg: Message) => {
      // Inserta el mensaje con adjunto en el caché local igual que un mensaje de texto
      qc.setQueryData<Message[]>(['messages', selectedId], prev => [...(prev ?? []), msg])
      toast.success('Archivo enviado')
      setUploadError('')
    },
    onError: () => {
      toast.error('Error al enviar archivo')
      setUploadError('No se pudo subir el archivo. Verifica el formato e intenta de nuevo.')
    },
  })

  /* Avisa al usuario antes de cerrar/recargar si tiene un borrador sin enviar */
  useEffect(() => {
    if (!body.trim()) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [body])

  /* Al abrir una conversación con mensajes no leídos, los marca como leídos automáticamente */
  useEffect(() => {
    if (!selectedId || !conv) return
    if (conv.unread_count > 0) {
      markReadMutation.mutate(selectedId)
    }
  }, [selectedId, conv?.unread_count])

  /*
   * Suscripción WebSocket para mensajes en tiempo real.
   * Se suscribe al canal `conversation.{id}` y escucha el evento `MessageReceived`.
   * Solo los mensajes inbound se agregan al caché (los outbound ya los agrega sendMutation).
   * La suscripción se cancela y se re-crea al cambiar la conversación seleccionada.
   */
  useEffect(() => {
    if (!selectedId) return
    const unsub = subscribe(`conversation.${selectedId}`, 'MessageReceived', (raw: unknown) => {
      const data = raw as Message
      // Solo insertar mensajes entrantes; los salientes ya se manejan en onSuccess de sendMutation
      if (data.direction === 'inbound')
        qc.setQueryData<Message[]>(['messages', selectedId], prev => [...(prev ?? []), data])
    })
    return () => unsub()
  }, [selectedId, subscribe, qc])

  /* Suscripción al canal `inbox` de la empresa (company.{id}.inbox): actualiza la LISTA
   * de conversaciones al instante cuando llega un mensaje entrante o cambia el estado de
   * una conversación, sin depender del polling. Es independiente de la conversación abierta,
   * por eso se suscribe una sola vez. El polling de 60s queda solo como respaldo. */
  useEffect(() => {
    const refreshList = () => qc.invalidateQueries({ queryKey: ['conversations'] })
    const unsubMsg = subscribe('inbox', 'MessageReceived', refreshList)
    const unsubUpd = subscribe('inbox', 'ConversationUpdated', refreshList)
    return () => { unsubMsg(); unsubUpd() }
  }, [subscribe, qc])

  /* Auto-scroll al mensaje más reciente cada vez que cambia la lista de mensajes */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /* Envía el mensaje si el textarea no está vacío y la ventana no está bloqueada */
  const handleSend = useCallback(() => {
    if (!body.trim() || !selectedId || inputLocked) return
    sendMutation.mutate(body.trim())
  }, [body, selectedId, inputLocked, sendMutation])

  /* Enter sin Shift envía el mensaje; Shift+Enter inserta salto de línea */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  /* Calcula el nuevo array de IDs de etiquetas (toggle) y dispara la mutación de sincronización */
  const handleToggleTag = (tagId: number) => {
    if (!conv) return
    const current = (conv.tags ?? []).map(t => t.id)
    const next = current.includes(tagId) ? current.filter(id => id !== tagId) : [...current, tagId]
    tagsMutation.mutate(next)
  }

  // V2: solo 3 filtros — Todos, Abiertos, No leídos (NO existe Pendientes)
  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: 'all',    label: 'Todos',     count: counts.all ?? 0 },
    { key: 'open',   label: 'Abiertos',  count: counts.open ?? 0 },
    { key: 'unread', label: 'No leídos', count: counts.unread ?? 0 },
  ]

  /* Actualizar título del navegador con conteo de no leídos (igual a v2 "(1) Harmony") */
  useEffect(() => {
    const unread = counts.unread ?? 0
    document.title = unread > 0 ? `(${unread}) Harmony` : 'Harmony'
    return () => { document.title = 'Harmony' }
  }, [counts.unread])

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      {/* #13: en móvil se muestra la lista O el chat (patrón lista→detalle), no ambos. */}
      <div className={`w-full md:w-80 lg:w-96 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-col ${selectedId ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="px-3 pt-3 pb-2 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Bandeja de Entrada</h2>
            <div className="flex items-center gap-2">
              {/* Botón de reasignación masiva: solo visible para admin/supervisor */}
              {canManage && (
                <button onClick={() => setShowBulk(true)}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 transition-colors">
                  Reasignación masiva
                </button>
              )}
              <button onClick={() => setShowNewConv(true)} title="Nueva conversación"
                className="w-8 h-8 rounded-xl flex items-center justify-center shadow-sm hover:opacity-90 active:scale-95 transition-all text-white"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}>
                <Plus size={16} />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar nombre, teléfono, caso…"
              className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Tabs — igual a v2: siempre muestran el conteo */}
        <div className="flex gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={tab === t.key
                ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                : { backgroundColor: 'transparent', color: '#6b7280' }
              }>
              {t.label}
              <span className={`px-1.5 py-0 rounded-full text-[9px] font-bold leading-4 ${
                tab === t.key ? 'bg-white/25 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {convList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 dark:text-gray-600 gap-2">
              <MessageSquare size={28} />
              <p className="text-xs">Sin conversaciones</p>
            </div>
          ) : (
            convList.map(c => (
              <ConversationRow key={c.id} conv={c} selected={selectedId === c.id} onClick={() => setSelectedId(c.id)} />
            ))
          )}
        </div>
      </div>

      {/* ── Right panel ─────────────────────────────────────────────────────── */}
      {selectedId && conv ? (
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
          {/* Header */}
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2.5 flex items-center justify-between flex-shrink-0 gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* #13: botón "volver" a la lista, solo en móvil */}
              <button onClick={() => setSelectedId(null)}
                className="md:hidden p-1 -ml-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0"
                aria-label="Volver a la lista">
                <ChevronLeft size={20} />
              </button>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {initials(conv.contact?.name ?? 'NN')}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {conv.contact?.name ?? 'Sin nombre'}
                  </p>
                  {/* Botón de lápiz para editar el contacto; solo visible si hay contacto asociado */}
                  {conv.contact && (
                    <button onClick={() => setShowEditContact(true)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
                      title="Editar contacto">
                      <Pencil size={11} />
                    </button>
                  )}
                  {conv.contact?.phone && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                      <PhoneCall size={10} /> {conv.contact.phone}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{conv.case_number}</span>
                  {conv.channel && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      <span className="inline-flex items-center justify-center w-3 h-3 rounded-full"
                        style={{ backgroundColor: CHANNEL_BG[conv.channel.type] ?? '#6b7280' }}>
                        <ChannelIcon type={conv.channel.type} size={8} color="white" />
                      </span>
                      {conv.channel.name}
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0 rounded font-medium ${
                    conv.status === 'open'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}>
                    {conv.status === 'open' ? 'Abierto' : 'Pendiente'}
                  </span>
                  {conv.agent && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">👤 {conv.agent.name}</span>
                  )}
                  {/* Muestra el badge de ventana de WhatsApp solo si el canal lo tiene */}
                  {winSecs !== null && <WindowBadge conv={conv} />}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Botón casos anteriores: visible si el contacto tiene ID */}
              {conv.contact && (
                <button onClick={() => setShowPrevChats(true)}
                  title="Ver casos anteriores de este contacto"
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                  <History size={12} /> Casos anteriores
                </button>
              )}
              {/* Botón "Asignarme" visible si la conversación está pendiente o sin agente asignado */}
              {(conv.status === 'pending' || !conv.agent) && (
                <button onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
                  <UserPlus size={12} /> Asignarme
                </button>
              )}
              <div className="relative">
                <button onClick={() => setShowTagDrop(v => !v)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                  <Tag size={12} /><ChevronDown size={10} />
                </button>
                {showTagDrop && (
                  <TagDropdown conv={conv} allTags={allTags} onToggle={handleToggleTag} onClose={() => setShowTagDrop(false)} />
                )}
              </div>
              {/* Botón de reasignación individual: solo admin/supervisor */}
              {canManage && (
                <button onClick={() => setShowTransfer(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors">
                  <RotateCcw size={12} /> Reasignar
                </button>
              )}
              {/* Botón Cerrar/Reabrir dependiendo del estado actual de la conversación */}
              {conv.status === 'closed' ? (
                <button onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors">
                  Reabrir
                </button>
              ) : (
                <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors">
                  Cerrar
                </button>
              )}
            </div>
          </div>

          {/* Banners informativos sobre el estado de la ventana de WhatsApp */}
          {windowExpired && (
            // Banner rojo: ventana cerrada, solo plantillas disponibles
            <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-2 flex items-center gap-2 text-sm text-red-700 dark:text-red-400 flex-shrink-0">
              <Lock size={14} />
              <span className="font-medium">Ventana de 24h cerrada.</span>
              <span>Solo podés enviar plantillas de WhatsApp.</span>
            </div>
          )}
          {windowWarning && !windowExpired && (
            // Banner naranja: quedan menos de 60 minutos, se advierte al agente
            <div className="bg-orange-50 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800 px-4 py-2 flex items-center gap-2 text-sm text-orange-700 dark:text-orange-400 flex-shrink-0">
              <AlertTriangle size={14} />
              <span>La ventana de mensajes libres está por expirar. Después solo se podrán enviar plantillas.</span>
            </div>
          )}
          {windowNA && (
            // Banner ámbar: el cliente nunca escribió, se debe iniciar con plantilla HSM
            <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 flex-shrink-0">
              <AlertTriangle size={14} />
              <span>El cliente aún no ha iniciado conversación. Envía una plantilla para contactarlo.</span>
            </div>
          )}

          {/* Franja de etiquetas activas en la conversación */}
          {(conv.tags ?? []).length > 0 && (
            <div className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-4 py-1.5 flex items-center gap-1.5 flex-wrap flex-shrink-0">
              {(conv.tags ?? []).map(tag => (
                <span key={tag.id} className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: tag.color || '#6366f1' }}>
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* Área de mensajes con scroll; el div bottomRef sirve para el auto-scroll */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-300 dark:text-gray-600 gap-2">
                <MessageSquare size={36} />
                <p className="text-sm">Sin mensajes</p>
              </div>
            ) : messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
            <div ref={bottomRef} />
          </div>

          {/* Área de entrada de texto / botón de plantilla según estado de la ventana */}
          <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
            {inputLocked ? (
              // Ventana bloqueada: solo se muestra el botón para enviar plantillas
              <div className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                  <Lock size={16} />
                  <span>{windowNA ? 'Inicia con una plantilla de WhatsApp' : 'Ventana cerrada — solo plantillas'}</span>
                </div>
                <button onClick={() => setShowTemplate(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white rounded-lg"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  <Send size={14} /> Enviar plantilla
                </button>
              </div>
            ) : (
              // Ventana abierta: textarea + botones de adjunto, plantilla y envío
              <div className="flex flex-col gap-1 px-3 py-3">
                {(sendError || uploadError) && (
                  <p className="text-xs text-red-500 px-1">{sendError || uploadError}</p>
                )}
                <div className="flex items-end gap-2">
                  {/* Input de archivo oculto; se activa por el botón Paperclip */}
                  <input ref={fileInputRef} type="file" className="hidden"
                    accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); e.target.value = '' }} />
                  <button onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    title="Adjuntar archivo" aria-label="Adjuntar archivo">
                    <Paperclip size={18} />
                  </button>
                  {/* Botón de plantilla disponible también con ventana abierta (si es WhatsApp) */}
                  {conv.channel?.type === 'whatsapp' && (
                    <button onClick={() => setShowTemplate(true)} title="Enviar plantilla"
                      aria-label="Enviar plantilla"
                      className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                      <Tag size={18} />
                    </button>
                  )}
                  <textarea ref={textareaRef} value={body}
                    onChange={e => { setBody(e.target.value); if (sendError) setSendError('') }}
                    onKeyDown={handleKeyDown} placeholder="Escribe un mensaje… (Enter para enviar)"
                    rows={1}
                    className="flex-1 resize-none border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] max-h-32" />
                  <button onClick={handleSend} disabled={!body.trim() || sendMutation.isPending}
                    aria-label="Enviar mensaje"
                    className="p-2.5 rounded-xl text-white disabled:opacity-50 transition-opacity flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-primary)' }}>
                    <Send size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        // Estado vacío: ninguna conversación seleccionada. #13: oculto en móvil (allí se
        // muestra la lista a pantalla completa hasta que se elige una conversación).
        <div className="hidden md:flex flex-1 flex-col items-center justify-center text-gray-300 dark:text-gray-600 gap-3">
          <MessageSquare size={48} />
          <p className="text-sm">Selecciona una conversación para empezar</p>
        </div>
      )}

      {/* Modals */}
      {showTransfer && conv && (
        <TransferModal conv={conv} departments={departments} agents={agents}
          onClose={() => setShowTransfer(false)}
          onTransfer={(deptId, agentId) =>
            assignMutation.mutate({ department_id: deptId || undefined, agent_id: agentId })} />
      )}
      {showTemplate && (
        <TemplateModal templates={templates} onClose={() => setShowTemplate(false)}
          onSend={text => { sendMutation.mutate(text); setShowTemplate(false) }} />
      )}
      {showBulk && (
        <BulkReassignModal agents={agents} onClose={() => setShowBulk(false)}
          onConfirm={(fromId, toId, statuses) =>
            bulkMutation.mutate({ from_agent_id: fromId, to_agent_id: toId, statuses })} />
      )}
      {showEditContact && conv?.contact && (
        <EditContactModal contact={conv.contact} onClose={() => setShowEditContact(false)}
          onSave={data => editContactMutation.mutate(data)} />
      )}
      {showNewConv && (
        <NewConvModal onClose={() => setShowNewConv(false)} />
      )}
      {showPrevChats && conv?.contact && (
        <PreviousChatsModal
          contactName={conv.contact.name}
          contactId={conv.contact.id}
          currentConvId={conv.id}
          onClose={() => setShowPrevChats(false)}
          onView={id => { setShowPrevChats(false); navigate(`/chat-history/${id}`) }}
        />
      )}
    </div>
  )
}
