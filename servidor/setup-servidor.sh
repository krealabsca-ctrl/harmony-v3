#!/bin/bash
# setup-servidor.sh — Script de configuración inicial del servidor para Harmony v3
#
# EJECUTAR COMO ROOT una sola vez en el servidor nuevo (Azure o DigitalOcean).
# Este script instala todas las dependencias y crea la estructura de directorios.
#
# Uso: bash setup-servidor.sh
# Plataforma: Ubuntu 22.04 LTS

set -e

echo ""
echo "======================================================"
echo "  Harmony v3 — Setup inicial del servidor"
echo "  Ubuntu 22.04 LTS"
echo "======================================================"
echo ""

# ----- 1. Actualizar sistema -----
echo "[1/9] Actualizando paquetes del sistema..."
apt update && apt upgrade -y
apt install -y git curl wget unzip build-essential ufw

# ----- 2. Go 1.22 -----
echo "[2/9] Instalando Go 1.22..."
if ! command -v go &> /dev/null; then
    wget -q https://go.dev/dl/go1.22.5.linux-amd64.tar.gz
    rm -rf /usr/local/go
    tar -C /usr/local -xzf go1.22.5.linux-amd64.tar.gz
    rm go1.22.5.linux-amd64.tar.gz
    echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
    source /etc/profile.d/go.sh
    echo "    Go instalado: $(go version)"
else
    echo "    Go ya instalado: $(go version)"
fi

# ----- 3. Node.js 20 -----
echo "[3/9] Instalando Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
    echo "    Node.js instalado: $(node -v)"
else
    echo "    Node.js ya instalado: $(node -v)"
fi

# ----- 4. PostgreSQL 16 -----
echo "[4/9] Instalando PostgreSQL 16..."
if ! command -v psql &> /dev/null; then
    apt install -y postgresql-common
    /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
    apt install -y postgresql-16
    systemctl enable --now postgresql
    echo "    PostgreSQL instalado"
else
    echo "    PostgreSQL ya instalado"
fi

# ----- 5. Redis -----
echo "[5/9] Instalando Redis..."
if ! command -v redis-cli &> /dev/null; then
    apt install -y redis-server
    sed -i 's/^# bind 127.0.0.1/bind 127.0.0.1/' /etc/redis/redis.conf
    systemctl enable --now redis-server
    echo "    Redis instalado"
else
    echo "    Redis ya instalado"
fi

# ----- 6. Nginx + Certbot -----
echo "[6/9] Instalando Nginx y Certbot..."
apt install -y nginx certbot python3-certbot-nginx
systemctl enable nginx
echo "    Nginx instalado"

# ----- 7. Firewall -----
echo "[7/9] Configurando UFW..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "    Firewall configurado (SSH + 80 + 443)"

# ----- 8. Usuario y directorios -----
echo "[8/9] Creando usuario 'harmony' y directorios..."
if ! id harmony &> /dev/null; then
    useradd --system --no-create-home --shell /bin/false harmony
    echo "    Usuario 'harmony' creado"
fi
mkdir -p /opt/harmony/bin /opt/harmony/uploads
mkdir -p /var/www/harmony
chown -R harmony:harmony /opt/harmony
chown -R www-data:www-data /var/www/harmony
echo "    Directorios creados: /opt/harmony, /var/www/harmony"

# ----- 9. Configurar PostgreSQL -----
echo "[9/9] Creando base de datos PostgreSQL..."
echo ""
echo "  Introduce la contraseña para el usuario 'harmony' de PostgreSQL:"
read -s DB_PASSWORD
echo ""

sudo -u postgres psql << EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'harmony') THEN
    CREATE USER harmony WITH PASSWORD '$DB_PASSWORD';
    ALTER USER harmony CREATEDB;
  END IF;
END
\$\$;
SELECT 1 FROM pg_database WHERE datname = 'harmony_system' \gexec
CREATE DATABASE harmony_system OWNER harmony;
GRANT ALL PRIVILEGES ON DATABASE harmony_system TO harmony;
EOF
echo "    Base de datos 'harmony_system' creada"

# ----- Resumen -----
echo ""
echo "======================================================"
echo "  Setup completado. Próximos pasos:"
echo ""
echo "  1. Clona el repositorio en /opt/harmony/repo:"
echo "     git clone <URL_REPO> /opt/harmony/repo"
echo ""
echo "  2. Crea el archivo de variables de entorno:"
echo "     cp .env.ejemplo /opt/harmony/.env"
echo "     nano /opt/harmony/.env  (completa los valores)"
echo "     chmod 600 /opt/harmony/.env"
echo "     chown harmony:harmony /opt/harmony/.env"
echo ""
echo "  3. Copia los archivos de configuración:"
echo "     cp nginx.conf /etc/nginx/sites-available/harmony"
echo "     (edita el dominio dentro del archivo)"
echo "     ln -s /etc/nginx/sites-available/harmony /etc/nginx/sites-enabled/"
echo "     rm -f /etc/nginx/sites-enabled/default"
echo ""
echo "     cp harmony-api.service /etc/systemd/system/"
echo "     systemctl daemon-reload"
echo "     systemctl enable harmony-api"
echo ""
echo "  4. Copia el script de deploy:"
echo "     cp deploy.sh /opt/harmony/deploy.sh"
echo "     chmod +x /opt/harmony/deploy.sh"
echo ""
echo "  5. Ejecuta el primer deploy:"
echo "     bash /opt/harmony/deploy.sh"
echo "     systemctl start harmony-api"
echo ""
echo "  6. Obtén el certificado SSL:"
echo "     certbot --nginx -d TU_DOMINIO"
echo "======================================================"
