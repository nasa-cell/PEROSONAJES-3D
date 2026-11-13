; Instalador de Baile VRM. Pregunta para quién se instala y en qué carpeta.
Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define NOMBRE "Baile VRM"
!define VERSION "1.2.0"
!define CLAVE "Software\Microsoft\Windows\CurrentVersion\Uninstall\BaileVRM"

Name "${NOMBRE}"
OutFile "${SALIDA}"
InstallDir "$LOCALAPPDATA\Programs\BaileVRM"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${NOMBRE} ${VERSION}"

Var todos
Var radioYo
Var radioTodos

!define MUI_ICON "${ETAPA}\icono.ico"
!define MUI_UNICON "${ETAPA}\icono.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirAlTerminar
!define MUI_FINISHPAGE_RUN_TEXT "Abrir ${NOMBRE}"

Page custom PaginaUsuarios SalirUsuarios
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

!macro CerrarAbierta
  ; Cierra la aplicación, su servidor y su ventana antes de cambiar archivos
  nsExec::Exec '"$WINDIR\Sysnative	askkill.exe" /F /T /IM BaileVRM.exe'
  Pop $0
  Sleep 1000
!macroend

Function .onInit
  StrCpy $todos 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/TODOS" $1
  ${IfNot} ${Errors}
    StrCpy $todos 1
    SetShellVarContext all
    StrCpy $INSTDIR "$PROGRAMFILES64\BaileVRM"
  ${EndIf}
FunctionEnd

Function PaginaUsuarios
  ${If} $todos == 1
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "¿Para quién la instalas?" "Puedes cambiar la carpeta en el paso siguiente."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 10u 100% 14u "Solo para mí (recomendado)"
  Pop $radioYo
  ${NSD_Check} $radioYo
  ${NSD_CreateRadioButton} 0 34u 100% 14u "Para todos los usuarios de este PC (Windows pedirá permiso)"
  Pop $radioTodos
  nsDialogs::Show
FunctionEnd

Function SalirUsuarios
  ${NSD_GetState} $radioTodos $0
  ${If} $0 == ${BST_CHECKED}
    ExecShell "runas" "$EXEPATH" "/TODOS"
    Quit
  ${EndIf}
FunctionEnd

Function AbrirAlTerminar
  ; Con el explorador se abre con el usuario normal, aunque el instalador tenga permisos de administrador
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\BaileVRM.exe"'
FunctionEnd

Section "Baile VRM"
  !insertmacro CerrarAbierta
  SetOutPath "$INSTDIR"
  ; la versión 1.0.0 tenía todo suelto en la carpeta: se quita antes de poner las carpetas nuevas (tus personajes están en otra carpeta y no se tocan)
  Delete "$INSTDIR\index.html"
  Delete "$INSTDIR\programa.js"
  Delete "$INSTDIR\servidor.js"
  Delete "$INSTDIR\llamadas.js"
  Delete "$INSTDIR\personajes.js"
  Delete "$INSTDIR\abrir.js"
  Delete "$INSTDIR\personaje-propio.vrm"
  RMDir /r "$INSTDIR\librerias"
  RMDir /r "$INSTDIR\modelos"
  RMDir /r "$INSTDIR\animaciones"
  RMDir /r "$INSTDIR\ropas"
  File /r "${ETAPA}\*.*"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  CreateShortcut "$DESKTOP\${NOMBRE}.lnk" "$INSTDIR\BaileVRM.exe" "" "$INSTDIR\icono.ico"
  CreateDirectory "$SMPROGRAMS\${NOMBRE}"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\${NOMBRE}.lnk" "$INSTDIR\BaileVRM.exe" "" "$INSTDIR\icono.ico"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  ${If} $todos == 1
    WriteRegStr HKLM "${CLAVE}" "DisplayName" "${NOMBRE}"
    WriteRegStr HKLM "${CLAVE}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKLM "${CLAVE}" "DisplayIcon" "$INSTDIR\icono.ico"
    WriteRegStr HKLM "${CLAVE}" "UninstallString" '"$INSTDIR\Desinstalar.exe" /TODOS'
    WriteRegDWORD HKLM "${CLAVE}" "EstimatedSize" $0
    WriteRegDWORD HKLM "${CLAVE}" "NoModify" 1
    WriteRegDWORD HKLM "${CLAVE}" "NoRepair" 1
  ${Else}
    WriteRegStr HKCU "${CLAVE}" "DisplayName" "${NOMBRE}"
    WriteRegStr HKCU "${CLAVE}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${CLAVE}" "DisplayIcon" "$INSTDIR\icono.ico"
    WriteRegStr HKCU "${CLAVE}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
    WriteRegDWORD HKCU "${CLAVE}" "EstimatedSize" $0
    WriteRegDWORD HKCU "${CLAVE}" "NoModify" 1
    WriteRegDWORD HKCU "${CLAVE}" "NoRepair" 1
  ${EndIf}
SectionEnd

Function un.onInit
  StrCpy $todos 0
  ${un.GetParameters} $0
  ClearErrors
  ${un.GetOptions} $0 "/TODOS" $1
  ${IfNot} ${Errors}
    StrCpy $todos 1
    SetShellVarContext all
    UserInfo::GetAccountType
    Pop $2
    ${If} $2 != "Admin"
      ExecShell "runas" "$EXEPATH" "/TODOS"
      Quit
    ${EndIf}
  ${EndIf}
FunctionEnd

; Los personajes y ajustes del usuario se quedan en su carpeta de datos
Section "Uninstall"
  !insertmacro CerrarAbierta
  Delete "$DESKTOP\${NOMBRE}.lnk"
  RMDir /r "$SMPROGRAMS\${NOMBRE}"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir /r "$INSTDIR"
  ${If} $todos == 1
    DeleteRegKey HKLM "${CLAVE}"
  ${Else}
    DeleteRegKey HKCU "${CLAVE}"
  ${EndIf}
SectionEnd
