@echo off
setlocal

set "REPO_ROOT=%~dp0.."
pushd "%REPO_ROOT%\workbench-extension"
if not exist node_modules call npm ci
if errorlevel 1 exit /b 1
call npm run check
if errorlevel 1 exit /b 1
call npm run package:distribution
if errorlevel 1 exit /b 1
popd

echo Built %REPO_ROOT%\distribution\generalstaff-workbench.vsix
