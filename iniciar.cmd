@echo off
cd /d "%~dp0"
start "" http://localhost:8105
node servidor\servidor.js
