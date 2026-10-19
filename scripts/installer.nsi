Unicode true
RequestExecutionLevel user
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!define APP_NAME "echo test"
!define APP_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\EchoTest"
Name "${APP_NAME} ${PRODUCT_VERSION}"
OutFile "${OUTPUT_EXE}"
InstallDir "$LOCALAPPDATA\Programs\echo test"
InstallDirRegKey HKCU "${APP_KEY}" "InstallLocation"
SetCompressor /SOLID lzma
SetCompressorDictSize 32
ShowInstDetails show
ShowUninstDetails show
Icon "${PROJECT_ROOT}\electron\assets\studio.ico"
UninstallIcon "${PROJECT_ROOT}\electron\assets\studio.ico"
VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME}安装程序"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "LegalCopyright" ""

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "安装工作台及其离线运行环境。无需另行安装 Node.js 或 Python。$\r$\n$\r$\n默认仅安装给当前用户，请选择可写目录。升级前请保存用例并正常关闭工作台。"
!define MUI_FINISHPAGE_TEXT "安装完成。可以从桌面或开始菜单启动工作台。$\r$\n$\r$\n工作台默认请求管理员权限，请确认 Windows 权限提示。缺少微软运行库时，首次启动会使用包内安装器补齐。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Var RegistryKey
Var TestInstall
Var NoShortcuts

Function .onInit
  SetShellVarContext current
  SetRegView 64
  StrCpy $RegistryKey "${APP_KEY}"
  StrCpy $TestInstall "0"
  StrCpy $NoShortcuts "0"
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "此安装包需要 64 位 Windows。"
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "此安装包需要 Windows 10 或更新版本。"
    Abort
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/TESTINSTALL" $1
  ${IfNot} ${Errors}
    StrCpy $TestInstall "1"
    StrCpy $RegistryKey "${APP_KEY}-InstallerTest"
  ${EndIf}
  ClearErrors
  ${GetOptions} $0 "/NOSHORTCUTS" $1
  ${IfNot} ${Errors}
    StrCpy $NoShortcuts "1"
  ${EndIf}
FunctionEnd

Section "工作台及离线运行环境（必需）" Core
  SectionIn RO
  IfFileExists "$INSTDIR\runtime\python\python.exe" 0 idle_checked
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=installer-guard.py "${PROJECT_ROOT}\scripts\installer-guard.py"
  nsExec::ExecToStack '"$INSTDIR\runtime\python\python.exe" -X utf8 "$PLUGINSDIR\installer-guard.py" "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    MessageBox MB_ICONSTOP "请先保存用例并正常关闭此安装目录中的工作台，再重新安装。"
    SetErrorLevel 2
    Abort
  ${EndIf}
  idle_checked:
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r /x "test_cases" /x "projects" /x "control_library" /x "__pycache__" /x "*.pyc" "${PAYLOAD_ROOT}\*"
  ; Seed empty workspace metadata only once; upgrades keep user-created cases and controls.
  SetOverwrite off
  SetOutPath "$INSTDIR\test_cases"
  File /r /x "__pycache__" /x "*.pyc" "${PAYLOAD_ROOT}\test_cases\*"
  !if /FileExists "${PAYLOAD_ROOT}\control_library\controls.json"
    SetOutPath "$INSTDIR\control_library"
    File /r /x "__pycache__" /x "*.pyc" "${PAYLOAD_ROOT}\control_library\*"
  !endif
  SetOutPath "$INSTDIR\projects"
  File /r /x "__pycache__" /x "*.pyc" "${PAYLOAD_ROOT}\projects\*"
  SetOverwrite on
  SetOutPath "$INSTDIR"
  WriteINIStr "$INSTDIR\echo-test-install.ini" "Installer" "AppId" "EchoTest"
  WriteINIStr "$INSTDIR\echo-test-install.ini" "Installer" "TestInstall" "$TestInstall"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "$RegistryKey" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "$RegistryKey" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "$RegistryKey" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "$RegistryKey" "DisplayIcon" "$INSTDIR\electron\assets\studio.ico"
  WriteRegStr HKCU "$RegistryKey" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "$RegistryKey" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "$RegistryKey" "NoModify" 1
  WriteRegDWORD HKCU "$RegistryKey" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "$RegistryKey" "EstimatedSize" $0
  ${If} $NoShortcuts != "1"
    CreateDirectory "$SMPROGRAMS\${APP_NAME}"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\start-studio.ps1" -Admin' "$INSTDIR\electron\assets\studio.ico"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}\管理员启动.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\start-studio.ps1" -Admin' "$INSTDIR\electron\assets\studio.ico"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}\MCP 管理员启动.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\start-studio.ps1" -Admin -Mcp' "$INSTDIR\electron\assets\studio.ico"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载.lnk" "$INSTDIR\Uninstall.exe"
  ${EndIf}
SectionEnd

Section "桌面快捷方式" Desktop
  ${If} $NoShortcuts != "1"
    SetOutPath "$INSTDIR"
    CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\start-studio.ps1" -Admin' "$INSTDIR\electron\assets\studio.ico"
  ${EndIf}
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  ReadINIStr $0 "$INSTDIR\echo-test-install.ini" "Installer" "AppId"
  ${If} $0 != "EchoTest"
    MessageBox MB_ICONSTOP "安装目录标识无效，已停止卸载。"
    Abort
  ${EndIf}
  StrCpy $RegistryKey "${APP_KEY}"
  ReadINIStr $TestInstall "$INSTDIR\echo-test-install.ini" "Installer" "TestInstall"
  ${If} $TestInstall == "1"
    StrCpy $RegistryKey "${APP_KEY}-InstallerTest"
  ${EndIf}
  nsExec::ExecToStack '"$INSTDIR\runtime\python\python.exe" -X utf8 "$INSTDIR\scripts\installer-guard.py" "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    MessageBox MB_ICONSTOP "请先保存用例并正常关闭工作台，再卸载。"
    Abort
  ${EndIf}
FunctionEnd

Section "Uninstall"
  ; Remove program code only. Keep control_library, test_cases, projects, reports and recordings.
  RMDir /r "$INSTDIR\electron"
  RMDir /r "$INSTDIR\echo_test"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\scripts"
  RMDir /r "$INSTDIR\docs"
  RMDir /r "$INSTDIR\tests"
  Delete "$INSTDIR\app.py"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\PORTABLE-README.txt"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\package-lock.json"
  Delete "$INSTDIR\requirements.txt"
  Delete "$INSTDIR\requirements-portable.lock"
  Delete "$INSTDIR\start.cmd"
  Delete "$INSTDIR\start_admin.cmd"
  Delete "$INSTDIR\start_admin_mcp.cmd"
  Delete "$INSTDIR\start_no_mcp.cmd"
  Delete "$INSTDIR\install_dependencies.cmd"
  Delete "$INSTDIR\build_portable.cmd"
  Delete "$INSTDIR\verify_portable.cmd"
  Delete "$INSTDIR\mcp_info.cmd"
  Delete "$INSTDIR\echo-test-install.ini"
  Delete "$INSTDIR\Uninstall.exe"
  DeleteRegKey HKCU "$RegistryKey"
  ${If} $TestInstall != "1"
    Delete "$DESKTOP\${APP_NAME}.lnk"
    RMDir /r "$SMPROGRAMS\${APP_NAME}"
  ${EndIf}
  RMDir "$INSTDIR"
SectionEnd
