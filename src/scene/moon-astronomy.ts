import SunCalc from 'suncalc';

/**
 * Stage 4: real moon position + phase via SunCalc.
 *
 * Fixed reference location (no geolocation prompt, per design decision —
 * phase is identical everywhere on Earth; only rise/set timing shifts
 * slightly by latitude/longitude, which isn't worth a permission prompt
 * for a portfolio background). Swap these for a real location any time.
 */
export const REFERENCE_LOCATION = {
  lat: 40.7128,
  lon: -74.006,
};

export interface MoonState {
  /** Whether the moon should be drawn at all right now. */
  visible: boolean;
  /** Radians. SunCalc convention: 0 = south, positive = towards west. */
  azimuth: number;
  /** Radians above the horizon. Negative = below horizon. */
  altitude: number;
  /** 0..1 synodic phase fraction. 0/1 = new moon, 0.5 = full moon. */
  phase: number;
  distanceKm: number;
}

/**
 * `dayFactor` (0 = full night, 1 = full day, see ./sky.ts) is passed in
 * rather than recomputed here so both the sky and the moon agree on the
 * same clock-driven day/night state and can't drift out of sync.
 *
 * The moon is astronomically real (rise/set by altitude), but per the
 * design brief it's deliberately suppressed during full daylight even
 * if it happens to be geometrically above the horizon.
 */
export function computeMoonState(date: Date, dayFactor: number): MoonState {
  const { lat, lon } = REFERENCE_LOCATION;
  const position = SunCalc.getMoonPosition(date, lat, lon);
  const illumination = SunCalc.getMoonIllumination(date);

  const visible = position.altitude > 0 && dayFactor < 0.999;

  return {
    visible,
    azimuth: position.azimuth,
    altitude: position.altitude,
    phase: illumination.phase,
    distanceKm: position.distance,
  };
}
