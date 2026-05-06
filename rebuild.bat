@echo off
title Belenergy - Rebuild
cd /d "%~dp0"
echo Compilando frontend...
npm run build
echo.
echo Concluido! Reinicie o servidor.
pause
