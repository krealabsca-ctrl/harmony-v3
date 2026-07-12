#!/bin/bash
# deploy.sh — Script de despliegue de Harmony v3
# Ejecutado por GitHub Actions (o manualmente) para compilar y reiniciar el servicio.
#
# Uso manual: bash /opt/harmony/deploy.sh
# Prerrequisito: Go y Node.js deben estar instalados en el servidor.

set -e

export PATH=$PATH:/usr/local/go/bin

REPO_DIR="/opt/harmony/repo"
BIN_DIR="/opt/harmony/bin"
WEB_DIR="/var/www/harmony"

echo "=== [1/5] Actualizando código ($(date)) ==="
cd "$REPO_DIR"
git pull origin main

echo "=== [2/5] Compilando API Go ==="
cd "$REPO_DIR/api"
go mod download
go build -ldflags="-s -w" -o "$BIN_DIR/harmony-api-new" ./cmd/server/main.go
mv "$BIN_DIR/harmony-api-new" "$BIN_DIR/harmony-api"
chown harmony:harmony "$BIN_DIR/harmony-api"
chmod 755 "$BIN_DIR/harmony-api"

echo "=== [3/5] Compilando Frontend React ==="
cd "$REPO_DIR/web"
npm ci --prefer-offline
npm run build

echo "=== [4/5] Actualizando archivos estáticos ==="
rm -rf "$WEB_DIR"/*
cp -r dist/* "$WEB_DIR/"
chown -R www-data:www-data "$WEB_DIR"

echo "=== [5/5] Reiniciando servicio ==="
systemctl restart harmony-api
systemctl status harmony-api --no-pager

echo ""
echo "====================================================="
echo "  Deploy completado exitosamente: $(date)"
echo "====================================================="
