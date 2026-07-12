# Levantar Harmony v3 en local (macOS) y en un servidor de producción

## Contexto

Harmony v3 es un sistema multi-tenant compuesto por un backend en Go 1.22 + Gin (`api/`) y un frontend en React 19 + Vite + TypeScript (`web/`), con PostgreSQL como base de datos y Redis para colas (Asynq). El proyecto ya trae su propia documentación de instalación (`Manual_Inicio_Local.pdf`, `README-INSTALACION.txt`) y de despliegue (`servidor/`, `github-actions/`, `manuales/01-azure-manual.html`, `manuales/02-digitalocean-manual.html`), pero:

- El manual PDF está escrito para Windows/PowerShell con rutas de OneDrive — hay que adaptarlo a macOS.
- El manual dice que el frontend corre en el puerto **3001**, pero el `vite.config.ts` real del repo usa el puerto **3000** (coincide con `FRONTEND_URL=http://localhost:3000` en `api/.env.example`). Se usará **3000** como fuente de verdad.
- El archivo `servidor/.env.ejemplo` (para producción) usa nombres de variable que **no coinciden** con lo que realmente lee el backend en `api/internal/config/config.go` (`REDIS_URL` en vez de `REDIS_ADDR`, `ANTHROPIC_KEY` en vez de `ANTHROPIC_API_KEY`, falta `DB_NAME` y `DB_SSLMODE`). Hay que corregir esto al crear el `.env` real del servidor, si no el backend no arrancará (`APP_KEY` y `DB_PASS` son obligatorios, y `JWT_SECRET` debe tener **mínimo 32 caracteres** — el proceso se cierra con `log.Fatalf` si falta o no cumple).
- En producción (`APP_ENV=production`) el propio `config.go` **bloquea el arranque** si `DB_SSLMODE=disable` (exige `require` o `verify-full`) o si `FRONTEND_URL` no empieza con `https://`. Hay que confirmar que PostgreSQL en el servidor tiene SSL habilitado antes de fijar `DB_SSLMODE=require`, o la conexión fallará.
- Esta carpeta de trabajo no es un repositorio git todavía. El script `servidor/deploy.sh` y el pipeline de GitHub Actions (`github-actions/deploy.yml`) asumen `git pull origin main` sobre un repo ya clonado en el servidor — por lo tanto, antes del despliegue en servidor, el proyecto debe subirse a un repositorio Git (GitHub) desde donde el servidor pueda clonar/hacer pull.
- **Hallazgo crítico (verificado leyendo el código, no solo los manuales):** contrario a lo que dicen `README-INSTALACION.txt` y `Manual_Inicio_Local.pdf` ("las migraciones del sistema se ejecutan automáticamente" / login por defecto `admin@harmony.com` / `password`), **eso no ocurre en el estado actual del código**:
  - `api/internal/database/provision.go` declara `//go:embed migrations/system/*.sql` pero **ninguna función lo lee ni lo ejecuta**. Solo se usa el embed de `migrations/company/*.sql` (vía `runCompanyMigrations`, disparado al crear una empresa).
  - `ConnectSystem()` (`api/internal/database/system.go`) solo crea `channel_lookup` y `users_lookup` con `CREATE TABLE IF NOT EXISTS` — nunca crea `companies`, `system_settings` ni `users` en `harmony_system`.
  - No existe ninguna tabla `users` definida para `harmony_system` en ninguna migración (la única `CREATE TABLE users` está en `api/internal/database/migrations/company/001_create_core_tables.sql`, que solo corre contra las DBs por empresa `harmony_c{id}`).
  - No hay endpoint de signup público; `POST /api/admin/companies` y `POST /api/admin/users` requieren ya tener una sesión de `superadmin`/`admin` — es decir, **no hay forma de crear el primer usuario sin intervención manual directa en la base de datos**.
  - Conclusión: al arrancar el backend por primera vez, `harmony_system` queda prácticamente vacía y el login siempre fallará con "credenciales inválidas", sin importar qué tan bien esté configurado todo lo demás. Esta guía incluye el paso manual necesario para bootstrapear el primer superadmin (ver Parte 1, paso 4.5). Esto también podría arreglarse en el código (agregar una función que corra `systemMigrations` en `ConnectSystem()`), pero es un cambio de código aparte, no incluido aquí.

Estado verificado en esta Mac: ya están instalados Homebrew, Node 22 / npm 11, y Redis (vía brew, corriendo como servicio). **Faltan**: Go y PostgreSQL (ni `psql` ni el servidor están instalados). No hay Docker instalado, así que en vez de usar `docker-compose.yml` se instalará PostgreSQL nativo con Homebrew (Redis ya corre nativo, evita conflicto de puertos con el `docker-compose.yml`).

---

## Parte 1 — Levantar en local (macOS)

### 1. Instalar prerrequisitos faltantes
```bash
brew install go
brew install postgresql@16
brew services start postgresql@16
brew services list   # confirmar postgresql@16 y redis en "started"
go version            # debe dar 1.22+
redis-cli ping         # debe dar PONG
```

### 2. Crear usuario y base de datos en PostgreSQL
```bash
psql postgres
```
Dentro de `psql`:
```sql
CREATE USER harmony WITH PASSWORD 'harmony_secret';
CREATE DATABASE harmony_system OWNER harmony;
\q
```
(Pese a lo que sugieren los manuales, estas migraciones NO se ejecutan solas — ver el paso 4.5 más abajo para el bootstrap manual necesario.)

### 3. Configurar el backend
```bash
cd api
cp .env.example .env
```
Editar `api/.env` y ajustar como mínimo:
- `APP_KEY` — cualquier string, obligatorio (el server no arranca sin esto).
- `JWT_SECRET` — cualquier string para desarrollo.
- `DB_PASS=harmony_secret` (o la que hayas usado en el paso 2).
- Dejar `DB_SSLMODE=disable` para local.
- `FRONTEND_URL=http://localhost:3000`.
- `ANTHROPIC_API_KEY` es opcional (solo si se quiere probar el bot de IA).

### 4. Levantar el backend
```bash
cd api
go mod tidy
go run cmd/server/main.go
```
Salida esperada: conexión a `harmony_system`, WebSocket Hub, "Servidor corriendo en http://localhost:8080". Dejar esta terminal abierta.
> Nota: pese a lo que dice el manual PDF, no vas a ver un log de "corriendo migraciones del sistema" — ese paso no existe en el código actual (ver Contexto). Es normal, se soluciona en el siguiente paso.

### 4.5. Bootstrap manual del primer superadmin (obligatorio — sin esto el login siempre falla)
Con el backend ya arrancado al menos una vez (para que `harmony_system` exista), aplicar manualmente lo que el código no hace solo:
```bash
# 1. Crear las tablas del sistema (companies, system_settings)
psql -U harmony -d harmony_system -f api/internal/database/migrations/system/001_create_companies.sql

# 2. Crear la tabla users en harmony_system (no la crea ninguna migración; se reutiliza
#    el mismo esquema que usan las empresas en migrations/company/001_create_core_tables.sql)
psql -U harmony -d harmony_system <<'EOF'
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT,
    department_id BIGINT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'agent' CHECK (role IN ('superadmin','admin','supervisor','agent','mercadeo')),
    avatar_path TEXT,
    is_online BOOLEAN DEFAULT false,
    last_seen_at TIMESTAMPTZ,
    can_send_campaigns BOOLEAN DEFAULT false,
    can_access_advertising BOOLEAN DEFAULT false,
    is_bot BOOLEAN DEFAULT false,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
EOF
```
Generar el hash bcrypt de la contraseña usando el propio módulo Go del proyecto (ya trae `golang.org/x/crypto` en `go.mod`):
```bash
cd api
mkdir -p cmd/hashpw
cat > cmd/hashpw/main.go <<'EOF'
package main

import (
	"fmt"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	h, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.DefaultCost)
	fmt.Println(string(h))
}
EOF
go run ./cmd/hashpw
rm -rf cmd/hashpw   # limpiar, era solo para generar el hash
```
Con el hash impreso, insertar el superadmin (`company_id` en `NULL` porque el superadmin es global):
```bash
psql -U harmony -d harmony_system -c \
  "INSERT INTO users (company_id, name, email, password, role) VALUES (NULL, 'Super Admin', 'admin@harmony.com', '<HASH_BCRYPT_AQUI>', 'superadmin');"
```

### 5. Levantar el frontend (en otra terminal)
```bash
cd web
npm install
npm run dev
```
Vite arrancará en **http://localhost:3000** (proxy automático de `/api` y `/ws` hacia `localhost:8080`, definido en `vite.config.ts`).

### 6. Acceder al sistema
- Abrir `http://localhost:3000`.
- Login con el superadmin creado manualmente en el paso 4.5: `admin@harmony.com` / `password` (o la contraseña que hayas hasheado).
- Si el login falla, revisar que la fila se insertó bien (`psql -U harmony -d harmony_system -c "SELECT id, email, role FROM users;"`) y los logs de la terminal del backend.
- Una vez logueado como superadmin, ya se puede crear la primera empresa real desde la UI (o `POST /api/admin/companies`), lo cual sí provisiona automáticamente `harmony_c{id}` con sus migraciones (ese flujo funciona correctamente, a diferencia del bootstrap inicial de `harmony_system`).

### Problemas comunes (de `Manual_Inicio_Local.pdf`, adaptado a macOS)
- Puerto 8080 ocupado: `lsof -i :8080` y `kill -9 <PID>`.
- Error de conexión a `harmony_system`: verificar `brew services list` y probar `psql -U harmony -d harmony_system -c 'SELECT 1'`.
- Errores de CORS: confirmar que el backend está corriendo y que `FRONTEND_URL` en `api/.env` es exactamente `http://localhost:3000`.

---

## Parte 2 — Requisitos para levantarlo en un servidor de producción

### 0. Prerrequisito: subir el proyecto a Git
Como esta carpeta no es aún un repositorio Git, antes de desplegar hay que:
```bash
git init
git add .
git commit -m "Initial commit"
```
y subirlo a un repositorio remoto (GitHub), ya que tanto `servidor/deploy.sh` como el pipeline de `github-actions/deploy.yml` funcionan haciendo `git pull` / clonando desde ese remoto.

### 1. Provisionar un servidor Ubuntu 22.04 LTS
Puede ser Azure o DigitalOcean — hay guías detalladas en `manuales/01-azure-manual.html` y `manuales/02-digitalocean-manual.html`. Se necesita acceso root por SSH.

### 2. Ejecutar el script de setup inicial (una sola vez, como root)
```bash
scp servidor/setup-servidor.sh root@TU_IP:/root/
ssh root@TU_IP
bash setup-servidor.sh
```
Esto instala Go 1.22, Node 20, PostgreSQL 16, Redis, Nginx, Certbot, configura UFW (SSH+80+443), crea el usuario de sistema `harmony`, los directorios `/opt/harmony/{bin,uploads}` y `/var/www/harmony`, y crea la base de datos `harmony_system` (pide la contraseña de PostgreSQL de forma interactiva).

### 3. Clonar el repositorio en el servidor
```bash
git clone <URL_DEL_REPO> /opt/harmony/repo
```

### 4. Crear `/opt/harmony/.env` con los nombres de variable CORRECTOS
No copiar `servidor/.env.ejemplo` tal cual — tiene nombres de variable que el backend no reconoce. Usar esta lista (verificada contra `api/internal/config/config.go`):
```
APP_ENV=production
PORT=8080
APP_KEY=<string aleatorio, obligatorio>
FRONTEND_URL=https://TU_DOMINIO

DB_HOST=localhost
DB_PORT=5432
DB_USER=harmony
DB_PASS=<contraseña segura, obligatorio>
DB_NAME=harmony_system
DB_SSLMODE=require        # "disable" está BLOQUEADO en producción (config.go hace log.Fatalf).
                          # Requiere que PostgreSQL tenga SSL habilitado (ssl = on en postgresql.conf,
                          # certificados en /etc/postgresql/16/main/server.crt/.key). Verificar antes
                          # de arrancar, o el backend no podrá conectar a la DB.

JWT_SECRET=<generar con: openssl rand -hex 32>
JWT_EXPIRY_HOURS=24

REDIS_ADDR=localhost:6379
REDIS_PASSWORD=

ANTHROPIC_API_KEY=sk-ant-...   # opcional

AZURE_STORAGE_ACCOUNT=          # opcional
AZURE_STORAGE_KEY=              # opcional
AZURE_STORAGE_CONNECTION_STRING=  # opcional
```
```bash
chmod 600 /opt/harmony/.env
chown harmony:harmony /opt/harmony/.env
```

### 5. Configurar Nginx y el servicio systemd
```bash
cp servidor/nginx.conf /etc/nginx/sites-available/harmony
# editar el dominio dentro del archivo (reemplazar harmony.tuempresa.com)
ln -s /etc/nginx/sites-available/harmony /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t

cp servidor/harmony-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable harmony-api
```

### 6. Primer despliegue
```bash
cp servidor/deploy.sh /opt/harmony/deploy.sh
chmod +x /opt/harmony/deploy.sh
bash /opt/harmony/deploy.sh     # compila el binario Go y el build de Vite, copia dist/ a /var/www/harmony
systemctl start harmony-api
systemctl status harmony-api
```

### 6.5. Bootstrap manual del primer superadmin (mismo problema que en local)
El mismo hallazgo del Contexto aplica aquí: `harmony_system` queda sin tablas `companies`/`system_settings`/`users` tras el primer arranque. Repetir en el servidor el mismo procedimiento del paso 4.5 de la Parte 1, apuntando a `/opt/harmony/repo`:
```bash
sudo -u postgres psql -d harmony_system -f /opt/harmony/repo/api/internal/database/migrations/system/001_create_companies.sql
sudo -u postgres psql -d harmony_system   # y correr ahí el mismo CREATE TABLE users del paso 4.5

cd /opt/harmony/repo/api
mkdir -p cmd/hashpw && cat > cmd/hashpw/main.go <<'EOF'
package main
import ("fmt";"golang.org/x/crypto/bcrypt")
func main(){ h,_:=bcrypt.GenerateFromPassword([]byte("TU_PASSWORD_SEGURO"), bcrypt.DefaultCost); fmt.Println(string(h)) }
EOF
go run ./cmd/hashpw
rm -rf cmd/hashpw

sudo -u postgres psql -d harmony_system -c \
  "INSERT INTO users (company_id, name, email, password, role) VALUES (NULL, 'Super Admin', 'admin@tudominio.com', '<HASH_BCRYPT>', 'superadmin');"
```
Usar una contraseña real y un email real en producción — no dejar `admin@harmony.com` / `password` expuestos públicamente.

### 7. Certificado SSL
```bash
certbot --nginx -d TU_DOMINIO
systemctl restart nginx
```

### 8. (Opcional) CI/CD automático con GitHub Actions
Seguir `github-actions/INSTRUCCIONES-CICD.txt`:
1. Generar una clave SSH dedicada en el servidor y agregarla a `authorized_keys`.
2. Crear 3 secrets en GitHub (repo → Settings → Secrets → Actions): `SERVER_HOST`, `SERVER_USER`, `SSH_PRIVATE_KEY`.
3. Copiar `github-actions/deploy.yml` a `.github/workflows/deploy.yml` en el repo y hacer push a `main`.
4. Cada push a `main` disparará `bash /opt/harmony/deploy.sh` en el servidor automáticamente (~2-3 min por deploy).

---

## Verificación

**Local:**
- `curl http://localhost:8080/api/auth/me` responde (401 sin token es normal, confirma que el backend responde).
- Login exitoso en `http://localhost:3000` con `admin@harmony.com` / `password`.

**Producción:**
- `systemctl status harmony-api` → `active (running)`.
- `curl -I https://TU_DOMINIO` → 200/301 con certificado válido.
- Login exitoso desde el dominio público.
- Revisar `journalctl -u harmony-api -f` para logs en vivo si algo falla.
