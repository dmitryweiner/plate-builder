# Plate Builder

A web app that builds a flat plate for 3D printing — a door sign, a
keychain, a pet tag, a house number, a medal — and exports it as STL. Put
images whose brightness becomes relief, texts and holes on a plate, pick its
outline, and download a file ready for the slicer. Everything runs in the
browser, offline included.

Work in progress: see [the specification](docs/spec.md) and
[the plan](plans/PLAN.md).

- TypeScript 7 + Vite, no framework; Three.js for the 3D view
- CSG with [manifold-3d](https://github.com/elalish/manifold) (WASM) in a
  module worker
- English, Russian, Ukrainian and Hebrew (RTL)
- PWA: works offline after the first visit

## Development

```bash
fnm use            # Node from .node-version
npm ci
npm run dev        # dev server
npm run check      # typecheck + lint + unit tests
npm run smoke      # browser smoke (-- --preview for the build and offline)
npm run build      # → dist/
```

See [AGENTS.md](AGENTS.md) for the layout and conventions, [docs/](docs/)
for the documentation.

## License

[GPL-3.0-or-later](LICENSE).
