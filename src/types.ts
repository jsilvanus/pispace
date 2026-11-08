export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Ray3D {
  origin: Point3D;
  direction: Point3D;
}

/** Normalized bounding box [ymin, xmin, ymax, xmax] where coords are in range 0.0 - 1.0 */
export type BoundingBox2D = [ymin: number, xmin: number, ymax: number, xmax: number];

export interface Plane3D {
  point: Point3D;
  normal: Point3D;
}

export interface CameraMount {
  id: string;
  name: string;
  /** Physical mount coordinate in venue space (meters). */
  position: Point3D;
  /** Baseline mounting orientation offsets (degrees). */
  baseOrientation: {
    pan: number;
    tilt: number;
    roll: number;
  };
}

export interface CameraIntrinsics {
  sensorWidthMm: number;
  sensorHeightMm: number;
  focalLengthWideMm: number;
  focalLengthTeleMm: number;
  minHfovDeg: number;
  maxHfovDeg: number;
  maxRawZoom: number;
}

export interface CameraFreeDTelemetry {
  camId: number;
  pan: number;
  tilt: number;
  roll: number;
  x?: number | undefined;
  y?: number | undefined;
  z?: number | undefined;
  zoom: number;
  focus?: number | undefined;
  receivedAt?: string | undefined;
}

export interface SpatialZone {
  id: string;
  name: string;
  /** 2D polygonal boundary in venue meters (X = width/lateral, Y = depth/longitudinal). */
  polygon: Point2D[];
  /** Base stage/floor elevation in meters (Z). */
  floorHeight: number;
  /** Height ceiling/cutoff in meters (Z). */
  ceilingHeight: number;
  color?: string | undefined;
  tags?: string[] | undefined;
}

export interface SpatialOccluder {
  id: string;
  name: string;
  /** Type of geometry: 'mesh' (external glTF/GLB) or parametric 'box' | 'cylinder' | 'polygon_wall' | 'table' */
  kind: 'mesh' | 'box' | 'cylinder' | 'polygon_wall' | 'table';
  /** Path to glTF/GLB 3D model asset (e.g. "models/pulpit.glb") */
  meshUrl?: string | undefined;
  /** Anchor position in venue coordinates (meters) */
  position: Point3D;
  /** Rotation in degrees [pitch, yaw, roll] */
  rotation?: { x: number; y: number; z: number } | undefined;
  /** Scale factor (default [1, 1, 1]) */
  scale?: { x: number; y: number; z: number } | undefined;
  /** Parametric dimensions if kind is box/cylinder (meters) */
  dimensions?: { width: number; height: number; depth: number } | undefined;
  /** Polygon vertices if kind is polygon_wall */
  polygon?: Point2D[] | undefined;
}

export interface FloorPlatform {
  id: string;
  name: string;
  /** Elevation in meters above nave ground (Z = 0) */
  elevation: number;
  thickness?: number | undefined;
  polygon: Point2D[];
  color?: string | undefined;
}

export interface VenueWall {
  id: string;
  name: string;
  start: Point2D;
  end: Point2D;
  /** Base elevation of the wall. 0 for normal wall, or > 0 (e.g. 3.8m) for OPEN-BOTTOM wall / arch header! */
  bottomZ: number;
  /** Top elevation of the wall (e.g. 14.0m ceiling or 4.2m side aisle) */
  topZ: number;
  thickness: number;
  color?: string | undefined;
  /** If true, wall is rendered translucent in 3D mode so interior is visible */
  seeThrough?: boolean | undefined;
}

export interface VenueModel {
  name: string;
  description: string;
  dimensions: {
    widthMeters: number;
    lengthMeters: number;
    heightMeters: number;
  };
  originDescription: string;
  cameras: Record<string, CameraMount>;
  zones: SpatialZone[];
  /** 3D physical structures used for keymasking / occlusion matte in AR graphics */
  occluders?: SpatialOccluder[] | undefined;
  /** Physical floor slabs and raised platforms (e.g. Altar dais, organ gallery) */
  floors?: FloorPlatform[] | undefined;
  /** Structural walls and open-bottom arch headers */
  walls?: VenueWall[] | undefined;
  /** Named storeys (e.g. ground floor, gallery) used to filter maps */
  levels?: VenueLevel[] | undefined;
  /** Pews, tables, pulpit, organ and other furnishings (for maps and 3D views, not keymasking) */
  furniture?: VenueFurniture[] | undefined;
  /** Stairs and ramps between heights */
  stairs?: VenueStair[] | undefined;
  /** Doors and escape-route exits */
  exits?: VenueExit[] | undefined;
  /** Side rooms (sacristy, kitchen, WC) shown as labelled areas */
  rooms?: VenueRoom[] | undefined;
  /** Reusable movable object definitions */
  objectTypes?: VenueObjectType[] | undefined;
  /** Named arrangements of movable objects */
  layouts?: VenueLayout[] | undefined;
  /** Layout in use (default: the first one) */
  activeLayout?: string | undefined;
  /** Where the geometry came from and whether it was measured */
  source?: { method?: string | undefined; pixelsPerMeter?: number | undefined; verified?: boolean | undefined } | undefined;
}

export interface VenueLevel {
  id: string;
  name: string;
  /** Floor elevation of the storey in meters */
  elevation: number;
}

export interface VenueFurniture {
  id: string;
  name: string;
  kind: 'pew' | 'table' | 'altar' | 'pulpit' | 'rail' | 'organ' | 'piano' | 'bench' | 'other';
  shape?: 'box' | 'cylinder' | undefined;
  /** Footprint centre; z is the base height the item stands on */
  center: Point3D;
  /** width along local X, depth along local Y, height up */
  size: { width: number; depth: number; height: number };
  /** Counter-clockwise rotation about +Z in degrees (from +X towards +Y) */
  rotationDeg?: number | undefined;
  color?: string | undefined;
  /** Set on items that come from a layout placement (movable objects) */
  movable?: boolean | undefined;
  typeId?: string | undefined;
  layoutId?: string | undefined;
}

/** A reusable object definition (e.g. one altar rail section, a lectern, a chair, a Christmas tree). */
export interface VenueObjectType {
  id: string;
  name: string;
  kind: VenueFurniture['kind'];
  shape?: 'box' | 'cylinder' | undefined;
  size: { width: number; depth: number; height: number };
  color?: string | undefined;
}

/** One movable object placed in a layout. */
export interface VenuePlacement {
  id: string;
  typeId: string;
  name?: string | undefined;
  center: Point3D;
  rotationDeg?: number | undefined;
}

/** A named arrangement of movable objects (normal service, Christmas, concert...). */
export interface VenueLayout {
  id: string;
  name: string;
  placements: VenuePlacement[];
}

export interface VenueStair {
  id: string;
  name: string;
  polygon: Point2D[];
  fromZ: number;
  toZ: number;
}

export interface VenueExit {
  id: string;
  name: string;
  position: Point3D;
  /** VenueLevel id */
  level?: string | undefined;
}

export interface VenueRoom {
  id: string;
  name: string;
  kind?: string | undefined;
  floorZ: number;
  polygon: Point2D[];
}

export interface Subject3D {
  trackId: number;
  sourceCameraId: string;
  /** Estimated 3D standing position (feet position at ground/stage level) */
  position: Point3D;
  /** Estimated head height in meters */
  headHeight: number;
  zoneId: string | null;
  zoneName: string | null;
  confidence: number;
  label: string;
  lastSeenAt: string;
}

export interface CameraFrustum {
  opticalAxis: Point3D;
  targetIntersection: Point3D | null;
  hfovDeg: number;
  vfovDeg: number;
  focalLengthMm: number;
  activeZoneId: string | null;
}

export interface CameraSpatialState {
  id: string;
  mount: CameraMount;
  telemetry: CameraFreeDTelemetry | null;
  frustum: CameraFrustum | null;
  isStreaming: boolean;
  onAir: boolean;
}

export interface SpatialScene {
  updatedAt: string;
  cameras: Record<string, CameraSpatialState>;
  subjects: Subject3D[];
  activeZones: string[];
}

export type ShotType = "wide" | "medium" | "close_up" | "tight";

export interface PtzSolveRequest {
  cameraId: string;
  target: Point3D | { zoneId: string };
  shotType?: ShotType | undefined;
  headroomRatio?: number | undefined;
}

export interface PtzSolution {
  cameraId: string;
  targetPoint: Point3D;
  targetZoneId: string | null;
  distanceMeters: number;
  pan: number;
  tilt: number;
  zoom: number;
  estimatedHfovDeg: number;
  shotType: ShotType;
}
