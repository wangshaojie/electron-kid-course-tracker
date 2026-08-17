; ============================================================
; 一寸光阴 —— 卸载时可选清除本地数据（登录信息/缓存）
;
; 由 electron-builder 自动加载（buildResources 目录下默认的
; installer.nsh），会被 include 进安装器与卸载器两份脚本。
;
; 实现：
;   1. customUnWelcomePage —— 用带复选框的自定义页替换默认卸载
;      欢迎页，复选框"同时删除本地数据"默认不勾选
;   2. customUnInstall     —— 卸载流程末尾，若勾选则删除
;      %APPDATA% 下应用数据目录（登录 token / localStorage）
;
; 静默卸载（/S）自动跳过自定义页，不会删除任何数据。
; ============================================================

!ifdef BUILD_UNINSTALLER

  !include LogicLib.nsh
  !include nsDialogs.nsh

  Var /GLOBAL kidUnDelDataCheckbox
  Var /GLOBAL kidUnDelDataFlag

  !macro customUnWelcomePage
    Function un.KidWelcomePre
      StrCpy $kidUnDelDataFlag "0"
      !insertmacro MUI_HEADER_TEXT "$(^Name) 卸载" "是否同时删除本机数据？"

      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0u 0u 100% 46u "卸载程序将移除「$(^Name)」的安装文件。$\r$\n$\r$\n如需彻底清除本机的登录信息与本地缓存（下次使用需重新登录），请勾选下方选项："
      Pop $0

      ${NSD_CreateCheckBox} 0u 56u 100% 20u "同时删除本地数据（登录信息、缓存等）"
      Pop $kidUnDelDataCheckbox

      nsDialogs::Show
    FunctionEnd

    Function un.KidWelcomeLeave
      ${NSD_GetState} $kidUnDelDataCheckbox $0
      ${If} $0 <> 0
        StrCpy $kidUnDelDataFlag "1"
      ${EndIf}
    FunctionEnd

    PageEx un.custom
      PageCallbacks un.KidWelcomePre un.KidWelcomeLeave
      Caption " "
    PageExEnd
  !macroend

  !macro customUnInstall
    ${If} $kidUnDelDataFlag == "1"
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}
      RMDir /r "$APPDATA\course-tracker"
      RMDir /r "$APPDATA\一寸光阴"
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend

!endif
