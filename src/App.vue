<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

const container = ref<HTMLDivElement>();
const fileInput = ref<HTMLInputElement>();
const butterfly = ref<SplatMesh | null>(null);

const scene = new THREE.Scene();

const initialCameraDirection = new THREE.Vector3(0.75, 0.35, 1).normalize();
const defaultTarget = new THREE.Vector3(0, 0, 0);
const orbitTarget = new THREE.Vector3().copy(defaultTarget);

let defaultDistance = 4;
const defaultCameraPosition = new THREE.Vector3();
const defaultSpherical = new THREE.Spherical();
const spherical = new THREE.Spherical();
const sphericalGoal = new THREE.Spherical();

const cameraOffset = new THREE.Vector3();
const prevCameraPosition = new THREE.Vector3();
const prevCameraQuaternion = new THREE.Quaternion();
const targetOffset = new THREE.Vector3();
const tempVector = new THREE.Vector3();
const pointerNdc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const zoomFocus = new THREE.Vector3();
const zoomPlane = new THREE.Plane();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
const pixelRatio = Math.min(window.devicePixelRatio ?? 1, 1.6);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

let viewport: HTMLCanvasElement | null = null;
let currentObjectUrl: string | null = null;
let currentLoadToken = 0;

const rotateSpeed = 0.003;
const dampingFactor = 0.15;
const minDistance = 0.3;
const maxDistance = 50;
const minPolarAngle = 0.02;
const maxPolarAngle = Math.PI - 0.02;

const pointerState = {
  isDragging: false,
  lastX: 0,
  lastY: 0,
  axisLock: null as "horizontal" | "vertical" | null,
};

function setOrbitFromVector(out: THREE.Spherical, vector: THREE.Vector3) {
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

function setVectorFromOrbit(spherical: THREE.Spherical, target: THREE.Vector3) {
  const sinPhiRadius = Math.sin(spherical.phi) * spherical.radius;
  target.set(
    sinPhiRadius * Math.cos(spherical.theta),
    sinPhiRadius * Math.sin(spherical.theta),
    Math.cos(spherical.phi) * spherical.radius
  );
  return target;
}

let needsRender = true;
let renderLoopActive = false;

syncDefaultOrbit();
resetView(true);

function syncDefaultOrbit() {
  const offset = initialCameraDirection.clone().multiplyScalar(defaultDistance);
  defaultCameraPosition.copy(offset).add(defaultTarget);
  setOrbitFromVector(defaultSpherical, offset);
  defaultSpherical.makeSafe();
  defaultSpherical.radius = defaultDistance;
  spherical.copy(defaultSpherical);
  sphericalGoal.copy(defaultSpherical);
  orbitTarget.copy(defaultTarget);
  setVectorFromOrbit(spherical, cameraOffset).add(orbitTarget);
  camera.position.copy(cameraOffset);
  camera.lookAt(orbitTarget);
}

function handleResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  requestRender();
}

function triggerFileSelect() {
  const input = fileInput.value;
  if (!input) return;
  input.value = "";
  input.click();
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const loadToken = ++currentLoadToken;

  if (butterfly.value) {
    scene.remove(butterfly.value);
    butterfly.value.dispose();
    butterfly.value = null;
    requestRender();
  }

  const staleMeshes: SplatMesh[] = [];
  for (const child of scene.children) {
    if (child instanceof SplatMesh) {
      staleMeshes.push(child);
    }
  }
  for (const mesh of staleMeshes) {
    scene.remove(mesh);
    mesh.dispose();
  }
  if (staleMeshes.length > 0) {
    requestRender();
  }

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  const url = URL.createObjectURL(file);
  currentObjectUrl = url;

  const newButterfly = new SplatMesh({ url });
  newButterfly.quaternion.set(0, 0, 0, 1);
  newButterfly.position.set(0, 0, 0);
  scene.add(newButterfly);
  butterfly.value = newButterfly;

  newButterfly.initialized.then(() => {
    if (butterfly.value !== newButterfly || loadToken !== currentLoadToken) return;
    fitViewToMesh(newButterfly);
  });

  target.value = "";
}

function resetView(immediate = false) {
  pointerState.isDragging = false;
  orbitTarget.copy(defaultTarget);
  sphericalGoal.copy(defaultSpherical);
  if (immediate) {
    spherical.copy(defaultSpherical);
  }
  updateCamera(true);
  requestRender();
}

async function fitViewToMesh(mesh: SplatMesh) {
  await mesh.initialized;

  const bbox = mesh.getBoundingBox();
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const boundingRadius = Math.max(maxDim, 0.01) * 0.5;
  const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const fitDistance = boundingRadius / Math.sin(halfFov);

  defaultTarget.copy(center);
  orbitTarget.copy(center);
  defaultDistance = Math.max(fitDistance * 1.1, boundingRadius * 2);

  syncDefaultOrbit();
  resetView(true);
  requestRender();
}

function updateCamera(immediate = false) {
  sphericalGoal.radius = THREE.MathUtils.clamp(
    sphericalGoal.radius,
    minDistance,
    maxDistance
  );
  sphericalGoal.phi = THREE.MathUtils.clamp(
    sphericalGoal.phi,
    minPolarAngle,
    maxPolarAngle
  );

  if (immediate) {
    spherical.copy(sphericalGoal);
  } else {
    const thetaBefore = spherical.theta;
    const phiBefore = spherical.phi;
    const radiusBefore = spherical.radius;
    spherical.theta += (sphericalGoal.theta - spherical.theta) * dampingFactor;
    spherical.phi += (sphericalGoal.phi - spherical.phi) * dampingFactor;
    spherical.radius += (sphericalGoal.radius - spherical.radius) * dampingFactor;
    const thetaDiff = Math.abs(spherical.theta - thetaBefore);
    const phiDiff = Math.abs(spherical.phi - phiBefore);
    const radiusDiff = Math.abs(spherical.radius - radiusBefore);
    if (thetaDiff < 1e-6 && phiDiff < 1e-6 && radiusDiff < 1e-5) {
      spherical.copy(sphericalGoal);
    }
  }

  spherical.makeSafe();

  prevCameraPosition.copy(camera.position);
  prevCameraQuaternion.copy(camera.quaternion);

  setVectorFromOrbit(spherical, cameraOffset).add(orbitTarget);
  camera.position.copy(cameraOffset);
  camera.lookAt(orbitTarget);

  const positionChanged = prevCameraPosition.distanceToSquared(camera.position) > 1e-10;
  const quaternionDot = Math.abs(prevCameraQuaternion.dot(camera.quaternion));
  const rotationChanged = 1 - quaternionDot > 1e-10;

  const animating =
    Math.abs(sphericalGoal.theta - spherical.theta) > 1e-5 ||
    Math.abs(sphericalGoal.phi - spherical.phi) > 1e-5 ||
    Math.abs(sphericalGoal.radius - spherical.radius) > 1e-4;

  return immediate || positionChanged || rotationChanged || animating;
}

function handlePointerDown(event: PointerEvent) {
  if (!viewport) return;
  pointerState.isDragging = true;
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;
  pointerState.axisLock = null;
  viewport.setPointerCapture(event.pointerId);
  event.preventDefault();
  requestRender();
}

function handlePointerMove(event: PointerEvent) {
  if (!pointerState.isDragging) return;
  const deltaX = event.clientX - pointerState.lastX;
  const deltaY = event.clientY - pointerState.lastY;
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;

  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const axisLockThreshold = 1.5;

  if (!pointerState.axisLock) {
    if (absX > absY * axisLockThreshold) {
      pointerState.axisLock = "horizontal";
    } else if (absY > absX * axisLockThreshold) {
      pointerState.axisLock = "vertical";
    }
  }

  if (pointerState.axisLock === "horizontal") {
    sphericalGoal.theta -= deltaX * rotateSpeed;
  } else if (pointerState.axisLock === "vertical") {
    sphericalGoal.phi -= deltaY * rotateSpeed;
  } else {
    sphericalGoal.theta -= deltaX * rotateSpeed;
    sphericalGoal.phi -= deltaY * rotateSpeed;
  }

  event.preventDefault();
  requestRender();
}

function handlePointerUp(event: PointerEvent) {
  if (!viewport) return;
  pointerState.isDragging = false;
  pointerState.axisLock = null;
  viewport.releasePointerCapture(event.pointerId);
  event.preventDefault();
  requestRender();
}

function handlePointerLeave() {
  pointerState.isDragging = false;
  pointerState.axisLock = null;
  requestRender();
}

function handleWheel(event: WheelEvent) {
  event.preventDefault();
  if (event.ctrlKey && viewport) {
    const zoomFactor = Math.exp(event.deltaY * 0.0015);

    const rect = viewport.getBoundingClientRect();
    pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    raycaster.setFromCamera(pointerNdc, camera);
    zoomPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(tempVector), orbitTarget);
    const intersection = raycaster.ray.intersectPlane(zoomPlane, zoomFocus);
    const focusPoint = intersection ?? orbitTarget;

    camera.position.sub(focusPoint).multiplyScalar(zoomFactor).add(focusPoint);
    orbitTarget.sub(focusPoint).multiplyScalar(zoomFactor).add(focusPoint);

    targetOffset.subVectors(camera.position, orbitTarget);
    if (targetOffset.lengthSq() === 0) {
      targetOffset.set(0, 0, defaultDistance);
    }

    setOrbitFromVector(sphericalGoal, targetOffset);
    sphericalGoal.makeSafe();
    sphericalGoal.radius = THREE.MathUtils.clamp(sphericalGoal.radius, minDistance, maxDistance);

    spherical.copy(sphericalGoal);
    spherical.makeSafe();
    updateCamera(true);
  } else {
    const delta = event.deltaY * 0.01;
    sphericalGoal.radius = THREE.MathUtils.clamp(
      sphericalGoal.radius + delta,
      minDistance,
      maxDistance
    );
  }
  requestRender();
}

function renderLoop() {
  const cameraChanged = updateCamera();
  if (needsRender || cameraChanged) {
    renderer.render(scene, camera);
    needsRender = false;
  }

  if (!cameraChanged && !needsRender) {
    renderer.setAnimationLoop(null);
    renderLoopActive = false;
  }
}

function requestRender() {
  needsRender = true;
  if (!renderLoopActive) {
    renderLoopActive = true;
    renderer.setAnimationLoop(renderLoop);
  }
}

onMounted(() => {
  const canvas = container.value!;
  canvas.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "none";

  viewport = renderer.domElement;

  viewport.addEventListener("pointerdown", handlePointerDown);
  viewport.addEventListener("pointermove", handlePointerMove);
  viewport.addEventListener("pointerup", handlePointerUp);
  viewport.addEventListener("pointerleave", handlePointerLeave);
  viewport.addEventListener("wheel", handleWheel, { passive: false });

  window.addEventListener("resize", handleResize);
  updateCamera(true);
  requestRender();
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);

  if (viewport) {
    viewport.removeEventListener("pointerdown", handlePointerDown);
    viewport.removeEventListener("pointermove", handlePointerMove);
    viewport.removeEventListener("pointerup", handlePointerUp);
    viewport.removeEventListener("pointerleave", handlePointerLeave);
    viewport.removeEventListener("wheel", handleWheel);
  }
  viewport = null;

  if (butterfly.value) {
    butterfly.value.dispose();
  }

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  renderer.setAnimationLoop(null);
  renderLoopActive = false;

  const canvas = container.value!;
  renderer.dispose();
  canvas.removeChild(renderer.domElement);
});
</script>

<template>
  <div class="container" ref="container">
    <input
      ref="fileInput"
      type="file"
      accept=".ply"
      @change="handleFileSelect"
      style="display: none"
    />
    <button class="file-button" @click="triggerFileSelect">
      选择 PLY 文件
    </button>
    <button class="reset-button" @click="resetView">
      恢复默认视角
    </button>
  </div>
</template>

<style scoped>
.container {
  width: 100%;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  cursor: grab;
  user-select: none;
  position: relative;
}

.container:active {
  cursor: grabbing;
}

.file-button {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 500;
  color: white;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  transition: all 0.3s ease;
  z-index: 10;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.file-button:hover {
  transform: translateX(-50%) translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
}

.file-button:active {
  transform: translateX(-50%) translateY(0);
  box-shadow: 0 2px 10px rgba(102, 126, 234, 0.4);
}

.reset-button {
  position: absolute;
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  color: #444;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(118, 75, 162, 0.35);
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(118, 75, 162, 0.15);
  transition: all 0.3s ease;
  z-index: 9;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.reset-button:hover {
  background: rgba(255, 255, 255, 1);
  box-shadow: 0 5px 16px rgba(118, 75, 162, 0.25);
}

.reset-button:active {
  transform: translateX(-50%) translateY(1px);
  box-shadow: 0 2px 8px rgba(118, 75, 162, 0.2);
}
</style>
