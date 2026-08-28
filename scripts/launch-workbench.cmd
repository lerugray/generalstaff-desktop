@echo off
setlocal

set "REPO_ROOT=%~dp0.."
set "EXTENSION_PACKAGE=%REPO_ROOT%\distribution\generalstaff-workbench.vsix"
if defined GS_WORKBENCH_DATA_DIR (
  set "RUNTIME_ROOT=%GS_WORKBENCH_DATA_DIR%"
) else (
  set "RUNTIME_ROOT=%REPO_ROOT%\.workbench-data"
)

if defined CODE_BIN (
  set "CODE_EXE=%CODE_BIN%"
) else (
  set "CODE_EXE=%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"
)

if not exist "%CODE_EXE%" (
  echo GeneralStaff Workbench needs Visual Studio Code 1.135 or newer.
  echo Set CODE_BIN to code.cmd and try again.
  exit /b 1
)

if not exist "%RUNTIME_ROOT%\user" mkdir "%RUNTIME_ROOT%\user"
if not exist "%RUNTIME_ROOT%\extensions" mkdir "%RUNTIME_ROOT%\extensions"

if not exist "%EXTENSION_PACKAGE%" (
  echo The packaged Workbench extension is missing.
  echo Run scripts\build-workbench.cmd once, then launch again.
  exit /b 1
)

call "%CODE_EXE%" --user-data-dir "%RUNTIME_ROOT%\user" --extensions-dir "%RUNTIME_ROOT%\extensions" --install-extension "%EXTENSION_PACKAGE%" --force
if errorlevel 1 exit /b 1

start "GeneralStaff Workbench" "%CODE_EXE%" --user-data-dir "%RUNTIME_ROOT%\user" --extensions-dir "%RUNTIME_ROOT%\extensions" --new-window --disable-telemetry --disable-updates --disable-workspace-trust --skip-welcome --skip-release-notes "%REPO_ROOT%\distribution\generalstaff-workbench.code-workspace"
