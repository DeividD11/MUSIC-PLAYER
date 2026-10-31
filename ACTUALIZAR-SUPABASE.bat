@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo MUSIC PLAYER - ACTUALIZACION DEL BACKEND
echo ==============================================
echo.
supabase --version
if errorlevel 1 (
  echo ERROR: Supabase CLI no esta instalado o no esta en PATH.
  echo Instala Supabase CLI y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
echo.
echo Paso 1/3: Inicia sesion en Supabase (si ya estas autenticado, continua).
supabase login
if errorlevel 1 goto :error
echo.
echo Paso 2/3: Vinculando el proyecto MUSIC PLAYER.
supabase link --project-ref qbmhcudgtjooyyegdhkk
if errorlevel 1 goto :error
echo.
echo Paso 3/3: Desplegando music-api corregida.
supabase functions deploy music-api
if errorlevel 1 goto :error
echo.
echo ACTUALIZACION COMPLETADA.
echo Ejecuta ahora tools\verificar-supabase.ps1 para comprobar el endpoint.
pause
exit /b 0
:error
echo.
echo ERROR: No se pudo completar la actualizacion. Lee el mensaje anterior.
pause
exit /b 1
