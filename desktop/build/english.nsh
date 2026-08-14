; NSIS 多语言文件 - 简体中文
; 来源：NSIS 官方 SimplifiedChinese.nsh，略作本地化

!macro LANGFILE_INCLUDE "SimpChinese"
!include "SimpChinese.nsh"
!undef LANGSTRING_NAME
!undef LANGSTRING_INSTALL
!undef LANGSTRING_UNINSTALL
!macroend

LangString ^Name ${LANG_SIMPCHINESE} "${PRODUCT_NAME}"
LangString ^Install ${LANG_SIMPCHINESE} "安装"
LangString ^Uninstall ${LANG_SIMPCHINESE} "卸载"

; MUI 标签本地化
LangString MUI_TEXT_WELCOME_INFO_TITLE ${LANG_SIMPCHINESE} "欢迎使用 $(^NameDA)"
LangString MUI_TEXT_WELCOME_INFO_TEXT ${LANG_SIMPCHINESE} "本向导将引导您完成 $(^NameDA) 的安装。$\r$\n$\r$\n点击「下一步」继续。"
LangString MUI_TEXT_LICENSE_TITLE ${LANG_SIMPCHINESE} "许可协议"
LangString MUI_TEXT_LICENSE_SUBTITLE ${LANG_SIMPCHINESE} "请仔细阅读以下许可协议。"
LangString MUI_TEXT_DIRECTORY_TITLE ${LANG_SIMPCHINESE} "选择安装位置"
LangString MUI_TEXT_DIRECTORY_SUBTITLE ${LANG_SIMPCHINESE} "选择 $(^NameDA) 的安装文件夹。"
LangString MUI_TEXT_INSTALLING_TITLE ${LANG_SIMPCHINESE} "正在安装"
LangString MUI_TEXT_INSTALLING_SUBTITLE ${LANG_SIMPCHINESE} "请稍候，正在安装 $(^NameDA) 到您的电脑。"
LangString MUI_TEXT_FINISH_TITLE ${LANG_SIMPCHINESE} "安装完成"
LangString MUI_TEXT_FINISH_SUBTITLE ${LANG_SIMPCHINESE} "$(^NameDA) 已成功安装。"
LangString MUI_TEXT_ABORTWARNING ${LANG_SIMPCHINESE} "确定要取消 $(^Name) 的安装吗？"
LangString MUI_TEXT_FINISH_INFO_TITLE ${LANG_SIMPCHINESE} "完成 $(^NameDA) 安装向导"
LangString MUI_TEXT_FINISH_INFO_TEXT ${LANG_SIMPCHINESE} "$(^NameDA) 已安装到您的电脑。$\r$\n点击「完成」关闭此向导。"
LangString MUI_TEXT_UNINSTALLER_FINISH_TITLE ${LANG_SIMPCHINESE} "卸载完成"
LangString MUI_TEXT_UNINSTALLER_FINISH_TEXT ${LANG_SIMPCHINESE} "$(^NameDA) 已从您的电脑中移除。"

LangString MUI_INNERTEXT_LICENSE_BOTTOM_CHECKBOX ${LANG_SIMPCHINESE} "我同意上述许可协议条款"
LangString MUI_INNERTEXT_LICENSE_BOTTOM_RADIOBUTTONS ${LANG_SIMPCHINESE} "我同意上述许可协议条款"
LangString MUI_TEXT_STARTMENU_TITLE ${LANG_SIMPCHINESE} "选择开始菜单文件夹"
LangString MUI_TEXT_STARTMENU_SUBTITLE ${LANG_SIMPCHINESE} "选择开始菜单中 $(^NameDA) 快捷方式的文件夹名称。"
LangString MUI_TEXT_STARTMENU_CHECKBOX ${LANG_SIMPCHINESE} "创建开始菜单快捷方式"

LangString MUI_UNTEXT_WELCOME_INFO_TITLE ${LANG_SIMPCHINESE} "欢迎使用 $(^NameDA) 卸载向导"
LangString MUI_UNTEXT_WELCOME_INFO_TEXT ${LANG_SIMPCHINESE} "此向导将引导您完成 $(^NameDA) 的卸载。$\r$\n$\r$\n卸载前请先关闭 $(^NameDA)。$\r$\n$\r$\n点击「下一步」继续。"
