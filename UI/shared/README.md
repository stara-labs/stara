# Stara UI

`@stara/ui` exports React primitive source from `src/index.ts`. Consumers import
`@stara/ui/styles` once at the application entry point. The stylesheet imports
`./styles/tokens.css`, the integrator-owned generated output. This package has
no dependency on web feature data or backend implementation.

The surface includes one icon adapter, command and icon buttons, named tooltips,
operational state text, labeled textareas, and a native modal dialog. Generated
tokens supply colors, typography, spacing, dimensions, and focus treatment.
Consumers compose their own feature state around these primitives.

Inter is supplied by the public `@fontsource-variable/inter@5.3.0` package under
OFL-1.1 and mapped to the token family name `Inter`. No private reference font is
copied. The web build emits the package's license as `licenses/Inter-OFL.txt`.
This third-party font license is not a license grant for the application.

Run `pnpm --filter @stara/ui typecheck`, `test:unit`, or `test:coverage` from the
monorepo. The coverage inventory is all authored `src/**/*.{ts,tsx}`, including
unexecuted files. Type declarations are excluded; styles are outside the V8
executable denominator. Thresholds are 90% lines and 85% branches. Integrated
reports are written to `.artifacts/coverage/ui`.
