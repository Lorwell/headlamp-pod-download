#!/usr/bin/env bash
#
# Install the headlamp-pod-download plugin into an in-cluster Headlamp.
#
# The plugin is shipped as a ConfigMap mounted into Headlamp's plugins
# directory, so no custom image and no extra registry are needed.
#
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

NAMESPACE=${NAMESPACE:-kube-system}
DEPLOYMENT=${DEPLOYMENT:-headlamp}
CONTAINER=${CONTAINER:-headlamp}
SERVICE=${SERVICE:-headlamp}
CONFIGMAP=${CONFIGMAP:-headlamp-pod-download-plugin}
PLUGIN_NAME=${PLUGIN_NAME:-headlamp-pod-download}
PLUGINS_DIR=${PLUGINS_DIR:-/headlamp/plugins}
VOLUME_NAME=${VOLUME_NAME:-headlamp-pod-download}
LOCAL_PORT=${LOCAL_PORT:-14466}
SERVICE_PORT=${SERVICE_PORT:-80}
KUBECTL=${KUBECTL:-kubectl}
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: deploy/install.sh [options]

Options:
  -n, --namespace <ns>     Namespace of the Headlamp deployment (default: kube-system)
      --deployment <name>  Deployment name (default: headlamp)
      --container <name>   Container name inside the pod (default: headlamp)
      --service <name>     Service used for the verification port-forward (default: headlamp)
      --configmap <name>   ConfigMap name (default: headlamp-pod-download-plugin)
      --plugin-name <name> Plugin folder name (default: headlamp-pod-download)
      --plugins-dir <dir>  Headlamp -plugins-dir (default: /headlamp/plugins)
      --dry-run            Print the changes instead of applying them
  -h, --help               Show this help

Environment:
  KUBECTL   kubectl command to use, e.g. KUBECTL="k3s kubectl"

The plugin bundle must exist first: pnpm install && pnpm build
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n | --namespace)
      NAMESPACE=$2
      shift 2
      ;;
    --deployment)
      DEPLOYMENT=$2
      shift 2
      ;;
    --container)
      CONTAINER=$2
      shift 2
      ;;
    --service)
      SERVICE=$2
      shift 2
      ;;
    --configmap)
      CONFIGMAP=$2
      shift 2
      ;;
    --plugin-name)
      PLUGIN_NAME=$2
      shift 2
      ;;
    --plugins-dir)
      PLUGINS_DIR=$2
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

MAIN_JS="$ROOT_DIR/dist/main.js"
PKG_JSON="$ROOT_DIR/package.json"

[[ -f "$MAIN_JS" ]] || {
  echo "missing $MAIN_JS - run: pnpm install && pnpm build" >&2
  exit 2
}
[[ -f "$PKG_JSON" ]] || {
  echo "missing $PKG_JSON" >&2
  exit 2
}

run() {
  if [[ "$DRY_RUN" == true ]]; then
    printf '+ %s\n' "$*"
  else
    "$@"
  fi
}

LOCALES=()
for translation in "$ROOT_DIR"/locales/*/translation.json; do
  [[ -f "$translation" ]] || continue
  locale=$(basename "$(dirname "$translation")")
  LOCALES+=("--from-file=$locale.translation.json=$translation")
done

CONFIGMAP_MANIFEST=$(
  $KUBECTL -n "$NAMESPACE" create configmap "$CONFIGMAP" \
    --from-file="main.js=$MAIN_JS" \
    --from-file="package.json=$PKG_JSON" \
    ${LOCALES[@]+"${LOCALES[@]}"} \
    --dry-run=client -o yaml
)

ITEMS='{"key":"main.js","path":"main.js"},{"key":"package.json","path":"package.json"}'
for translation in "$ROOT_DIR"/locales/*/translation.json; do
  [[ -f "$translation" ]] || continue
  locale=$(basename "$(dirname "$translation")")
  ITEMS="$ITEMS"',{"key":"'"$locale"'.translation.json","path":"locales/'"$locale"'/translation.json"}'
done

PATCH=$(
  cat <<EOF
{
  "spec": {
    "template": {
      "spec": {
        "volumes": [
          {"name": "$VOLUME_NAME", "configMap": {"name": "$CONFIGMAP", "items": [$ITEMS]}}
        ],
        "containers": [
          {
            "name": "$CONTAINER",
            "volumeMounts": [
              {"name": "$VOLUME_NAME", "mountPath": "$PLUGINS_DIR/$PLUGIN_NAME", "readOnly": true}
            ]
          }
        ]
      }
    }
  }
}
EOF
)

if [[ "$DRY_RUN" == true ]]; then
  echo "--- ConfigMap $NAMESPACE/$CONFIGMAP"
  echo "$CONFIGMAP_MANIFEST"
  echo "--- Deployment patch $NAMESPACE/$DEPLOYMENT"
  echo "$PATCH"
  exit 0
fi

echo "Applying ConfigMap $NAMESPACE/$CONFIGMAP"
printf '%s\n' "$CONFIGMAP_MANIFEST" | $KUBECTL apply -f -

echo "Patching deployment $NAMESPACE/$DEPLOYMENT"
$KUBECTL -n "$NAMESPACE" patch deployment "$DEPLOYMENT" --type=strategic -p "$PATCH"

if ! $KUBECTL -n "$NAMESPACE" rollout status "deployment/$DEPLOYMENT" --timeout=10m; then
  echo "rollout failed, rolling back" >&2
  $KUBECTL -n "$NAMESPACE" rollout undo "deployment/$DEPLOYMENT" || true
  $KUBECTL -n "$NAMESPACE" logs "deployment/$DEPLOYMENT" --tail=50 || true
  exit 1
fi

echo "Verifying that Headlamp serves the plugin"
PF_LOG=$(mktemp)
$KUBECTL -n "$NAMESPACE" port-forward "svc/$SERVICE" "$LOCAL_PORT:$SERVICE_PORT" >"$PF_LOG" 2>&1 &
PF_PID=$!
cleanup() {
  kill "$PF_PID" 2>/dev/null || true
  rm -f "$PF_LOG"
}
trap cleanup EXIT

FOUND=false
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$LOCAL_PORT/plugins" 2>/dev/null | grep -q "\"$PLUGIN_NAME\""; then
    FOUND=true
    break
  fi
  sleep 1
done

if [[ "$FOUND" != true ]]; then
  echo "plugin $PLUGIN_NAME was not listed by GET /plugins" >&2
  echo "port-forward log:" >&2
  cat "$PF_LOG" >&2 || true
  exit 1
fi

CODE=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$LOCAL_PORT/plugins/$PLUGIN_NAME/main.js" || true)
if [[ "$CODE" != "200" ]]; then
  echo "GET /plugins/$PLUGIN_NAME/main.js returned $CODE" >&2
  exit 1
fi

cat <<EOF

Done.

  Plugin : $PLUGIN_NAME
  Served : http://127.0.0.1:$LOCAL_PORT/plugins/$PLUGIN_NAME/main.js (200)
  Usage  : open a Pod details page and click the download icon next to the terminal icon

Notes:
  - Changes to the ConfigMap (plugin or locales) need a Headlamp restart
    (kubectl -n $NAMESPACE rollout restart deployment/$DEPLOYMENT).
  - To remove the plugin: deploy/uninstall.sh -n $NAMESPACE
EOF
