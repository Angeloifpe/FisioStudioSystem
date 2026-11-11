@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Cadastrando dados de teste no banco...
call npm run dados-teste -- %*
echo.
pause
