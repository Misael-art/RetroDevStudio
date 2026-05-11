@echo off
setlocal

:: Wrapper legado: delega ao script unificado de compilacao
:: Uso equivalente: npm run build:debug

set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

:: Respeita CARGO_TARGET_DIR se ja definido; senao usa target-test
if not defined CARGO_TARGET_DIR set "CARGO_TARGET_DIR=%PROJECT_ROOT%\src-tauri\target-test"

cd /d "%PROJECT_ROOT%"
node scripts/build.mjs debug
exit /b %ERRORLEVEL%
