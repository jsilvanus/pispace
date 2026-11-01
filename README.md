# pispace

**pispace** is the spatial engine and geometric digital-twin service for the Pi production ecosystem (`pigateway`, `pimatrix`, `picontrol`, `pilight`, `picontrol-mcp`).

It bridges **FreeD camera tracking telemetry** (physical Pan, Tilt, Roll, XYZ, and optical Zoom) and **2D video perception** (bounding boxes from `fffleet` / YOLOX) with the **3D coordinate system of the venue**, determining who is standing where in the church in real time.

---

## Architecture & Responsibilities

```
                               ┌─────────────────────────────────────────┐
                               │                 pispace                 │
                               │                                         │
┌───────────────────────────┐  │   ┌──────────────────────────────────┐  │
│         pigateway         │  │   │        Venue Spatial Model       │  │
│ • FreeD UDP 40000         │──┼──▶│   • Altar, Pulpit, Lectern, etc. │  │
│ • Perception Ingest       │  │   │   • Camera Extrinsics & Mounts   │  │
│ (GET /api/v1/events SSE)  │  │   └──────────────────────────────────┘  │
└───────────────────────────┘  │                     │                   │
                               │                     ▼                   │
                               │   ┌──────────────────────────────────┐  │
                               │   │      Spatial Engine (Math)       │  │
                               │   │   • Raycasting: (FreeD + 2D Bbox)│  │
                               │   │     ➔ 3D Venue Position (X,Y,Z)  │  │
                               │   │   • 3D Zone Verification         │  │
                               │   │   • Inverse PTZ Solver           │  │
                               │   └──────────────────────────────────┘  │
                               │                     │                   │
                               └─────────────────────┼───────────────────┘
                                                     │ HTTP REST & SSE (Port 3108)
                                                     ▼
               ┌─────────────────────┬─────────────────────┬─────────────────────┐
               ▼                     ▼                     ▼                     ▼
         [ picontrol ]         [ pimatrix ]           [ pilight ]        [ picontrol-mcp ]
         2D/3D Venue Map       Auto-Follow Crop       Spatial Tally      AI Agent Tools
```

---

## 1. Venue Coordinate System

Sanctuary landmarks are mapped in metric 3D coordinates $(X, Y, Z)$ centered at **Riihimäen Keskuskirkko**:

* **Origin $(0, 0, 0)$**: Sanctuary floor at the center of the communion rail curve.
* **$+X$**: Right / South across the nave (towards Lectern / Choir).
* **$-X$**: Left / North across the nave (towards Pulpit).
* **$+Y$**: Longitudinal depth forward towards the Altar wall.
* **$-Y$**: Longitudinal depth back towards the Organ balcony & entrance.
* **$+Z$**: Elevation height in meters above the nave floor ($Z=0$).

### Defined Spatial Zones

| Zone ID | Name | Floor Height | Elevation & Boundaries | Tags |
| :--- | :--- | :--- | :--- | :--- |
| `pulpit` | Saarnastuoli | $1.3\text{ m}$ | Elevated balcony on North wall ($X \in [-4.5, -2.6]$, $Y \in [-0.5, 1.8]$) | `speaker`, `sermon` |
| `lectern` | Lukupulpetti | $0.4\text{ m}$ | Right chancel stage ($X \in [1.8, 3.5]$, $Y \in [-0.5, 1.6]$) | `reader`, `readings` |
| `altar` | Alttari | $0.4\text{ m}$ | Main chancel table ($X \in [-2.8, 2.8]$, $Y \in [0.6, 5.2]$) | `liturgy`, `eucharist` |
| `communion_rail` | Alttarikaide | $0.4\text{ m}$ | Semicircular rail ($X \in [-3.2, 3.2]$, $Y \in [-0.8, 0.5]$) | `communion` |
| `choir` | Kuorotila | $0.4\text{ m}$ | Chancel South side ($X \in [3.2, 6.5]$, $Y \in [0.6, 4.5]$) | `music`, `choir` |
| `organ_loft` | Urkuparvi | $4.5\text{ m}$ | Rear organ gallery ($X \in [-6.0, 6.0]$, $Y \in [-20.0, -13.5]$) | `music`, `organist` |
| `nave` | Kirkkosali | $0.0\text{ m}$ | Main pew seating ($X \in [-7.0, 7.0]$, $Y \in [-14.0, -1.0]$) | `congregation` |

---

## 2. Camera Rig Extrinsics & Intrinsics

Configured for the church's two **AVer PTZ330** cameras:
* **`cam1`**: Mounted on side wall / chancel pillar at $(5.2, 1.5, 3.6)\text{ m}$ looking across at Pulpit and Altar (Base pan: $250^\circ$, tilt: $-12^\circ$).
* **`cam2`**: Mounted centrally on the rear organ balcony at $(0.0, -14.5, 5.0)\text{ m}$ looking down the nave aisle (Base pan: $0^\circ$, tilt: $-8^\circ$).
* **Intrinsics**: 1/2.8" Exmor CMOS sensor ($5.16 \times 2.90\text{ mm}$), 30x optical zoom ($f = 4.3\text{ mm} \sim 129\text{ mm}$, $\text{HFOV} = 67.0^\circ \sim 2.3^\circ$).

---

## 3. Core Algorithms

1. **Optical Raycasting**:
   $$\vec{d}_{\text{cam}} = \text{normalize}\left((u - 0.5) \cdot 2 \tan\left(\frac{\text{HFOV}}{2}\right), 1.0, (0.5 - v) \cdot 2 \tan\left(\frac{\text{VFOV}}{2}\right)\right)$$
   $$\vec{d}_{\text{world}} = \mathbf{R}_{\text{world}}(\text{Pan}, \text{Tilt}, \text{Roll}) \cdot \vec{d}_{\text{cam}}$$
2. **Floor / Stage Plane Intersection**:
   $$t = \frac{Z_{\text{stage}} - C_z}{d_z}, \quad \mathbf{P}_{\text{feet}} = \mathbf{C} + t \vec{d}_{\text{world}}$$
3. **Zone Verification**:
   Point-in-polygon containment test on the 2D horizontal boundary at the candidate stage elevation.
4. **Inverse PTZ Solver**:
   Given target $\mathbf{T} = (X_t, Y_t, Z_t)$ and desired shot type (`wide`, `medium`, `close_up`, `tight`), computes the required Pan, Tilt, and FreeD Zoom.

---

## 4. HTTP API (Port 3108)

- `GET /health`: Health check (`{ ok: true, service: "pispace" }`).
- `GET /api/v1/scene`: Current live spatial scene (all cameras, 3D tracked subjects, active zones).
- `GET /api/v1/zones`: List all defined 3D venue zones with target centers.
- `GET /api/v1/zones/:zoneId`: Detailed polygon and parameters for a specific zone.
- `POST /api/v1/solve-ptz`: Computes required Pan/Tilt/Zoom to frame a zone or 3D coordinate:
  ```json
  {
    "cameraId": "cam1",
    "target": { "zoneId": "pulpit" },
    "shotType": "close_up"
  }
  ```
- `POST /api/v1/project`: Casts a 2D bounding box `[ymin, xmin, ymax, xmax]` to 3D world space.
- `POST /api/v1/freed`: Push FreeD telemetry directly.
- `POST /api/v1/perception`: Push 2D bounding box detections directly.
- `GET /api/v1/events`: Server-Sent Events (SSE) stream emitting `scene`, `subject-entered-zone`, and `subject-left-zone`.

---

## 5. CLI Usage (`pispace`)

```bash
# View live scene & 3D tracked people
pnpm exec pispace scene

# List venue zones
pnpm exec pispace zones

# Calculate PTZ command to frame the pulpit with a medium shot
pnpm exec pispace solve --camera cam1 --zone pulpit --shot medium

# Project a camera bounding box into 3D world coordinates
pnpm exec pispace project --camera cam1 --bbox 0.2,0.3,0.8,0.5 --stage 1.3
```

---

## 6. Development & Testing

```bash
# Install dependencies
pnpm install

# Run unit & integration tests
pnpm test

# Build TypeScript to dist/
pnpm run build

# Start daemon
pnpm start
```
