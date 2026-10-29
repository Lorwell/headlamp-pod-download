# Deployment

Headlamp loads plugins from the directory passed with `-plugins-dir`
(`/headlamp/plugins` in the upstream manifests and Helm chart). A plugin is a
folder containing `main.js` and `package.json`.

This project ships the bundle as a ConfigMap, so no custom Headlamp image and no
extra registry are required.

## Quick install

```bash
pnpm install
pnpm build
KUBECTL="kubectl" ./deploy/install.sh -n kube-system
```

The script:

1. creates/updates the ConfigMap `headlamp-pod-download-plugin` from
   `dist/main.js` and `package.json`;
2. patches the Deployment with one volume and one read-only volumeMount at
   `/headlamp/plugins/headlamp-pod-download`;
3. waits for the rollout;
4. verifies that `GET /plugins` lists the plugin and `main.js` is served.

Use `--dry-run` to print both objects without touching the cluster.
On k3s use `KUBECTL="k3s kubectl"`.

## Declarative install

If you manage Headlamp from Git, add the ConfigMap creation to your pipeline and
merge `headlamp-deployment-patch.yaml` into your Deployment manifest. The
ConfigMap must exist before the Deployment rolls out.

```bash
kubectl -n kube-system create configmap headlamp-pod-download-plugin \
  --from-file=main.js=dist/main.js \
  --from-file=package.json=package.json \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Updating

Rebuild and re-apply the ConfigMap, then restart Headlamp: the backend only
re-reads the plugin directory at startup unless it runs with
`-watch-plugins-changes`.

```bash
pnpm build
./deploy/install.sh -n kube-system
kubectl -n kube-system rollout restart deployment/headlamp
```

## Uninstall

```bash
./deploy/uninstall.sh -n kube-system
```

The script removes the volume mount and volume from the Deployment, deletes the
ConfigMap and checks that `GET /plugins` no longer lists the plugin.
