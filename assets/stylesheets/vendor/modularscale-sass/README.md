# modularscale-sass (vendored)

Vendored from [modularscale-sass](https://github.com/modularscale/modularscale-sass)
`3.0.10` (MIT license), instead of used as an npm dependency.

`3.0.10`'s own `stylesheets/modularscale/*.scss` files were never actually
migrated from the legacy `@import` module system to `@use`: every
cross-file reference (`ms-function()`, `ms-pow()`, `$modularscale`, etc.) is
a bare, unnamespaced global that only resolves through `@import`'s global
scope. Only the package's top-level aggregator (`_modularscale.scss`)
was migrated to `@use`, which breaks each individual file when `@use`d
directly (as this project's SCSS does, one file at a time, e.g. `sugar`)
because they're never reached through `@import` at all. It doesn't fail on
`@import`-based usage, and doesn't fail with every Dart Sass version/platform
combination locally, which is why it went unnoticed until it hit a real Linux
build.

The files here are the same content, patched to add explicit `@use`
statements and namespaced references, so each file is self-contained under
the modern module system without depending on `@import` (deprecated,
removed in Dart Sass 3.0).
