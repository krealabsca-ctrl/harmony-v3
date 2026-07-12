import { useState, useEffect, useCallback, useRef } from "react";
import DOMPurify from 'dompurify'
import { useDarkMode } from "@/hooks/useDarkMode";

// ─── Types ───────────────────────────────────────────────────────────────────

type Platform = "whatsapp" | "messenger" | "instagram" | "telegram" | "sms" | "web";

type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "discarded";

interface Lead {
  id: number;
  name: string;
  message: string;
  platform: Platform;
  origin_post: string | null;
  origin_post_url: string | null;
  created_at: string;
  status: LeadStatus;
}

interface PaginationLink {
  url: string | null;
  label: string;
  active: boolean;
}

interface LeadsResponse {
  data: Lead[];
  links: PaginationLink[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
    per_page: number;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<Platform, string> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
  telegram: "Telegram",
  sms: "SMS",
  web: "Web",
};

const PLATFORM_COLORS: Record<Platform, { bg: string; text: string }> = {
  whatsapp:  { bg: "#dcfce7", text: "#166534" },
  messenger: { bg: "#dbeafe", text: "#1e40af" },
  instagram: { bg: "#fce7f3", text: "#9d174d" },
  telegram:  { bg: "#e0f2fe", text: "#0c4a6e" },
  sms:       { bg: "#fef9c3", text: "#713f12" },
  web:       { bg: "#f3f4f6", text: "#374151" },
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new:        "Nuevo",
  contacted:  "Contactado",
  qualified:  "Calificado",
  converted:  "Convertido",
  discarded:  "Descartado",
};

const STATUS_COLORS: Record<LeadStatus, { bg: string; text: string }> = {
  new:        { bg: "#eff6ff", text: "#1d4ed8" },
  contacted:  { bg: "#fef3c7", text: "#92400e" },
  qualified:  { bg: "#f0fdf4", text: "#15803d" },
  converted:  { bg: "#ecfdf5", text: "#065f46" },
  discarded:  { bg: "#fef2f2", text: "#991b1b" },
};

const ALL_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "converted", "discarded"];
const ALL_PLATFORMS: Platform[]  = ["whatsapp", "messenger", "instagram", "telegram", "sms", "web"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + "…";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-CR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Mock API ─────────────────────────────────────────────────────────────────

async function fetchLeads(params: Record<string, string>): Promise<LeadsResponse> {
  // Replace with real API call: return await api.get("/leads", { params });
  await new Promise(r => setTimeout(r, 300));
  const mock: Lead[] = [
    { id: 1, name: "María Fernández", message: "Hola, vi su anuncio en Instagram y me interesa saber más sobre el servicio de limpieza para mi empresa.", platform: "instagram", origin_post: "Promo servicio empresarial", origin_post_url: "https://instagram.com/p/abc123", created_at: "2026-06-25T10:30:00Z", status: "new" },
    { id: 2, name: "Carlos Rodríguez", message: "Buenas tardes, me gustaría cotizar el paquete completo para mi tienda.", platform: "whatsapp", origin_post: null, origin_post_url: null, created_at: "2026-06-24T15:45:00Z", status: "contacted" },
    { id: 3, name: "Luisa Mora", message: "Necesito información sobre precios y disponibilidad para el próximo mes.", platform: "messenger", origin_post: "Post producto nuevo", origin_post_url: "https://facebook.com/posts/xyz789", created_at: "2026-06-24T09:10:00Z", status: "qualified" },
    { id: 4, name: "Andrés Jiménez", message: "Me llegó su mensaje por Telegram. ¿Cuándo podemos agendar una llamada?", platform: "telegram", origin_post: null, origin_post_url: null, created_at: "2026-06-23T18:20:00Z", status: "converted" },
    { id: 5, name: "Sofía Vargas", message: "Solo quería saber si tienen sucursal en Cartago.", platform: "sms", origin_post: null, origin_post_url: null, created_at: "2026-06-23T11:05:00Z", status: "discarded" },
    { id: 6, name: "Diego Castillo", message: "Vi el formulario en su página web y me interesa el servicio premium.", platform: "web", origin_post: "Página de servicios", origin_post_url: "https://miempresa.com/servicios", created_at: "2026-06-22T14:30:00Z", status: "new" },
    { id: 7, name: "Valentina Solano", message: "Hola! quiero más información del descuento que publicitaron.", platform: "instagram", origin_post: "Story descuento 20%", origin_post_url: "https://instagram.com/stories/abc", created_at: "2026-06-22T08:15:00Z", status: "new" },
    { id: 8, name: "Roberto Ureña", message: "¿El servicio incluye mantenimiento post-venta? Quiero saber antes de decidir.", platform: "whatsapp", origin_post: null, origin_post_url: null, created_at: "2026-06-21T16:00:00Z", status: "contacted" },
  ];

  const q = params.search?.toLowerCase() ?? "";
  const filtered = mock.filter(l => {
    if (q && !l.name.toLowerCase().includes(q) && !l.message.toLowerCase().includes(q)) return false;
    if (params.platform && l.platform !== params.platform) return false;
    if (params.status && l.status !== params.status) return false;
    if (params.date_from && l.created_at < params.date_from) return false;
    if (params.date_to && l.created_at > params.date_to + "T23:59:59Z") return false;
    return true;
  });

  return {
    data: filtered,
    links: [
      { url: null, label: "« Anterior", active: false },
      { url: "#", label: "1", active: true },
      { url: null, label: "Siguiente »", active: false },
    ],
    meta: { current_page: 1, last_page: 1, total: filtered.length, per_page: 25 },
  };
}

async function updateLeadStatus(_id: number, _status: LeadStatus): Promise<void> {
  await new Promise(r => setTimeout(r, 200));
  // Replace with: await api.patch(`/leads/${id}`, { status });
}

// ─── StatusDropdown ───────────────────────────────────────────────────────────

interface StatusDropdownProps {
  lead: Lead;
  onUpdate: (id: number, status: LeadStatus) => void;
}

function StatusDropdown({ lead, onUpdate }: StatusDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const colors = STATUS_COLORS[lead.status];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        style={{
          padding: "3px 10px",
          borderRadius: "9999px",
          fontSize: "0.75rem",
          fontWeight: 600,
          background: colors.bg,
          color: colors.text,
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          whiteSpace: "nowrap",
        }}
      >
        {STATUS_LABELS[lead.status]}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          zIndex: 100,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
          minWidth: 150,
          overflow: "hidden",
        }}>
          {ALL_STATUSES.map(s => {
            const c = STATUS_COLORS[s];
            return (
              <button
                key={s}
                onClick={e => { e.stopPropagation(); onUpdate(lead.id, s); setOpen(false); }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 14px",
                  background: s === lead.status ? "#f9fafb" : "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: s === lead.status ? 600 : 400,
                  color: c.text,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f3f4f6")}
                onMouseLeave={e => (e.currentTarget.style.background = s === lead.status ? "#f9fafb" : "#fff")}
              >
                {STATUS_LABELS[s]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LeadDetailModal ──────────────────────────────────────────────────────────

interface LeadDetailModalProps {
  lead: Lead;
  onClose: () => void;
  onStatusChange: (id: number, status: LeadStatus) => void;
}

function LeadDetailModal({ lead, onClose, onStatusChange }: LeadDetailModalProps) {
  const [optimisticStatus, setOptimisticStatus] = useState<LeadStatus>(lead.status);

  function handleStatus(s: LeadStatus) {
    setOptimisticStatus(s);
    onStatusChange(lead.id, s);
  }

  const platformColors = PLATFORM_COLORS[lead.platform];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 20,
          width: "100%",
          maxWidth: 540,
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid #f3f4f6" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <p style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 4 }}>Lead</p>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#111827", margin: 0 }}>{lead.name}</h2>
            </div>
            <button
              onClick={onClose}
              style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ padding: "3px 10px", borderRadius: 9999, fontSize: "0.72rem", fontWeight: 600, background: platformColors.bg, color: platformColors.text }}>
              {PLATFORM_LABELS[lead.platform]}
            </span>
            <span style={{ padding: "3px 10px", borderRadius: 9999, fontSize: "0.72rem", fontWeight: 500, background: "#f3f4f6", color: "#6b7280" }}>
              {formatDateTime(lead.created_at)}
            </span>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 28px" }}>
          <p style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 8 }}>Mensaje</p>
          <p style={{ fontSize: "0.9rem", color: "#374151", lineHeight: 1.6, margin: 0 }}>{lead.message}</p>

          {lead.origin_post && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 8 }}>Post de origen</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "0.875rem", color: "#374151" }}>{lead.origin_post}</span>
                {lead.origin_post_url && (
                  <a
                    href={lead.origin_post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--color-primary, #6366f1)", flexShrink: 0 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M5.5 2H2a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V8.5M8.5 1H13m0 0v4.5M13 1L6 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </a>
                )}
              </div>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <p style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 10 }}>Estado</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ALL_STATUSES.map(s => {
                const c = STATUS_COLORS[s];
                const active = optimisticStatus === s;
                return (
                  <button
                    key={s}
                    onClick={() => handleStatus(s)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 9999,
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      background: active ? c.bg : "#f9fafb",
                      color: active ? c.text : "#6b7280",
                      border: active ? `2px solid ${c.text}30` : "2px solid transparent",
                      cursor: "pointer",
                      outline: "none",
                      boxShadow: active ? `0 0 0 3px ${c.bg}` : "none",
                      transition: "all 0.15s",
                    }}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PubLeadsPage() {
  const { isDark } = useDarkMode();
  const [data, setData]           = useState<LeadsResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Filters
  const [search, setSearch]       = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [platform, setPlatform]   = useState("");
  const [status, setStatus]       = useState("");
  const [dateFrom, setDateFrom]   = useState("");
  const [dateTo, setDateTo]       = useState("");
  const [page, setPage]           = useState(1);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page) };
      if (debouncedSearch) params.search = debouncedSearch;
      if (platform)        params.platform = platform;
      if (status)          params.status = status;
      if (dateFrom)        params.date_from = dateFrom;
      if (dateTo)          params.date_to = dateTo;
      const res = await fetchLeads(params);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, platform, status, dateFrom, dateTo, page]);

  useEffect(() => { load(); }, [load]);

  function handleStatusChange(id: number, newStatus: LeadStatus) {
    updateLeadStatus(id, newStatus);
    setData(prev => {
      if (!prev) return prev;
      return { ...prev, data: prev.data.map(l => l.id === id ? { ...l, status: newStatus } : l) };
    });
    if (selectedLead?.id === id) setSelectedLead(prev => prev ? { ...prev, status: newStatus } : prev);
  }

  function clearFilters() {
    setSearch(""); setDebouncedSearch(""); setPlatform("");
    setStatus(""); setDateFrom(""); setDateTo(""); setPage(1);
  }

  const hasFilters = search || platform || status || dateFrom || dateTo;

  const inputStyle: React.CSSProperties = {
    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
    borderRadius: 12,
    padding: "8px 14px",
    fontSize: "0.875rem",
    color: isDark ? '#f9fafb' : '#111827',
    background: isDark ? '#374151' : '#fff',
    outline: "none",
    height: 38,
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    paddingRight: 30,
    cursor: "pointer",
  };

  return (
    <div style={{ padding: "24px 28px", minHeight: "100vh", background: isDark ? '#111827' : '#f8f9fb' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 4 }}>Captura</p>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: isDark ? '#f9fafb' : '#111827', margin: 0 }}>Leads</h1>
      </div>

      {/* Filters */}
      <div style={{
        background: isDark ? '#1f2937' : '#fff',
        borderRadius: 16,
        border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
        padding: "16px 20px",
        marginBottom: 20,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
      }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 160 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }}>
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Buscar por nombre o mensaje…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: "100%", paddingLeft: 34, boxSizing: "border-box" }}
          />
        </div>

        {/* Platform */}
        <select value={platform} onChange={e => { setPlatform(e.target.value); setPage(1); }} style={{ ...selectStyle, flex: "0 0 auto" }}>
          <option value="">Todas las plataformas</option>
          {ALL_PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
        </select>

        {/* Status */}
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={{ ...selectStyle, flex: "0 0 auto" }}>
          <option value="">Todos los estados</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>

        {/* Date From */}
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setPage(1); }}
          style={{ ...inputStyle, flex: "0 0 auto", cursor: "pointer" }}
        />

        {/* Date To */}
        <input
          type="date"
          value={dateTo}
          onChange={e => { setDateTo(e.target.value); setPage(1); }}
          style={{ ...inputStyle, flex: "0 0 auto", cursor: "pointer" }}
        />

        {/* Clear */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            style={{
              background: "none",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: "6px 14px",
              fontSize: "0.8rem",
              color: "#6b7280",
              cursor: "pointer",
              height: 38,
              whiteSpace: "nowrap",
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{
        background: isDark ? '#1f2937' : '#fff',
        borderRadius: 20,
        border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        overflow: "hidden",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: isDark ? '#111827' : '#f9fafb' }}>
                {["Nombre", "Mensaje", "Plataforma", "Post de origen", "Fecha", "Estado", ""].map(col => (
                  <th key={col} style={{
                    padding: "11px 18px",
                    textAlign: "left",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "#9ca3af",
                    borderBottom: "1px solid #f3f4f6",
                    whiteSpace: "nowrap",
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: "40px 18px", textAlign: "center", color: "#9ca3af", fontSize: "0.875rem" }}>
                    Cargando…
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td colSpan={7} style={{ padding: "40px 18px", textAlign: "center", color: "#9ca3af", fontSize: "0.875rem" }}>
                    No se encontraron leads con los filtros aplicados.
                  </td>
                </tr>
              ) : data.data.map((lead, i) => {
                const platformColors = PLATFORM_COLORS[lead.platform];
                return (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    style={{
                      borderBottom: i < data.data.length - 1 ? "1px solid #f3f4f6" : "none",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#fafafa")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Nombre */}
                    <td style={{ padding: "13px 18px", fontSize: "0.875rem", fontWeight: 600, color: isDark ? '#f9fafb' : '#111827', whiteSpace: "nowrap" }}>
                      {lead.name}
                    </td>
                    {/* Mensaje */}
                    <td style={{ padding: "13px 18px", fontSize: "0.85rem", color: isDark ? '#9ca3af' : '#6b7280', maxWidth: 280 }}>
                      {truncate(lead.message, 80)}
                    </td>
                    {/* Plataforma */}
                    <td style={{ padding: "13px 18px", whiteSpace: "nowrap" }}>
                      <span style={{
                        padding: "3px 10px",
                        borderRadius: 9999,
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        background: platformColors.bg,
                        color: platformColors.text,
                        whiteSpace: "nowrap",
                      }}>
                        {PLATFORM_LABELS[lead.platform]}
                      </span>
                    </td>
                    {/* Post de origen */}
                    <td style={{ padding: "13px 18px", fontSize: "0.85rem", color: isDark ? '#9ca3af' : '#6b7280', maxWidth: 180 }}>
                      {lead.origin_post ? truncate(lead.origin_post, 30) : <span style={{ color: isDark ? '#4b5563' : '#d1d5db' }}>—</span>}
                    </td>
                    {/* Fecha */}
                    <td style={{ padding: "13px 18px", fontSize: "0.82rem", color: isDark ? '#9ca3af' : '#6b7280', whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {formatDate(lead.created_at)}
                    </td>
                    {/* Estado */}
                    <td style={{ padding: "13px 18px" }} onClick={e => e.stopPropagation()}>
                      <StatusDropdown lead={lead} onUpdate={handleStatusChange} />
                    </td>
                    {/* Acciones */}
                    <td style={{ padding: "13px 18px" }}>
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedLead(lead); }}
                        style={{
                          background: "none",
                          border: "1px solid #e5e7eb",
                          borderRadius: 8,
                          padding: "5px 10px",
                          cursor: "pointer",
                          color: "#6b7280",
                          fontSize: "0.78rem",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.meta.last_page > 1 && (
          <div style={{
            padding: "14px 20px",
            borderTop: `1px solid ${isDark ? '#374151' : '#f3f4f6'}`,
            display: "flex",
            gap: 6,
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
              {data.meta.total} resultados
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {data.links.map((link, i) => (
                <button
                  key={i}
                  disabled={!link.url}
                  onClick={() => {
                    if (!link.url) return;
                    const p = parseInt(new URL(link.url, "http://x").searchParams.get("page") ?? "1");
                    setPage(p);
                  }}
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(link.label) }}
                  style={{
                    padding: "5px 11px",
                    borderRadius: 8,
                    border: "1px solid",
                    borderColor: link.active ? "var(--color-primary, #6366f1)" : "#e5e7eb",
                    background: link.active ? "var(--color-primary, #6366f1)" : "#fff",
                    color: link.active ? "#fff" : link.url ? "#374151" : "#d1d5db",
                    fontSize: "0.8rem",
                    cursor: link.url ? "pointer" : "default",
                    fontVariantNumeric: "tabular-nums",
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
