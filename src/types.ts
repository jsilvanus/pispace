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
