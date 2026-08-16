# Plugin provider icons

The bundled plugin manifests in `vendor/openclaw/dist/extensions/*/openclaw.plugin.json`
provide Simple Icons CDN URLs for the provider and channel marks that have a first-party
plugin icon. Those marks are downloaded and rasterized to 96×96 PNGs for offline use.

Source references:

- Simple Icons CDN: `https://cdn.simpleicons.org/`
- Simple Icons jsDelivr package: `https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/`
- Simple Icons usage documentation: `https://github.com/simple-icons/simple-icons/blob/develop/README.md`

Provider aliases that already exist in `public/icons/providers/` are reused directly by
the plugin panel. Plugins without a supplied brand mark keep the readable initials fallback.

The marks remain the property of their respective owners.
