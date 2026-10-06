#!/bin/bash
# Lo mismo que hace la plantilla de electron-builder: quitar el enlace al ejecutable
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove 'frontera-eficiente' '/opt/Frontera Eficiente/frontera-eficiente' || true
else
    rm -f '/usr/bin/frontera-eficiente'
fi
rm -f '/etc/apparmor.d/frontera-eficiente'

# Al desinstalar (no al actualizar) se borra todo lo que la app guardó para cada usuario:
# datos de la app, caché, biblioteca local y el inicio automático.
case "$1" in
  remove|purge)
    for h in /home/* /root; do
      [ -d "$h" ] || continue
      rm -rf "$h/.config/Frontera Eficiente" "$h/.config/frontera-eficiente" \
             "$h/.cache/Frontera Eficiente" "$h/.cache/frontera-eficiente" \
             "$h/Documents/Frontera Eficiente" "$h/Documentos/Frontera Eficiente" \
             "$h/.config/autostart/frontera-eficiente.desktop" "$h/.config/autostart/Frontera Eficiente.desktop"
    done
    ;;
esac
exit 0
