; Native pages for the approved EchoTest white installer.
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!define MUI_UI "${INSTALLER_UI_ROOT}\echo-setup-ui.exe"
!define MUI_ICON "${PROJECT_ROOT}\electron\assets\studio.ico"
!define MUI_UNICON "${PROJECT_ROOT}\electron\assets\studio.ico"
!define MUI_BGCOLOR FFFFFF
!define MUI_TEXTCOLOR 232428
!define MUI_INSTFILESPAGE_COLORS "232428 FFFFFF"
!define MUI_CUSTOMFUNCTION_GUIINIT SetupGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.SetupGuiInit
!define MUI_CUSTOMFUNCTION_ABORT SetupCancel

Var UiPage
Var UiDpi
Var UiX
Var UiY
Var UiW
Var UiH
Var UiBodyFont
Var UiTitleFont
Var UiLibrary
Var UiAttach
Var UiStep
Var UiProgress
Var UiStage
Var UiDirectory
Var UiDirectoryError
Var UiDesktop
Var UiLaunch
Var DesktopChoice
Var LaunchChoice

!macro SetupStage STAGE
  ${IfNot} ${Silent}
    System::Call '::$UiStage(i ${STAGE}) ?c'
  ${EndIf}
!macroend

!macro SetupScale X Y W H
  IntOp $UiX ${X} * $UiDpi
  IntOp $UiX $UiX / 96
  IntOp $UiY ${Y} * $UiDpi
  IntOp $UiY $UiY / 96
  IntOp $UiW ${W} * $UiDpi
  IntOp $UiW $UiW / 96
  IntOp $UiH ${H} * $UiDpi
  IntOp $UiH $UiH / 96
!macroend

!macro SetupControl TYPE X Y W H TEXT RESULT
  !insertmacro SetupScale ${X} ${Y} ${W} ${H}
  ${NSD_Create${TYPE}} $UiX $UiY $UiW $UiH "${TEXT}"
  Pop ${RESULT}
  SetCtlColors ${RESULT} 232428 FFFFFF
  SendMessage ${RESULT} ${WM_SETFONT} $UiBodyFont 0
!macroend

!macro SetupLabel X Y W H TEXT COLOR FONT
  !insertmacro SetupControl Label ${X} ${Y} ${W} ${H} "${TEXT}" $0
  SetCtlColors $0 ${COLOR} FFFFFF
  SendMessage $0 ${WM_SETFONT} ${FONT} 0
!macroend

!macro SetupNativeInit PREFIX UNINSTALL
Function ${PREFIX}SetupGuiInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\echo-setup-ui.dll "${INSTALLER_UI_ROOT}\echo-setup-ui.dll"
  File /oname=$PLUGINSDIR\studio.ico "${INSTALLER_UI_ROOT}\echo-setup-mark.ico"
  System::Call 'kernel32::LoadLibraryW(w "$PLUGINSDIR\echo-setup-ui.dll") p.s'
  Pop $UiLibrary
  ${If} $UiLibrary == 0
    MessageBox MB_ICONSTOP "无法加载安装界面，请重新下载安装包。"
    Quit
  ${EndIf}
  System::Call 'kernel32::GetProcAddress(p $UiLibrary, m "EchoSetupAttach") p.s'
  Pop $UiAttach
  System::Call 'kernel32::GetProcAddress(p $UiLibrary, m "EchoSetupStep") p.s'
  Pop $UiStep
  System::Call 'kernel32::GetProcAddress(p $UiLibrary, m "EchoSetupProgress") p.s'
  Pop $UiProgress
  System::Call 'kernel32::GetProcAddress(p $UiLibrary, m "EchoSetupStage") p.s'
  Pop $UiStage
  System::Call '::$UiAttach(p $HWNDPARENT, w "$PLUGINSDIR\studio.ico", w "${PRODUCT_VERSION}", i ${UNINSTALL}) i.r0 ?c'
  ${If} $0 == 0
    MessageBox MB_ICONSTOP "无法初始化安装界面。"
    Quit
  ${EndIf}
  ; GetDpiForWindow was added in Windows 10 1607. Earlier Windows 10
  ; versions still use the device DPI, matching native.c's fallback.
  System::Call 'kernel32::GetModuleHandleW(w "user32.dll") p.r0'
  System::Call 'kernel32::GetProcAddress(p r0, m "GetDpiForWindow") p.r1'
  ${If} $1 != 0
    System::Call '::$1(p $HWNDPARENT) i.s'
    Pop $UiDpi
  ${Else}
    System::Call 'user32::GetDC(p $HWNDPARENT) p.r0'
    System::Call 'gdi32::GetDeviceCaps(p r0, i 88) i.s'
    Pop $UiDpi
    System::Call 'user32::ReleaseDC(p $HWNDPARENT, p r0)'
  ${EndIf}
  ${If} $UiDpi == 0
    StrCpy $UiDpi 96
  ${EndIf}
  CreateFont $UiBodyFont "Microsoft YaHei UI" 10 400
  CreateFont $UiTitleFont "Microsoft YaHei UI" 18 700
  SetCtlColors $HWNDPARENT 232428 FFFFFF
FunctionEnd
!macroend
!insertmacro SetupNativeInit "" 0
!insertmacro SetupNativeInit "un." 1

Function SetupCreatePage
  nsDialogs::Create 1018
  Pop $UiPage
  ${If} $UiPage == error
    MessageBox MB_ICONSTOP "无法创建安装页面。"
    Quit
  ${EndIf}
  SetCtlColors $UiPage 232428 FFFFFF
  GetDlgItem $0 $HWNDPARENT 2
  ${NSD_SetText} $0 "取消"
FunctionEnd

Function SetupWelcome
  Call SetupCreatePage
  System::Call '::$UiStep(i 0) ?c'
  !insertmacro SetupLabel 38 30 660 18 "ECHOTEST / SETUP" 737680 $UiBodyFont
  !insertmacro SetupLabel 38 61 660 40 "欢迎使用 EchoTest" 232428 $UiTitleFont
  !insertmacro SetupLabel 38 111 660 52 "将重复操作，交给自动化。$\r$\n安装桌面自动化测试工作台，开始录制、编排和运行你的测试。" 737680 $UiBodyFont
  !insertmacro SetupLabel 38 181 660 24 "操作录制     ·     低代码编排     ·     Python 脚本" 555C68 $UiBodyFont
  !insertmacro SetupControl Label 38 222 660 101 "" $0
  SetCtlColors $0 626671 FAFAFB
  !insertmacro SetupLabel 55 235 625 20 "安装前，了解这两件事" 444954 $UiBodyFont
  SetCtlColors $0 444954 FAFAFB
  !insertmacro SetupLabel 55 261 625 51 "已包含 Node.js、Python 和 OCR 运行环境，无需另行配置。$\r$\n升级前请保存工作并关闭 EchoTest，已有用例和控件会保留。" 626671 $UiBodyFont
  SetCtlColors $0 626671 FAFAFB
  !insertmacro SetupLabel 38 344 660 22 "Windows 10 及以上 · 64 位" 737680 $UiBodyFont
  GetDlgItem $0 $HWNDPARENT 1
  ${NSD_SetText} $0 "下一步"
  nsDialogs::Show
FunctionEnd

Function SetupOptions
  Call SetupCreatePage
  System::Call '::$UiStep(i 1) ?c'
  !insertmacro SetupLabel 38 30 660 18 "INSTALLATION OPTIONS" 737680 $UiBodyFont
  !insertmacro SetupLabel 38 61 660 40 "准备好你的工作台" 232428 $UiTitleFont
  !insertmacro SetupLabel 38 110 660 24 "选择安装位置和启动选项。" 737680 $UiBodyFont
  !insertmacro SetupLabel 38 151 660 22 "安装位置" 444954 $UiBodyFont
  !insertmacro SetupControl DirRequest 38 179 560 35 "$INSTDIR" $UiDirectory
  !insertmacro SetupControl Button 610 179 88 35 "更改…" $0
  ${NSD_OnClick} $0 SetupBrowse
  !insertmacro SetupLabel 38 222 660 22 "安装给当前用户 · 已包含完整离线运行环境" 737680 $UiBodyFont
  !insertmacro SetupControl Label 38 246 660 22 "" $UiDirectoryError
  SetCtlColors $UiDirectoryError BC4353 FFFFFF
  !insertmacro SetupControl Checkbox 38 282 660 24 "创建桌面快捷方式" $UiDesktop
  ${NSD_SetState} $UiDesktop $DesktopChoice
  ${NSD_OnBack} SetupRememberOptions
  ${If} $NoShortcuts == 1
    EnableWindow $UiDesktop 0
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1
  ${NSD_SetText} $0 "开始安装"
  GetDlgItem $0 $HWNDPARENT 3
  ${NSD_SetText} $0 "上一步"
  nsDialogs::Show
FunctionEnd

Function SetupBrowse
  Pop $0
  ${NSD_GetText} $UiDirectory $0
  nsDialogs::SelectFolderDialog "选择 EchoTest 安装位置" "$0"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $UiDirectory $0
    ${NSD_SetText} $UiDirectoryError ""
  ${EndIf}
FunctionEnd

Function SetupRememberOptions
  ${NSD_GetText} $UiDirectory $INSTDIR
  ${NSD_GetState} $UiDesktop $DesktopChoice
FunctionEnd

Function SetupOptionsLeave
  Call SetupRememberOptions
  Call SetupValidateDirectory
  Pop $0
  ${If} $0 != 1
    ${NSD_SetText} $UiDirectoryError "请输入有效的安装文件夹。"
    SendMessage $UiDirectory ${EM_SETSEL} 0 -1
    ${NSD_SetFocus} $UiDirectory
    Abort
  ${EndIf}
FunctionEnd

; One validation path is used by both interactive and silent installation.
Function SetupValidateDirectory
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $2 0
  ${If} $INSTDIR != ""
    StrCpy $1 $INSTDIR 2
    ${If} $1 != "\\"
      StrCpy $1 $INSTDIR 1 1
      ${If} $1 != ":"
        Goto directory_checked
      ${EndIf}
      StrCpy $1 $INSTDIR 1 2
      ${If} $1 != "\"
      ${AndIf} $1 != "/"
        Goto directory_checked
      ${EndIf}
    ${EndIf}
    StrCpy $3 0
    directory_char:
      StrCpy $1 $INSTDIR 1 $3
      ${If} $1 == ""
        Goto directory_chars_done
      ${EndIf}
      ${If} $1 == "<"
      ${OrIf} $1 == ">"
      ${OrIf} $1 == '$\"'
      ${OrIf} $1 == "|"
      ${OrIf} $1 == "?"
      ${OrIf} $1 == "*"
        Goto directory_checked
      ${EndIf}
      ${If} $1 == ":"
      ${AndIf} $3 != 1
        Goto directory_checked
      ${EndIf}
      IntOp $3 $3 + 1
      Goto directory_char
    directory_chars_done:
    System::Call 'shlwapi::PathIsRelativeW(w "$INSTDIR") i.r1'
    ${If} $1 == 0
      ; NSIS GetFullPathName clears its result for a folder that does not yet
      ; exist. The Win32 API normalizes a fresh installation path as well.
      System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r4, p 0) i.r1'
      ${If} $1 == 0
      ${OrIf} $1 >= ${NSIS_MAX_STRLEN}
        Goto directory_checked
      ${EndIf}
      StrCpy $INSTDIR $4
      ${GetRoot} "$INSTDIR" $1
      ${If} $INSTDIR != "$1"
      ${AndIf} $INSTDIR != "$1\"
        StrLen $1 $WINDIR
        StrCpy $1 $INSTDIR $1
        ${If} $1 != $WINDIR
          StrCpy $2 1
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  directory_checked:
  StrCpy $0 $2
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Push $0
FunctionEnd

Function SetupProgressShow
  System::Call '::$UiStep(i 2) ?c'
  GetDlgItem $0 $HWNDPARENT 1
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  FindWindow $0 "#32770" "" $HWNDPARENT
  System::Call '::$UiProgress(p r0) ?c'
  GetDlgItem $1 $0 3304
  ${NSD_SetText} $1 "$INSTDIR"
FunctionEnd

Function un.SetupProgressShow
  System::Call '::$UiStep(i 2) ?c'
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  FindWindow $0 "#32770" "" $HWNDPARENT
  System::Call '::$UiProgress(p r0) ?c'
  GetDlgItem $1 $0 3304
  ${NSD_SetText} $1 "$INSTDIR"
FunctionEnd

Function SetupFinish
  System::Call '::$UiStep(i 3) ?c'
  Call SetupCreatePage
  !insertmacro SetupLabel 38 30 660 18 "ALL SET" 737680 $UiBodyFont
  !insertmacro SetupLabel 38 68 660 40 "一切就绪，开始测试" 232428 $UiTitleFont
  !insertmacro SetupLabel 38 126 660 53 "EchoTest ${PRODUCT_VERSION} 已准备就绪。$\r$\n从录制一个操作开始，构建你的第一个自动化用例。" 737680 $UiBodyFont
  !insertmacro SetupLabel 38 213 660 20 "安装位置" 737680 $UiBodyFont
  !insertmacro SetupLabel 38 240 660 40 "$INSTDIR" 444954 $UiBodyFont
  !insertmacro SetupControl Checkbox 38 310 660 25 "完成后启动 EchoTest" $UiLaunch
  ${NSD_SetState} $UiLaunch $LaunchChoice
  ${If} $TestInstall == 1
    ${NSD_Uncheck} $UiLaunch
    EnableWindow $UiLaunch 0
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1
  ${NSD_SetText} $0 "完成"
  ShowWindow $0 ${SW_SHOW}
  EnableWindow $0 1
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_HIDE}
  nsDialogs::Show
FunctionEnd

Function SetupFinishLeave
  ${NSD_GetState} $UiLaunch $LaunchChoice
  ${If} $LaunchChoice == ${BST_CHECKED}
  ${AndIf} $TestInstall != 1
    Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\start-studio.ps1"'
  ${EndIf}
FunctionEnd

Function SetupCancel
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "确定退出安装向导？" IDYES quit
  Abort
  quit:
FunctionEnd

Function .onGUIEnd
  System::Call 'gdi32::DeleteObject(p $UiBodyFont)'
  System::Call 'gdi32::DeleteObject(p $UiTitleFont)'
FunctionEnd

Function un.onGUIEnd
  System::Call 'gdi32::DeleteObject(p $UiBodyFont)'
  System::Call 'gdi32::DeleteObject(p $UiTitleFont)'
FunctionEnd
