import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { setOrbitFromVector, setVectorFromOrbit } from "./orbitMath";

type AxisLock = "horizontal" | "vertical" | null;
type ViewPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface ViewConfig {
  name: string;
  position: ViewPosition;
  thetaOffset: number;
  viewport: { x: number; y: number; width: number; height: number };
  camera: THREE.PerspectiveCamera;
}

export class SplatViewer {
  private readonly scene = new THREE.Scene();
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });

  private readonly views: ViewConfig[];
  private readonly viewByPosition = new Map<ViewPosition, ViewConfig>();
  private readonly primaryView: ViewConfig;

  private container: HTMLDivElement | null = null;
  private viewport: HTMLCanvasElement | null = null;

  private butterfly: SplatMesh | null = null;
  private currentObjectUrl: string | null = null;
  private currentLoadToken = 0;

  private readonly initialCameraDirection = new THREE.Vector3(0.75, 0.35, 1).normalize();
  private readonly defaultTarget = new THREE.Vector3(0, 0, 0);
  private readonly orbitTarget = new THREE.Vector3();
  private readonly defaultSpherical = new THREE.Spherical();
  private readonly spherical = new THREE.Spherical();
  private readonly sphericalGoal = new THREE.Spherical();

  private readonly cameraOffset = new THREE.Vector3();
  private readonly prevCameraPosition = new THREE.Vector3();
  private readonly prevCameraQuaternion = new THREE.Quaternion();

  private readonly pointerState = {
    isDragging: false,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    axisLock: null as AxisLock,
  };

  // Inertia state: angular velocity (rad/frame at 60fps baseline)
  private velocityTheta = 0;
  private velocityPhi = 0;
  private isSpinning = false;

  private readonly pointerNdc = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly zoomFocus = new THREE.Vector3();
  private readonly zoomPlane = new THREE.Plane();
  private readonly targetOffset = new THREE.Vector3();
  private readonly tempVector = new THREE.Vector3();
  private readonly tempSpherical = new THREE.Spherical();
  private readonly rendererSize = new THREE.Vector2();

  private defaultDistance = 4;
  private needsRender = true;
  private renderLoopActive = false;

  private readonly rotateSpeed = 0.003;
  private readonly dampingFactor = 0.15;
  private readonly minDistance = 0.3;
  private readonly maxDistance = 50;
  private readonly minPolarAngle = 0.02;
  private readonly maxPolarAngle = Math.PI - 0.02;
  private readonly axisLockThreshold = 1.5;

  constructor() {
    const pixelRatio = Math.min(window.devicePixelRatio ?? 1, 1.6);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);

    this.views = [
      this.createView("北 (+Y)", "top-left", Math.PI / 2, {
        x: 0,
        y: 0.5,
        width: 0.5,
        height: 0.5,
      }),
      this.createView("东 (+X)", "top-right", 0, {
        x: 0.5,
        y: 0.5,
        width: 0.5,
        height: 0.5,
      }),
      this.createView("西 (-X)", "bottom-left", Math.PI, {
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5,
      }),
      this.createView("南 (-Y)", "bottom-right", -Math.PI / 2, {
        x: 0.5,
        y: 0,
        width: 0.5,
        height: 0.5,
      }),
    ];

    this.primaryView = this.views.find((view) => view.thetaOffset === 0)!;

    this.syncRendererSize();
    this.orbitTarget.copy(this.defaultTarget);
    this.syncDefaultOrbit();
    this.resetView(true);
  }

  mount(container: HTMLDivElement) {
    this.container = container;
    this.viewport = this.renderer.domElement;
    this.viewport.style.touchAction = "none";
    this.container.appendChild(this.viewport);
    this.addViewportListeners();
    window.addEventListener("resize", this.handleResize);
    this.updateCamera(true);
    this.requestRender();
  }

  unmount() {
    window.removeEventListener("resize", this.handleResize);
    this.removeViewportListeners();
    this.viewport = null;

    this.disposeButterfly();
    this.disposeStaleMeshes();
    this.revokeCurrentObjectUrl();

    this.renderer.setAnimationLoop(null);
    this.renderLoopActive = false;
    this.needsRender = false;

    if (this.container?.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }

    this.renderer.dispose();
    this.container = null;
  }

  loadFile(file?: File | null) {
    const loadToken = ++this.currentLoadToken;
    this.disposeButterfly();
    this.disposeStaleMeshes();
    this.revokeCurrentObjectUrl();
    this.requestRender();

    if (!file) {
      return;
    }

    const url = URL.createObjectURL(file);
    this.currentObjectUrl = url;

    const newButterfly = new SplatMesh({ url });
    newButterfly.quaternion.set(0, 0, 0, 1);
    newButterfly.position.set(0, 0, 0);
    this.scene.add(newButterfly);
    this.butterfly = newButterfly;
    this.requestRender();

    newButterfly.initialized.then(() => {
      if (this.butterfly !== newButterfly || loadToken !== this.currentLoadToken) {
        return;
      }
      this.fitViewToMesh(newButterfly);
    });
  }

  resetView(immediate = false) {
    this.pointerState.isDragging = false;
    this.pointerState.axisLock = null;
    // Stop inertia
    this.isSpinning = false;
    this.velocityTheta = 0;
    this.velocityPhi = 0;

    this.orbitTarget.copy(this.defaultTarget);
    this.sphericalGoal.copy(this.defaultSpherical);
    if (immediate) {
      this.spherical.copy(this.defaultSpherical);
    }
    this.updateCamera(true);
    this.requestRender();
  }

  private createView(
    name: string,
    position: ViewPosition,
    thetaOffset: number,
    viewport: ViewConfig["viewport"]
  ): ViewConfig {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    const view: ViewConfig = {
      name,
      position,
      thetaOffset,
      viewport,
      camera,
    };
    this.viewByPosition.set(position, view);
    return view;
  }

  private addViewportListeners() {
    if (!this.viewport) return;
    this.viewport.addEventListener("pointerdown", this.handlePointerDown);
    this.viewport.addEventListener("pointermove", this.handlePointerMove);
    this.viewport.addEventListener("pointerup", this.handlePointerUp);
    this.viewport.addEventListener("pointerleave", this.handlePointerLeave);
    this.viewport.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  private removeViewportListeners() {
    if (!this.viewport) return;
    this.viewport.removeEventListener("pointerdown", this.handlePointerDown);
    this.viewport.removeEventListener("pointermove", this.handlePointerMove);
    this.viewport.removeEventListener("pointerup", this.handlePointerUp);
    this.viewport.removeEventListener("pointerleave", this.handlePointerLeave);
    this.viewport.removeEventListener("wheel", this.handleWheel);
  }

  private disposeButterfly() {
    if (!this.butterfly) return;
    this.scene.remove(this.butterfly);
    this.butterfly.dispose();
    this.butterfly = null;
  }

  private disposeStaleMeshes() {
    const staleMeshes: SplatMesh[] = [];
    for (const child of this.scene.children) {
      if (child instanceof SplatMesh && child !== this.butterfly) {
        staleMeshes.push(child);
      }
    }
    for (const mesh of staleMeshes) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
  }

  private revokeCurrentObjectUrl() {
    if (!this.currentObjectUrl) return;
    URL.revokeObjectURL(this.currentObjectUrl);
    this.currentObjectUrl = null;
  }

  private async fitViewToMesh(mesh: SplatMesh) {
    await mesh.initialized;
    const bbox = mesh.getBoundingBox();
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const boundingRadius = Math.max(maxDim, 0.01) * 0.5;
    const halfFov = THREE.MathUtils.degToRad(this.primaryView.camera.fov * 0.5);
    const fitDistance = boundingRadius / Math.sin(halfFov);

    this.defaultTarget.copy(center);
    this.orbitTarget.copy(center);
    this.defaultDistance = Math.max(fitDistance * 1.1, boundingRadius * 2);

    this.syncDefaultOrbit();
    this.resetView(true);
    this.requestRender();
  }

  private syncRendererSize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.syncViewAspects(width, height);
  }

  private syncViewAspects(width: number, height: number) {
    for (const view of this.views) {
      const viewWidth = Math.max(width * view.viewport.width, 1);
      const viewHeight = Math.max(height * view.viewport.height, 1);
      view.camera.aspect = viewWidth / viewHeight;
      view.camera.updateProjectionMatrix();
    }
  }

  private syncDefaultOrbit() {
    const offset = this.initialCameraDirection.clone().multiplyScalar(this.defaultDistance);
    setOrbitFromVector(this.defaultSpherical, offset);
    this.defaultSpherical.makeSafe();
    this.defaultSpherical.radius = this.defaultDistance;
    this.spherical.copy(this.defaultSpherical);
    this.sphericalGoal.copy(this.defaultSpherical);
    this.updateViewCameras();
  }

  private updateViewCameras() {
    for (const view of this.views) {
      this.tempSpherical.copy(this.spherical);
      this.tempSpherical.theta += view.thetaOffset;
      setVectorFromOrbit(this.tempSpherical, this.cameraOffset).add(this.orbitTarget);
      view.camera.position.copy(this.cameraOffset);
      view.camera.lookAt(this.orbitTarget);
    }
  }

  private updateCamera(immediate = false) {
    this.sphericalGoal.radius = THREE.MathUtils.clamp(
      this.sphericalGoal.radius,
      this.minDistance,
      this.maxDistance
    );
    this.sphericalGoal.phi = THREE.MathUtils.clamp(
      this.sphericalGoal.phi,
      this.minPolarAngle,
      this.maxPolarAngle
    );

    if (immediate) {
      this.spherical.copy(this.sphericalGoal);
    } else {
      const thetaBefore = this.spherical.theta;
      const phiBefore = this.spherical.phi;
      const radiusBefore = this.spherical.radius;
      this.spherical.theta += (this.sphericalGoal.theta - this.spherical.theta) * this.dampingFactor;
      this.spherical.phi += (this.sphericalGoal.phi - this.spherical.phi) * this.dampingFactor;
      this.spherical.radius += (this.sphericalGoal.radius - this.spherical.radius) * this.dampingFactor;
      const thetaDiff = Math.abs(this.spherical.theta - thetaBefore);
      const phiDiff = Math.abs(this.spherical.phi - phiBefore);
      const radiusDiff = Math.abs(this.spherical.radius - radiusBefore);
      if (thetaDiff < 1e-6 && phiDiff < 1e-6 && radiusDiff < 1e-5) {
        this.spherical.copy(this.sphericalGoal);
      }
    }

    this.spherical.makeSafe();

    this.prevCameraPosition.copy(this.primaryView.camera.position);
    this.prevCameraQuaternion.copy(this.primaryView.camera.quaternion);

    this.updateViewCameras();

    const positionChanged =
      this.prevCameraPosition.distanceToSquared(this.primaryView.camera.position) > 1e-10;
    const quaternionDot = Math.abs(this.prevCameraQuaternion.dot(this.primaryView.camera.quaternion));
    const rotationChanged = 1 - quaternionDot > 1e-10;

    const animating =
      Math.abs(this.sphericalGoal.theta - this.spherical.theta) > 1e-5 ||
      Math.abs(this.sphericalGoal.phi - this.spherical.phi) > 1e-5 ||
      Math.abs(this.sphericalGoal.radius - this.spherical.radius) > 1e-4;

    return immediate || positionChanged || rotationChanged || animating;
  }

  private requestRender() {
    this.needsRender = true;
    if (!this.renderLoopActive) {
      this.renderLoopActive = true;
      this.renderer.setAnimationLoop(this.renderLoop);
    }
  }

  private renderLoop = () => {
    // Apply inertia velocity (constant angular velocity, no friction)
    if (this.isSpinning && !this.pointerState.isDragging) {
      this.sphericalGoal.theta += this.velocityTheta;
      this.sphericalGoal.phi += this.velocityPhi;
      // Clamp phi to prevent flipping
      this.sphericalGoal.phi = THREE.MathUtils.clamp(
        this.sphericalGoal.phi,
        this.minPolarAngle,
        this.maxPolarAngle
      );
    }

    const cameraChanged = this.updateCamera();
    const spinning = this.isSpinning && !this.pointerState.isDragging;

    if (this.needsRender || cameraChanged || spinning) {
      this.renderer.clear();
      for (const view of this.views) {
        this.renderView(view);
      }
      this.needsRender = false;
    }

    if (!cameraChanged && !this.needsRender && !spinning) {
      this.renderer.setAnimationLoop(null);
      this.renderLoopActive = false;
    }
  };

  private renderView(view: ViewConfig) {
    this.renderer.getSize(this.rendererSize);
    const width = Math.max(Math.floor(this.rendererSize.x * view.viewport.width), 1);
    const height = Math.max(Math.floor(this.rendererSize.y * view.viewport.height), 1);
    const x = Math.floor(this.rendererSize.x * view.viewport.x);
    const y = Math.floor(this.rendererSize.y * view.viewport.y);

    this.renderer.setViewport(x, y, width, height);
    this.renderer.setScissor(x, y, width, height);
    this.renderer.render(this.scene, view.camera);
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (!this.viewport) return;
    // Stop any existing inertia spin
    this.isSpinning = false;
    this.velocityTheta = 0;
    this.velocityPhi = 0;

    this.pointerState.isDragging = true;
    this.pointerState.lastX = event.clientX;
    this.pointerState.lastY = event.clientY;
    this.pointerState.lastTime = performance.now();
    this.pointerState.axisLock = null;
    this.viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.requestRender();
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.pointerState.isDragging) return;
    const now = performance.now();
    const dt = Math.max(now - this.pointerState.lastTime, 1); // ms
    const deltaX = event.clientX - this.pointerState.lastX;
    const deltaY = event.clientY - this.pointerState.lastY;
    this.pointerState.lastX = event.clientX;
    this.pointerState.lastY = event.clientY;
    this.pointerState.lastTime = now;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (!this.pointerState.axisLock) {
      if (absX > absY * this.axisLockThreshold) {
        this.pointerState.axisLock = "horizontal";
      } else if (absY > absX * this.axisLockThreshold) {
        this.pointerState.axisLock = "vertical";
      }
    }

    // Calculate angular change
    const dTheta = -deltaX * this.rotateSpeed;
    const dPhi = -deltaY * this.rotateSpeed;

    // Update velocity (smoothed, convert to rad/frame at ~16.67ms per frame)
    const frameTime = 16.67;
    const velocitySmooth = 0.3;
    if (this.pointerState.axisLock === "horizontal") {
      this.sphericalGoal.theta += dTheta;
      this.velocityTheta = this.velocityTheta * (1 - velocitySmooth) + (dTheta / dt) * frameTime * velocitySmooth;
      this.velocityPhi = 0;
    } else if (this.pointerState.axisLock === "vertical") {
      this.sphericalGoal.phi += dPhi;
      this.velocityPhi = this.velocityPhi * (1 - velocitySmooth) + (dPhi / dt) * frameTime * velocitySmooth;
      this.velocityTheta = 0;
    } else {
      this.sphericalGoal.theta += dTheta;
      this.sphericalGoal.phi += dPhi;
      this.velocityTheta = this.velocityTheta * (1 - velocitySmooth) + (dTheta / dt) * frameTime * velocitySmooth;
      this.velocityPhi = this.velocityPhi * (1 - velocitySmooth) + (dPhi / dt) * frameTime * velocitySmooth;
    }

    event.preventDefault();
    this.requestRender();
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (!this.viewport) return;
    this.pointerState.isDragging = false;
    this.pointerState.axisLock = null;
    this.viewport.releasePointerCapture(event.pointerId);
    event.preventDefault();

    // Start inertia spin if there's enough velocity
    const minVelocity = 0.0005;
    if (Math.abs(this.velocityTheta) > minVelocity || Math.abs(this.velocityPhi) > minVelocity) {
      this.isSpinning = true;
    }

    this.requestRender();
  };

  private handlePointerLeave = () => {
    if (this.pointerState.isDragging) {
      // Start inertia spin if there's enough velocity
      const minVelocity = 0.0005;
      if (Math.abs(this.velocityTheta) > minVelocity || Math.abs(this.velocityPhi) > minVelocity) {
        this.isSpinning = true;
      }
    }
    this.pointerState.isDragging = false;
    this.pointerState.axisLock = null;
    this.requestRender();
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    // Stop inertia spin when zooming
    this.isSpinning = false;
    this.velocityTheta = 0;
    this.velocityPhi = 0;

    const targetView = this.getViewFromPointer(event.clientX, event.clientY) ?? this.primaryView;

    if (event.ctrlKey && this.viewport) {
      if (!this.updatePointerNdcForView(event, targetView)) {
        return;
      }

      this.raycaster.setFromCamera(this.pointerNdc, targetView.camera);
      this.zoomPlane.setFromNormalAndCoplanarPoint(
        targetView.camera.getWorldDirection(this.tempVector),
        this.orbitTarget
      );
      const intersection = this.raycaster.ray.intersectPlane(this.zoomPlane, this.zoomFocus);
      const focusPoint = intersection ?? this.orbitTarget;

      const zoomFactor = Math.exp(event.deltaY * 0.0015);

      this.cameraOffset.subVectors(targetView.camera.position, focusPoint);
      this.cameraOffset.multiplyScalar(zoomFactor).add(focusPoint);
      targetView.camera.position.copy(this.cameraOffset);

      this.orbitTarget.sub(focusPoint).multiplyScalar(zoomFactor).add(focusPoint);

      this.targetOffset.subVectors(targetView.camera.position, this.orbitTarget);
      if (this.targetOffset.lengthSq() === 0) {
        this.targetOffset.set(0, 0, this.defaultDistance);
      }

      setOrbitFromVector(this.tempSpherical, this.targetOffset);
      this.tempSpherical.theta -= targetView.thetaOffset;
      this.tempSpherical.makeSafe();

      this.sphericalGoal.radius = THREE.MathUtils.clamp(
        this.tempSpherical.radius,
        this.minDistance,
        this.maxDistance
      );
      this.sphericalGoal.theta = this.tempSpherical.theta;
      this.sphericalGoal.phi = this.tempSpherical.phi;

      this.spherical.copy(this.sphericalGoal);
      this.spherical.makeSafe();
      this.updateCamera(true);
    } else {
      const delta = event.deltaY * 0.01;
      this.sphericalGoal.radius = THREE.MathUtils.clamp(
        this.sphericalGoal.radius + delta,
        this.minDistance,
        this.maxDistance
      );
    }
    this.requestRender();
  };

  private getViewFromPointer(clientX: number, clientY: number) {
    if (!this.viewport) {
      return this.primaryView;
    }
    const rect = this.viewport.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return this.primaryView;
    }
    const normalizedX = (clientX - rect.left) / rect.width;
    const normalizedY = (clientY - rect.top) / rect.height;
    const isLeft = normalizedX < 0.5;
    const isTop = normalizedY < 0.5;

    if (isTop && isLeft) return this.viewByPosition.get("top-left");
    if (isTop && !isLeft) return this.viewByPosition.get("top-right");
    if (!isTop && isLeft) return this.viewByPosition.get("bottom-left");
    return this.viewByPosition.get("bottom-right");
  }

  private updatePointerNdcForView(event: WheelEvent, view: ViewConfig) {
    if (!this.viewport) return false;
    const rect = this.viewport.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const viewWidth = Math.max(rect.width * view.viewport.width, 1);
    const viewHeight = Math.max(rect.height * view.viewport.height, 1);
    const left = rect.left + rect.width * view.viewport.x;
    const top = rect.top + rect.height * (1 - view.viewport.y - view.viewport.height);

    const localX = THREE.MathUtils.clamp((event.clientX - left) / viewWidth, 0, 1);
    const localY = THREE.MathUtils.clamp((event.clientY - top) / viewHeight, 0, 1);

    this.pointerNdc.set(localX * 2 - 1, -(localY * 2 - 1));
    return true;
  }

  private handleResize = () => {
    this.syncRendererSize();
    this.requestRender();
  };
}

