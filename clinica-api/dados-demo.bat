@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Cadastrando dados de demonstracao no banco...
call npx tsx src/scripts/dados-demo.ts
echo.
pause
