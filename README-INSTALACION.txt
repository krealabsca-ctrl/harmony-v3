=== HARMONY v3 — INSTALACION COMPLETA ===
Generado: 2026-07-02
Seguridad: 3 rondas de auditoria (ronda 1: 27, ronda 2: 14, ronda 3: 35 correcciones)

ESTRUCTURA
----------
harmony-v3/
  api/            Go 1.22 + Gin backend
  web/            React 19 + Vite + TypeScript frontend
  docker-compose.yml
  Manual_Inicio_Local.pdf
  manuales/       Documentacion HTML (5 archivos)
  servidor/       Configuracion nginx, systemd, certbot (5 archivos)
  github-actions/ Pipeline CI/CD (deploy.yml + instrucciones)

REQUISITOS PREVIOS
------------------
- Go 1.22+
- Node.js 20+ / npm 10+
- PostgreSQL 16
- Redis 7
- Git

PASOS DE INSTALACION
--------------------
1. Clonar / descomprimir en la carpeta de trabajo

2. Iniciar servicios base:
   docker-compose up -d

3. Backend:
   cd harmony-v3/api
   cp .env.example .env
   # Editar .env: DATABASE_URL, JWT_SECRET, FRONTEND_URL, etc.
   go mod tidy
   go run cmd/server/main.go

4. Frontend:
   cd harmony-v3/web
   npm install
   cp .env.example .env.local   # si existe
   npm run dev

5. Produccion:
   - Ver harmony-v3/servidor/ para nginx, systemd y certbot
   - Ver harmony-v3/github-actions/ para CI/CD automatizado

CORRECCIONES DE SEGURIDAD INCLUIDAS (rondas 1-3)
------------------------------------------------
Ronda 3 (criticas):
- Aislamiento cross-tenant en WebSocket (canales company.{id}.*)
- Aprobacion de publicaciones valida el remitente de WhatsApp
- verify_token validado en Messenger e Instagram (antes solo WhatsApp)
- Circuit breaker: una sola sonda en estado HALF-OPEN
- Limite de tamano de body (16MB global / 1MB webhooks) anti-OOM
- Cifrado AES-256-GCM en reposo de credenciales y webhook_secret
- Tablas lookup (channel_lookup/users_lookup) anti-DoS por escaneo de tenants
- Pool DB con eviction LRU (evita denegacion por limite de 100)
Ronda 3 (altas/medias):
- IDOR cerrado en 6 handlers de conversaciones
- ServeUpload: cookie httpOnly + validacion de path y algoritmo JWT
- Deadlines/ping-pong/limites en WebSocket + janitor de tickets
- Rate limiter atomico + SetTrustedProxies (anti-spoof de IP)
- Validacion E.164 de telefonos + CSV injection neutralizada
- JWT solo en cookie (fuera de JavaScript) + backoff WS
- Responsive movil (sidebar drawer, inbox lista->detalle)
Rondas 1-2:
- JWT en cookie httpOnly SameSite=Strict, tickets WS de un solo uso
- DOMPurify, rate limits, graceful shutdown, indices, SVG XSS, etc.
- Ver manuales/05-auditoria-seguridad.html para detalle completo

SOPORTE
-------
Contacto: ti@valledepazcr.com
