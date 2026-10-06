@echo off
REM Starts the three long-lived processes: web, Discord bot, worker.
REM Each opens in its own window so you can see its output; close a window to stop it.
cd /d "%~dp0.."
start "diary web"    cmd /k npm run dev
start "diary worker" cmd /k npm run worker
start "diary bot"    cmd /k npm run bot
