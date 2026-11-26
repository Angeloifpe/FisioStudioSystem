@echo off
chcp 65001 >nul
echo Atualizando o banco "clinica" (nenhum dado e apagado)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
echo.
pause
