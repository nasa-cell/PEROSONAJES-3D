#!/bin/sh
# Arma la aplicación y su instalador. Uso: sh aplicacion/compilar.sh
set -e
PROYECTO="$(cd "$(dirname "$0")/.." && pwd)"
COMP=/c/herramientas/compilacion/baile-vrm
ETAPA="$COMP/etapa"
NSIS="$COMP/descargas/nsis/x/nsis-3.11/makensis.exe"
CSC=/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe
FF=/c/herramientas/ffmpeg/bin/ffmpeg.exe
VERSION=1.1.0
SALIDA="$PROYECTO/pc instalador"

rm -rf "$ETAPA"; mkdir -p "$ETAPA" "$SALIDA"
cd "$PROYECTO"
# PUBLICO=1: versión para compartir. Sin las animaciones de VRoid (su licencia no deja repartirlas sueltas)
# ni la zorrita AvatarSample_F (no se puede redistribuir). La versión normal es la de este PC.
mkdir -p "$ETAPA/pagina"
cp -r servidor "$ETAPA/"
cp pagina/index.html pagina/programa.js pagina/prueba.vrm "$ETAPA/pagina/"
cp -r pagina/librerias pagina/modelos pagina/ropas pagina/personajes-incluidos "$ETAPA/pagina/"
if [ "$PUBLICO" != "1" ]; then
  cp -r pagina/animaciones "$ETAPA/pagina/"
  cp "$PROYECTO/../filo.vrm" "$ETAPA/pagina/personaje-propio.vrm"
fi
cp "$(command -v node)" "$ETAPA/node.exe"

# Icono: la cara del personaje
"$FF" -hide_banner -v error -y -i aplicacion/cara.png -vf "scale=256:256" "$ETAPA/icono.ico"

cd "$ETAPA"
"$CSC" -nologo -target:winexe -win32icon:icono.ico -r:System.Windows.Forms.dll -out:BaileVRM.exe "$(cygpath -w "$PROYECTO/aplicacion/lanzador.cs")"

NOMBRE="Instalar Baile VRM $VERSION.exe"; [ "$PUBLICO" = "1" ] && NOMBRE="Instalar Personajes 3D $VERSION.exe"
rm -f "$SALIDA/$NOMBRE"
"$NSIS" -V2 -DETAPA="$(cygpath -w "$ETAPA")" -DSALIDA="$(cygpath -w "$SALIDA/$NOMBRE")" "$(cygpath -w "$PROYECTO/aplicacion/instalador.nsi")"
ls -la "$SALIDA"
