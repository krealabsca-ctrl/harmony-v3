@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

title Harmony v3 - Arranque local
echo ============================================
echo   Harmony v3 - Levantando entorno local
echo ============================================
echo.

REM --- 1. Asegurar que Docker Desktop este corriendo ---
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker no responde, iniciando Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo Esperando a que Docker arranque ^(puede tardar 1-2 minutos^)...
    set /a tries=0
    :waitdocker
    set /a tries+=1
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        if !tries! GEQ 40 (
            echo.
            echo No se pudo iniciar Docker despues de varios intentos.
            echo Abri Docker Desktop manualmente y volve a correr este script.
            pause
            exit /b 1
        )
        goto waitdocker
    )
)
echo Docker listo.
echo.

REM --- 2. Levantar Postgres y Redis ---
echo Levantando Postgres y Redis...
docker compose -f "%ROOT%\docker-compose.yml" up -d
if errorlevel 1 (
    echo Fallo "docker compose up". Revisa el mensaje de arriba.
    pause
    exit /b 1
)

REM --- 3. Esperar a que Postgres acepte conexiones ---
echo Esperando a que Postgres este listo...
set /a tries=0
:waitpg
set /a tries+=1
docker exec harmonyv3-postgres-1 pg_isready -U harmony >nul 2>&1
if errorlevel 1 (
    if !tries! GEQ 20 (
        echo Postgres no respondio a tiempo, continuando de todas formas...
        goto pgdone
    )
    timeout /t 2 /nobreak >nul
    goto waitpg
)
:pgdone
echo Postgres listo.
echo.

REM --- 4. Backend Go ---
echo Iniciando backend ^(API Go^)...
start "Harmony API" cmd /k "cd /d "%ROOT%\api" && go run ./cmd/server/main.go"

REM --- 5. Frontend Vite ---
echo Iniciando frontend ^(Vite^)...
start "Harmony Web" cmd /k "cd /d "%ROOT%\web" && npm run dev"

echo.
echo ============================================
echo   Listo.
echo   API:      http://localhost:8080
echo   Frontend: http://localhost:3000
echo ============================================
timeout /t 5 /nobreak >nul
exit /b 0
