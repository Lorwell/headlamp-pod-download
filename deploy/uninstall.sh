#!/usr/bin/env bash
#
# Remove the headlamp-pod-download plugin from an in-cluster Headlamp.
#
set -Eeuo pipefail

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
Usage: deploy/uninstall.sh [options]

Options:
  -n, --namespace <ns>     Namespace of the Headlamp deployment (default: kube-system)
      --deployment <name>  Deployment name (default: headlamp)
      --container <name>   Container name inside the pod (default: headlamp)
      --service <name>     Service used for the verification port-forward (default: headlamp)
      --configmap <name>   ConfigMap name (default: headlamp-pod-download-plugin)
      --plugin-name <name> Plugin folder name (default: headlamp-pod-download)
      --dry-run            Print the changes instead of applying them
  -h, --help               Show this help

Environment:
  KUBECTL   kubectl command to use, e.g. KUBECTL="k3s kubectl"
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

PATCH=$(
  cat <<EOF
{
  "spec": {
    "template": {
      "spec": {
        "volumes": [
          {"name": "$VOLUME_NAME", "\$patch": "delete"}
        ],
        "containers": [
          {
            "name": "$CONTAINER",
            "volumeMounts": [
              {"mountPath": "$PLUGINS_DIR/$PLUGIN_NAME", "\$patch": "delete"}
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
  echo "--- Deployment patch $NAMESPACE/$DEPLOYMENT"
  echo "$PATCH"
  echo "--- kubectl -n $NAMESPACE delete configmap $CONFIGMAP --ignore-not-found"
  exit 0
fi

echo "Removing plugin mount and volume from $NAMESPACE/$DEPLOYMENT"
$KUBECTL -n "$NAMESPACE" patch deployment "$DEPLOYMENT" --type=strategic -p "$PATCH"

echo "Deleting ConfigMap $NAMESPACE/$CONFIGMAP"
$KUBECTL -n "$NAMESPACE" delete configmap "$CONFIGMAP" --ignore-not-found

$KUBECTL -n "$NAMESPACE" rollout status "deployment/$DEPLOYMENT" --timeout=10m

echo "Verifying that Headlamp no longer lists the plugin"
PF_LOG=$(mktemp)
$KUBECTL -n "$NAMESPACE" port-forward "svc/$SERVICE" "$LOCAL_PORT:$SERVICE_PORT" >"$PF_LOG" 2>&1 &
PF_PID=$!
cleanup() {
  kill "$PF_PID" 2>/dev/null || true
  rm -f "$PF_LOG"
}
trap cleanup EXIT

STILL_LISTED=false
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$LOCAL_PORT/plugins" 2>/dev/null | grep -q "\"$PLUGIN_NAME\""; then
    STILL_LISTED=true
  else
    STILL_LISTED=false
    break
  fi
  sleep 1
done

if [[ "$STILL_LISTED" == true ]]; then
  echo "$PLUGIN_NAME is still listed by GET /plugins" >&2
  exit 1
fi

echo "Removed."
