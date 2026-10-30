import type { VenueModel } from '../types.js';

/**
 * Default spatial venue geometry for Riihimäen Keskuskirkko sanctuary.
 * Origin (0, 0, 0): Floor level at the communion rail / chancel center.
 * +X: Sanctuary Right (South)
 * -X: Sanctuary Left (North, Pulpit side)
 * +Y: Longitudinal forward towards Altar wall
 * -Y: Longitudinal back towards Organ balcony & entrance
 * +Z: Elevation height in meters above nave floor
 */
export const KESKUSKIRKKO_VENUE: VenueModel = {
  name: 'Riihimäen Keskuskirkko',
  description: 'Sanctuary layout with Chancel, Altar, Pulpit, Lectern, Choir, and Organ Gallery',
  dimensions: {
    widthMeters: 16.0,
    lengthMeters: 30.0,
    heightMeters: 14.0,
  },
  originDescription: 'Sanctuary floor at center of the communion rail curve',
  cameras: {
    cam1: {
      id: 'cam1',
      name: 'Cam 1 (Side Wall / Chancel Pillar)',
      // Mounted on right chancel wall looking across at pulpit and altar
      position: { x: 5.2, y: 1.5, z: 3.6 },
      baseOrientation: {
        pan: 250.0,
        tilt: -12.0,
        roll: 0.0,
      },
    },
    cam2: {
      id: 'cam2',
      name: 'Cam 2 (Organ Gallery / Balcony)',
      // Mounted centrally on rear balcony looking straight down the nave to altar
      position: { x: 0.0, y: -14.5, z: 5.0 },
      baseOrientation: {
        pan: 0.0,
        tilt: -8.0,
        roll: 0.0,
      },
    },
  },
  zones: [
    {
      id: 'pulpit',
      name: 'Saarnastuoli (Pulpit)',
      floorHeight: 1.3, // Elevated pulpit balcony
      ceilingHeight: 4.5,
      color: '#e74c3c',
      tags: ['speaker', 'sermon', 'liturgy'],
      polygon: [
        { x: -4.5, y: -0.5 },
        { x: -2.6, y: -0.5 },
        { x: -2.6, y: 1.8 },
        { x: -4.5, y: 1.8 },
      ],
    },
    {
      id: 'lectern',
      name: 'Lukupulpetti (Lectern)',
      floorHeight: 0.4, // Chancel stage elevation
      ceilingHeight: 3.5,
      color: '#f39c12',
      tags: ['reader', 'readings', 'prayers'],
      polygon: [
        { x: 1.8, y: -0.5 },
        { x: 3.5, y: -0.5 },
        { x: 3.5, y: 1.6 },
        { x: 1.8, y: 1.6 },
      ],
    },
    {
      id: 'altar',
      name: 'Alttari (Altar Chancel)',
      floorHeight: 0.4,
      ceilingHeight: 12.0,
      color: '#9b59b6',
      tags: ['liturgy', 'eucharist', 'blessing'],
      polygon: [
        { x: -2.8, y: 0.6 },
        { x: 2.8, y: 0.6 },
        { x: 2.8, y: 5.2 },
        { x: -2.8, y: 5.2 },
      ],
    },
    {
      id: 'communion_rail',
      name: 'Alttarikaide (Communion Rail)',
      floorHeight: 0.4,
      ceilingHeight: 3.0,
      color: '#3498db',
      tags: ['communion'],
      polygon: [
        { x: -3.2, y: -0.8 },
        { x: 3.2, y: -0.8 },
        { x: 3.2, y: 0.5 },
        { x: -3.2, y: 0.5 },
      ],
    },
    {
      id: 'choir',
      name: 'Kuorotila (Choir Area)',
      floorHeight: 0.4,
      ceilingHeight: 8.0,
      color: '#2ecc71',
      tags: ['music', 'choir'],
      polygon: [
        { x: 3.2, y: 0.6 },
        { x: 6.5, y: 0.6 },
        { x: 6.5, y: 4.5 },
        { x: 3.2, y: 4.5 },
      ],
    },
    {
      id: 'organ_loft',
      name: 'Urkuparvi (Organ Gallery)',
      floorHeight: 4.5, // Balcony level
      ceilingHeight: 12.0,
      color: '#1abc9c',
      tags: ['music', 'organist'],
      polygon: [
        { x: -6.0, y: -20.0 },
        { x: 6.0, y: -20.0 },
        { x: 6.0, y: -13.5 },
        { x: -6.0, y: -13.5 },
      ],
    },
    {
      id: 'nave',
      name: 'Kirkkosali (Nave / Pews)',
      floorHeight: 0.0,
      ceilingHeight: 12.0,
      color: '#7f8c8d',
      tags: ['congregation'],
      polygon: [
        { x: -7.0, y: -14.0 },
        { x: 7.0, y: -14.0 },
        { x: 7.0, y: -1.0 },
        { x: -7.0, y: -1.0 },
      ],
    },
  ],
  occluders: [
    {
      id: 'pulpit_facade',
      name: 'Pulpit Wooden Balustrade & Desk',
      kind: 'mesh',
      meshUrl: 'models/pulpit-facade.glb',
      position: { x: -3.5, y: 0.5, z: 1.3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.0, y: 1.0, z: 1.0 },
    },
    {
      id: 'altar_table',
      name: 'Altar Table',
      kind: 'box',
      position: { x: 0.0, y: 2.5, z: 0.4 },
      dimensions: { width: 3.2, depth: 1.2, height: 1.0 },
    },
  ],
  floors: [
    {
      id: 'altar_chancel_dais',
      name: 'Alttarikoroke (Chancel Dais +0.40m)',
      elevation: 0.4,
      thickness: 0.4,
      color: '#252e3d',
      polygon: [
        { x: -5.0, y: 0.0 },
        { x: 5.0, y: 0.0 },
        { x: 5.0, y: 5.6 },
        { x: -5.0, y: 5.6 },
      ],
    },
    {
      id: 'organ_gallery_floor',
      name: 'Urkuparven Lattia (Organ Gallery +4.50m)',
      elevation: 4.5,
      thickness: 0.5,
      color: '#1e293b',
      polygon: [
        { x: -7.5, y: -14.8 },
        { x: 7.5, y: -14.8 },
        { x: 7.5, y: -10.5 },
        { x: -7.5, y: -10.5 },
      ],
    },
  ],
  walls: [
    {
      id: 'north_arcade_header',
      name: 'North Arcade Wall (Open Bottom Arch)',
      start: { x: -4.8, y: -10.5 },
      end: { x: -4.8, y: 5.5 },
      bottomZ: 3.8,
      topZ: 14.0,
      thickness: 0.45,
      color: '#475569',
    },
    {
      id: 'south_arcade_header',
      name: 'South Arcade Wall (Open Bottom Arch)',
      start: { x: 4.8, y: -10.5 },
      end: { x: 4.8, y: 5.5 },
      bottomZ: 3.8,
      topZ: 14.0,
      thickness: 0.45,
      color: '#475569',
    },
    {
      id: 'chancel_arch_header',
      name: 'Chancel Triumphal Arch (Open Bottom)',
      start: { x: -4.8, y: 0.1 },
      end: { x: 4.8, y: 0.1 },
      bottomZ: 5.2,
      topZ: 14.0,
      thickness: 0.5,
      color: '#526071',
    },
    {
      id: 'north_side_wall',
      name: 'North Side Aisle Wall (Lower Ceiling 4.2m)',
      start: { x: -8.0, y: -14.8 },
      end: { x: -8.0, y: 5.8 },
      bottomZ: 0.0,
      topZ: 4.2,
      thickness: 0.4,
      color: '#334155',
    },
    {
      id: 'south_side_wall',
      name: 'South Side Aisle Wall (Lower Ceiling 4.2m)',
      start: { x: 8.0, y: -14.8 },
      end: { x: 8.0, y: 5.8 },
      bottomZ: 0.0,
      topZ: 4.2,
      thickness: 0.4,
      color: '#334155',
    },
  ],
};
