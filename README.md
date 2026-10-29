# headlamp-pod-download

A small [Headlamp](https://headlamp.dev/) plugin that adds a **Download file** section to every Pod page: type the path of a file inside a container and the browser downloads it.

[![CI](https://github.com/Lorwell/headlamp-pod-download/actions/workflows/ci.yml/badge.svg)](https://github.com/Lorwell/headlamp-pod-download/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why

Headlamp can open a shell in a container, but it cannot copy files out of it. There is no plugin for it either: the upstream feature request ([kubernetes-sigs/headlamp#2348](https://github.com/kubernetes-sigs/headlamp/issues/2348)) is still open and the implementation PR is unmerged. `headlamp-pod-download` fills exactly that gap and nothing else — no upload, no browsing, no editing, no deletion.

## Features

- **Download file** section on the Pod details page (only for running pods).
- Container picker when the pod has more than one container.
- Progress indicator and a **Cancel** button while a file is streaming.
- Clear error messages for the usual failures: missing file, permission denied, directory, distroless image without `base64`.
- Hard limits: single regular file, up to **50 MiB**.
- No new backend and **no new RBAC**: the plugin uses `pods/exec` through Headlamp's existing API proxy, with the permissions of the logged-in user.

## How it works

```
Pod page  ──►  base64 <path>  ──►  Kubernetes exec websocket
                                        (proxied by Headlamp)
   browser  ◄──  stdout frames  ◄──  base64 text
      │
      └── decode → Blob → save with the original file name
```

The plugin calls `pod.exec()` from the Headlamp plugin API, strips the exec
channel prefixes from the websocket frames, decodes the base64 payload and hands
a `Blob` to the browser. Nothing is written to the cluster and the file never
touches Headlamp's disk.

## Requirements

| Requirement | Notes |
| --- | --- |
| Headlamp | Built against `@kinvolk/headlamp-plugin` 0.14.0; tested with Headlamp **v0.45.0** (in-cluster) |
| Container image | Needs a `base64` binary (GNU coreutils or BusyBox). Distroless/scratch images are not supported |
| Permissions | `pods/exec` in the pod's namespace (also required for Headlamp's terminal) |

## Install

The plugin is a folder with `main.js` + `package.json`. Headlamp loads it from
its `-plugins-dir` (usually `/headlamp/plugins`).

```bash
pnpm install
pnpm build

# in-cluster Headlamp; use KUBECTL="k3s kubectl" on k3s
KUBECTL="kubectl" ./deploy/install.sh -n kube-system
```

The script creates a ConfigMap, mounts it into the Headlamp Deployment at
`/headlamp/plugins/headlamp-pod-download`, waits for the rollout and verifies
that `GET /plugins` lists the plugin.

Declarative setups (Helm values, kustomize, GitOps) can create the ConfigMap and
merge [`deploy/headlamp-deployment-patch.yaml`](deploy/headlamp-deployment-patch.yaml)
instead — see [`deploy/README.md`](deploy/README.md) for details and for updates
and removal.

## Usage

1. Open **Pods** and select a running pod.
2. Scroll to the **Download file** section.
3. Pick the container (if there is more than one).
4. Enter an absolute path, for example `/var/log/app.log`, and click **Download**.

## Limitations

- Only single regular files. For directories use `kubectl cp -r pod:/dir ./dir`.
- Maximum 50 MiB per download, because the file is assembled in browser memory.
  Larger files are better served by `kubectl cp`, `kubectl exec ... tar`, or a
  dedicated object store.
- No upload, no resume, no history.
- The plugin needs a shell-free `base64` call, so images without it fail with an
  explicit message.

## Security

Downloading a file is exactly as privileged as `kubectl exec`: it runs
`base64 <path>` inside the container as the container's user, with the
permissions of the Headlamp session. Keep `pods/exec` restricted, and remember
that anyone who can exec into a pod can already read the files that pod can read.
The plugin stores nothing locally; the bytes go from the API server, through the
Headlamp backend websocket, to the browser tab that requested them.

## Development

```bash
pnpm install
pnpm start        # headlamp-plugin dev mode (needs a kubeconfig)
pnpm tsc          # type check
pnpm lint         # eslint, zero warnings
pnpm test         # vitest: frame parsing, formatting, component behaviour
pnpm build        # dist/main.js (UMD, ~8 KB)
```

Project layout:

```
src/
  index.tsx          registers the Pod details section
  DownloadSection.tsx  Headlamp section wrapper
  DownloadForm.tsx   the form, progress and error UI
  download.ts        exec stream, limits, timeouts, Blob download
  frames.ts          websocket frame + base64 decoding (pure)
  format.ts          file names, byte sizes, error messages (pure)
deploy/
  install.sh         ConfigMap + Deployment patch + verification
  uninstall.sh       removes both again
```

The plugin is built with `@kinvolk/headlamp-plugin@0.14.0`; React and MUI are
provided by Headlamp at runtime, so the bundle stays small.

## License

[MIT](LICENSE) © 2026 Lorwell
