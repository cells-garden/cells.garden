# Figma plants → dev

## Artist workflow

1. In the master Figma file, add a family frame directly under **ASSETS** named `Source/Plants/<Name>`.
2. Add native components named `Part=Stem, Variant=stem1`, `Part=Stem, Variant=stem2`, etc., and `Part=Flowers, Variant=flower1`, etc.
3. In **EXPORTS**, add one linked instance for every component. Name each instance with its exact repository path, for example `src/assets/pack/plant_10/stem/stem1.png`. Keep its native dimensions.
4. Mark the whole family frame **Ready for dev**. Do not mark individual sprites instead.

## Automatic import

The `Import Figma plants` workflow runs hourly and can also be started manually from GitHub Actions. It reads the Figma file, selects only `Source/Plants/*` frames whose `devStatus.type` is `READY_FOR_DEV`, validates the component-to-export links and native dimensions, downloads 1× PNGs, assigns the next unused `plant_N`, and updates:

- `src/assets/pack/plant_N/` with the PNG sprites
- `design/asset-map.json` with source/export node IDs and image hashes
- `src/core/assets.ts` with the visible plant name
- `scripts/map-design-assets.mjs` with the audit name

It then runs typecheck, lint, design tests and the web build before pushing the isolated asset change to `dev`. Vercel deploys the dev branch through its existing Git integration.

## One-time setup

The workflow lives on the default branch so GitHub can schedule it. The job checks out `dev` for the actual import and publication. Add a repository Actions secret named `FIGMA_TOKEN` with the Figma `file_content:read` scope. The token is never stored in the repository or printed in logs.

## Data compatibility

A plant type is a bundled asset family, not a Supabase row. Existing gardens continue to store `plantType` and `imagePath` in their JSON. Do not rename or remove old sprite paths: old clients and saved gardens may still refer to them. No Supabase migration is needed.

## Architecture

```mermaid
flowchart LR
  A["Figma ASSETS<br/>Source/Plants/Name"] --> B["Ready for dev"]
  B --> C["GitHub Actions<br/>hourly Figma API scan"]
  C --> D["Validate source ↔ export links"]
  D --> E["Download native 1× PNGs"]
  E --> F["Update asset map + plant names"]
  F --> G["Tests + web build"]
  G --> H["Push asset-only commit to dev"]
  H --> I["Vercel<br/>dev.cells.garden"]
  I --> J["Web app / GardenStore"]
  J <--> K["Supabase<br/>user garden JSON"]
```
