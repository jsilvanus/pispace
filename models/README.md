# 3D Model Assets for AR Keymasking

Store 3D triangle mesh models (`.glb` / `.gltf` binary glTF) in this directory.

These models represent physical architecture in the sanctuary (e.g. `pulpit-facade.glb`, `communion-rail.glb`, `altar.glb`) and are loaded by broadcast graphics compositors (Three.js, WebGL, Unreal Engine) as **Holdout / Occlusion Mattes** to cleanly occlude virtual 3D graphics.

Models in this directory are served by `pispace` at:
`GET http://localhost:3203/models/:filename`
