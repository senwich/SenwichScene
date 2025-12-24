import * as THREE from "three";

export function setOrbitFromVector(out: THREE.Spherical, vector: THREE.Vector3) {
  out.radius = vector.length();
  if (out.radius === 0) {
    out.theta = 0;
    out.phi = Math.PI / 2;
    return out;
  }
  out.theta = Math.atan2(vector.y, vector.x);
  const cosPhi = THREE.MathUtils.clamp(vector.z / out.radius, -1, 1);
  out.phi = Math.acos(cosPhi);
  return out;
}

export function setVectorFromOrbit(spherical: THREE.Spherical, target: THREE.Vector3) {
  const sinPhiRadius = Math.sin(spherical.phi) * spherical.radius;
  target.set(
    sinPhiRadius * Math.cos(spherical.theta),
    sinPhiRadius * Math.sin(spherical.theta),
    Math.cos(spherical.phi) * spherical.radius
  );
  return target;
}



