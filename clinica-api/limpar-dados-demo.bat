@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Removendo os dados de demonstracao...
call npx tsx src/scripts/dados-demo.ts --limpar
echo.
pause
