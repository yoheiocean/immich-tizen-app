#!/bin/bash
# immich-tizen-app helper. Run on a Linux machine with Docker (or WSL2 with mirrored networking).
#   bash tools/tv.sh build-image   build the Tizen CLI image (Samsung's official installer)
#   bash tools/tv.sh connect       connect to the TV and print what it reports
#   bash tools/tv.sh cert          create the signing certificate + security profile (once)
#   bash tools/tv.sh package       build + sign app/ into dist/ImmichTV.wgt
#   bash tools/tv.sh install       package, install on the TV and launch it
#   bash tools/tv.sh uninstall     remove the app from the TV
# Settings come from .env in the project root (copy .env.example).
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$HERE/.env" ] && set -a && . "$HERE/.env" && set +a

TV_IP=${TV_IP:?set TV_IP in .env (the TV address)}
IMMICH_URL=${IMMICH_URL:?set IMMICH_URL in .env (e.g. http://192.168.1.20:2283)}
IMMICH_KEY_FILE=${IMMICH_KEY_FILE:-$HOME/.secrets/immich-tv-key}
PACKAGE_ID=${PACKAGE_ID:-ImmichTzn1}          # exactly 10 letters/digits
APP_NAME=${APP_NAME:-Immich}
ICON_FROM_SERVER=${ICON_FROM_SERVER:-0}       # 1 = use your Immich server's favicon.png as the app icon
DATA=${TIZEN_DATA:-$HOME/.tizen-data}         # certificate + generated config live here, never in the repo
IMG=immich-tizen-cli
PROFILE=immichtv
APP_ID=$PACKAGE_ID.ImmichTV

[[ "$PACKAGE_ID" =~ ^[A-Za-z0-9]{10}$ ]] || { echo "PACKAGE_ID must be exactly 10 letters/digits"; exit 1; }
mkdir -p "$DATA" "$HERE/dist"

run() {
  docker run --rm --network host \
    -v "$HERE":/work -v "$DATA":/home/tizen/tizen-studio-data \
    -w /work "$IMG" bash -lc "$*"
}

fix_profile() {
  # Without a desktop keyring the CLI can't read its own .pwd files ("Invaild password" when packaging),
  # so the passwords go into profiles.xml directly. The distributor password is the SDK's public default.
  local pw p=$DATA/profile/profiles.xml
  pw=$(cat "$DATA/.cert-password")
  sed -i -E "s#(distributor=\"0\" key=\"[^\"]*\" password=\")[^\"]*#\1$pw#; s#(distributor=\"1\" key=\"[^\"]*\" password=\")[^\"]*#\1tizenpkcs12passfordsigner#" "$p"
  chmod 600 "$p"
}

case "${1:-}" in
  build-image) docker build -t "$IMG" "$HERE/tools" ;;

  connect) run "sdb connect $TV_IP && sdb devices && sdb -s $TV_IP:26101 capability | grep -E 'platform_version|cpu_arch|profile_name'" ;;

  cert)
    [ -s "$DATA/.cert-password" ] || (head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$DATA/.cert-password")
    chmod 600 "$DATA/.cert-password"
    PW=$(cat "$DATA/.cert-password")
    run "tizen certificate -a ImmichTV -p '$PW' -n ImmichTV -f immichtv \
         && tizen security-profiles add -n $PROFILE -a /home/tizen/tizen-studio-data/keystore/author/immichtv.p12 -p '$PW' \
         && tizen security-profiles list"
    fix_profile ;;

  package)
    [ -s "$IMMICH_KEY_FILE" ] || { echo "missing API key file $IMMICH_KEY_FILE"; exit 1; }
    [ -f "$DATA/profile/profiles.xml" ] || { echo "no certificate yet: run 'bash tools/tv.sh cert' first"; exit 1; }
    # Server URL + API key go only into the build copy (js/config.js), never into app/.
    printf 'window.IMMICH_CONFIG = { url: "%s", key: "%s" };\n' "${IMMICH_URL%/}" "$(tr -d ' \n\r' < "$IMMICH_KEY_FILE")" > "$DATA/config.js"
    chmod 600 "$DATA/config.js"
    rm -f "$DATA/icon.png"
    if [ "$ICON_FROM_SERVER" = 1 ]; then
      curl -sf -m 10 "${IMMICH_URL%/}/favicon.png" -o "$DATA/icon.png" || { echo "could not fetch favicon.png, using the default icon"; rm -f "$DATA/icon.png"; }
    fi
    # No `tizen build-web`: in CLI 6.1 it fails with NoClassDefFoundError and it is only an optional minify step.
    run "rm -rf /tmp/b && cp -r app /tmp/b && rm -f /tmp/b/*.wgt \
         && cp /home/tizen/tizen-studio-data/config.js /tmp/b/js/config.js \
         && if [ -f /home/tizen/tizen-studio-data/icon.png ]; then cp /home/tizen/tizen-studio-data/icon.png /tmp/b/icon.png; fi \
         && sed -i -e 's/package=\"[A-Za-z0-9]*\"/package=\"$PACKAGE_ID\"/' -e 's/id=\"[A-Za-z0-9]*\\.ImmichTV\"/id=\"$APP_ID\"/' \
                   -e 's#<name>[^<]*</name>#<name>$APP_NAME</name>#' /tmp/b/config.xml \
         && tizen package -t wgt -s $PROFILE -- /tmp/b \
         && cp /tmp/b/*.wgt /work/dist/ImmichTV.wgt && ls -l /work/dist" ;;

  install)
    bash "$0" package
    run "sdb connect $TV_IP && tizen install -s $TV_IP:26101 -n ImmichTV.wgt -- /work/dist && tizen run -s $TV_IP:26101 -p $APP_ID" ;;

  uninstall) run "sdb connect $TV_IP && tizen uninstall -s $TV_IP:26101 -p $APP_ID" ;;

  *) sed -n 2,10p "$0"; exit 1 ;;
esac
