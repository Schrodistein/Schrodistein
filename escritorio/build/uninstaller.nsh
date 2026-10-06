; Al desinstalar Frontera Eficiente se borra todo lo que la app guardó en el equipo:
; la biblioteca local (Documentos\Frontera Eficiente) y el inicio automático con Windows.
; Los datos de la app (%APPDATA%\Frontera Eficiente) los borra electron-builder con
; deleteAppDataOnUninstall. Nada de esto se ejecuta al actualizar a una versión nueva.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    SetShellVarContext current
    RMDir /r "$DOCUMENTS\Frontera Eficiente"
    RMDir /r "$APPDATA\Frontera Eficiente"
    RMDir /r "$APPDATA\frontera-eficiente"
    RMDir /r "$LOCALAPPDATA\frontera-eficiente-updater"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Frontera Eficiente"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "co.schrodistein.fronteraeficiente"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Frontera Eficiente"
  ${endIf}
!macroend
