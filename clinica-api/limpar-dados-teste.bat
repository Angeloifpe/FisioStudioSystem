@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Apagando os pacientes de teste...
call npm run dados-teste -- --limpar
echo.
pause
