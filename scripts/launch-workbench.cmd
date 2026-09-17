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

copy /Y "%REPO_ROOT%\distribution\generalstaff-workbench.code-workspace" "%RUNTIME_ROOT%\generalstaff-workbench.code-workspace" >nul

rem Local shortcut uses the existing GS folio mark. The running Code host
rem still owns the taskbar glyph of code.exe.
if exist "%REPO_ROOT%\src-tauri\icons\icon.ico" (
  copy /Y "%REPO_ROOT%\src-tauri\icons\icon.ico" "%RUNTIME_ROOT%\workbench-icon.ico" >nul
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$root = [IO.Path]::GetFullPath('%RUNTIME_ROOT%'); $code = [IO.Path]::GetFullPath('%CODE_EXE%'); $ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut((Join-Path $root 'GeneralStaff Workbench.lnk')); $lnk.TargetPath = $code; $lnk.Arguments = '--user-data-dir \"' + (Join-Path $root 'user') + '\" --extensions-dir \"' + (Join-Path $root 'extensions') + '\" --new-window --disable-telemetry --disable-updates --disable-workspace-trust --skip-welcome --skip-release-notes \"' + (Join-Path $root 'generalstaff-workbench.code-workspace') + '\"'; $lnk.WorkingDirectory = $root; $lnk.IconLocation = (Join-Path $root 'workbench-icon.ico'); $lnk.Description = 'GeneralStaff Workbench'; $lnk.Save()" >nul 2>&1
)

if not exist "%EXTENSION_PACKAGE%" (
  echo The packaged Workbench extension is missing.
  echo Run scripts\build-workbench.cmd once, then launch again.
  exit /b 1
)

call "%CODE_EXE%" --user-data-dir "%RUNTIME_ROOT%\user" --extensions-dir "%RUNTIME_ROOT%\extensions" --install-extension "%EXTENSION_PACKAGE%" --force
if errorlevel 1 exit /b 1

start "GeneralStaff Workbench" "%CODE_EXE%" --user-data-dir "%RUNTIME_ROOT%\user" --extensions-dir "%RUNTIME_ROOT%\extensions" --new-window --disable-telemetry --disable-updates --disable-workspace-trust --skip-welcome --skip-release-notes "%RUNTIME_ROOT%\generalstaff-workbench.code-workspace"
