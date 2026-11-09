# 3D model assets

pispace serves `.glb` / `.gltf` files at `GET /models/:filename` (used by the venue `modelUrl` and by occluders with `kind: "mesh"`).

Site models such as a building scan do not belong in this public repository. Keep them with the private venue data and point pispace at them:

- `PISPACE_MODELS_DIR=/path/to/models`, or
- leave it unset: pispace looks in `models/` next to `PISPACE_VENUE_FILE`, then in this folder.

This folder only holds generic models, e.g. `aver-ptz330.glb` (camera body, made by `church-3d-mapper/scripts/create_aver_ptz330.mjs`).
