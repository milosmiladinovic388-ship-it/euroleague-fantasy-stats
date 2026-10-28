@echo off
rem Osvezava podatke i pokrece aplikaciju na http://localhost:8787
cd /d "%~dp0"
echo Preuzimam najnovije podatke sa EuroLeague API-ja...
node scripts\fetch-data.mjs
start "" http://localhost:8787
node scripts\serve.mjs 8787
