import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { OBJLoader } from "three-stdlib";
import { MTLLoader } from "three-stdlib";
import { setOrbitFromVector, setVectorFromOrbit } from "./orbitMath";

type AxisLock = "horizontal" | "vertical" | null;
type ViewPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface ViewConfig {
  name: string;
  position: ViewPosition;
  thetaOffset: number;
  viewport: { x: number; y: number; width: number; height: number };
  camera: THREE.PerspectiveCamera;
  screenRotation: number;
}

export class SplatViewer {
  private readonly scene = new THREE.Scene();
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });

  private views!: ViewConfig[];
  private readonly viewByPosition = new Map<ViewPosition, ViewConfig>();
  private primaryView!: ViewConfig;

  private container: HTMLDivElement | null = null;
  private viewport: HTMLCanvasElement | null = null;

  private model: THREE.Object3D | null = null;
  private currentObjectUrl: string | null = null;
  private currentLoadToken = 0;

  // Lights for OBJ models
  private readonly ambientLight: THREE.AmbientLight;
  private readonly directionalLight1: THREE.DirectionalLight;
  private readonly directionalLight2: THREE.DirectionalLight;
  private readonly directionalLight3: THREE.DirectionalLight;

  // Pony Care System
  private particleSystem: THREE.Points | null = null;
  private particleVelocities: Float32Array | null = null;
  private currentEnergy = 1.0;
  // Store original colors/intensities to restore/lerp
  private originalMaterials = new Map<THREE.Material, { color: THREE.Color, emissive?: THREE.Color }>();
  private baseScale = new THREE.Vector3(1, 1, 1);
  private basePosition = new THREE.Vector3(0, 0, 0);
  private eyeMaterial: THREE.MeshStandardMaterial | null = null;
  private currentCharacter: 'twilight' | 'pinkie' | 'unknown' = 'unknown';
  
  // Animation Uniforms
  private globalUniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uSway: { value: 0 },
    uCharacterType: { value: 0 } // 0: unknown, 1: twilight, 2: pinkie
  };

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


  constructor() {
    const pixelRatio = Math.min(window.devicePixelRatio ?? 1, 1.6);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);

    // Setup lighting for OBJ models
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight1.position.set(5, 5, 5);
    this.scene.add(this.directionalLight1);

    this.directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    this.directionalLight2.position.set(-5, 3, -5);
    this.scene.add(this.directionalLight2);

    this.directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.3);
    this.directionalLight3.position.set(0, -5, 0);
    this.scene.add(this.directionalLight3);

    this.initParticles();

    this.setupSingleView();
    // Default to single view
    
    this.syncRendererSize();
    this.orbitTarget.copy(this.defaultTarget);
    this.syncDefaultOrbit();
    this.resetView(true);
  }

  setupQuadViews() {
    this.views = [
      this.createView("北 (+Y)", "top-left", Math.PI / 2, {
        x: 0,
        y: 0.5,
        width: 0.5,
        height: 0.5,
      }, -Math.PI / 4),
      
      this.createView("东 (+X)", "top-right", 0, {
        x: 0.5,
        y: 0.5,
        width: 0.5,
        height: 0.5,
      }, Math.PI / 4),
      
      this.createView("西 (-X)", "bottom-left", Math.PI, {
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5,
      }, -3 * Math.PI / 4),
      
      this.createView("南 (-Y)", "bottom-right", -Math.PI / 2, {
        x: 0.5,
        y: 0,
        width: 0.5,
        height: 0.5,
      }, 3 * Math.PI / 4),
    ];
    this.primaryView = this.views.find((view) => view.thetaOffset === 0)!;
    this.syncRendererSize(); // Update aspect ratios
  }

  setupSingleView() {
    // Create a single view looking from South (Front) but without rotation
    // Or use East view (theta 0) as primary? 
    // Usually Theta 0 is East (+X).
    // Let's use standard Front view which might correspond to -Y or +Y depending on model.
    // In our quad setup:
    // South (-Y) is theta -PI/2.
    // Let's use South view as the single view, but fill screen and no rotation.
    
    this.views = [
      this.createView("主视图", "bottom-right", -Math.PI / 2, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }, 0) // No rotation
    ];
    this.primaryView = this.views[0]!;
    this.syncRendererSize();
  }

  setViewMode(mode: 'quad' | 'single') {
    if (mode === 'quad') {
      this.setupQuadViews();
    } else {
      this.setupSingleView();
    }
    this.updateCamera(true);
    this.requestRender();
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

    this.disposeModel();
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
    this.disposeModel();
    this.disposeStaleMeshes();
    this.revokeCurrentObjectUrl();
    this.requestRender();

    if (!file) {
      return;
    }

    const url = URL.createObjectURL(file);
    this.currentObjectUrl = url;
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.ply')) {
      this.loadPlyFile(url, loadToken);
    } else if (fileName.endsWith('.obj')) {
      this.loadObjFile(url, loadToken);
    } else {
      console.error("Unsupported file format. Please use .ply or .obj files.");
      this.revokeCurrentObjectUrl();
    }
  }

  loadFromUrl(url: string) {
    const loadToken = ++this.currentLoadToken;
    this.disposeModel();
    this.disposeStaleMeshes();
    this.revokeCurrentObjectUrl();
    this.requestRender();

    const fileName = url.toLowerCase();

    if (fileName.endsWith('.ply')) {
      this.loadPlyFile(url, loadToken);
    } else if (fileName.endsWith('.obj')) {
      this.loadObjWithMtl(url, loadToken);
    } else {
      console.error("Unsupported file format. Please use .ply or .obj files.");
    }
  }

  private loadPlyFile(url: string, loadToken: number) {
    const newModel = new SplatMesh({ url });
    newModel.quaternion.set(0, 0, 0, 1);
    newModel.position.set(0, 0, 0);
    this.scene.add(newModel);
    this.model = newModel;
    this.requestRender();

    newModel.initialized.then(() => {
      if (this.model !== newModel || loadToken !== this.currentLoadToken) {
        return;
      }
      this.fitViewToModel(newModel);
    });
  }

  private async loadObjFile(url: string, loadToken: number) {
    try {
      const objResponse = await fetch(url);
      const objText = await objResponse.text();

      // Load the OBJ file
      const objLoader = new OBJLoader();
      const newModel = objLoader.parse(objText);
      
      // Apply default materials with good lighting response
      newModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Replace any existing material with a well-lit standard material
          const material = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.5,
            metalness: 0.1,
            side: THREE.DoubleSide,
          });
          child.material = material;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      newModel.quaternion.set(0, 0, 0, 1);
      newModel.position.set(0, 0, 0);
      
      // Scale appropriately - OBJ files often use centimeters
      const bbox = new THREE.Box3().setFromObject(newModel);
      const size = bbox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 10) {
        const scale = 10 / maxDim;
        newModel.scale.set(scale, scale, scale);
      }
      
      this.scene.add(newModel);
      this.model = newModel;
      this.captureOriginalMaterials(newModel); // Capture materials for energy system
      this.requestRender();
      
      if (this.model === newModel && loadToken === this.currentLoadToken) {
        this.fitViewToModel(newModel);
      }
    } catch (error) {
      console.error("Error loading OBJ file:", error);
    }
  }

  private async loadObjWithMtl(url: string, loadToken: number) {
    // Detect Character
    if (url.toLowerCase().includes('twilight')) {
      this.currentCharacter = 'twilight';
    } else if (url.toLowerCase().includes('pinkie')) {
      this.currentCharacter = 'pinkie';
    } else {
      this.currentCharacter = 'unknown';
    }

    try {
      // Get the base path for loading MTL and textures
      const basePath = url.substring(0, url.lastIndexOf('/') + 1);
      
      // Load the OBJ file first to check for MTL reference
      const objResponse = await fetch(url);
      const objText = await objResponse.text();

      // Check if the OBJ file references an MTL file
      const mtlMatch = objText.match(/^mtllib\s+(.+)$/m);
      let materials: ReturnType<MTLLoader['parse']> | undefined;

      if (mtlMatch) {
        const mtlFilename = mtlMatch[1]!.trim();
        const mtlUrl = basePath + mtlFilename;
        
        try {
          const mtlLoader = new MTLLoader();
          mtlLoader.setPath(basePath);
          
          const mtlResponse = await fetch(mtlUrl);
          const mtlText = await mtlResponse.text();
          materials = mtlLoader.parse(mtlText, basePath);
          materials.preload();
        } catch (e) {
          console.warn("Could not load MTL file, using default materials", e);
        }
      }

      // Load the OBJ file
      const objLoader = new OBJLoader();
      if (materials) {
        objLoader.setMaterials(materials);
      }
      
      const newModel = objLoader.parse(objText);
      
      // If no materials were loaded, apply default materials
      if (!materials) {
        newModel.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const material = new THREE.MeshStandardMaterial({
              color: 0xcccccc,
              roughness: 0.5,
              metalness: 0.1,
              side: THREE.DoubleSide,
            });
            child.material = material;
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
      } else {
        // Ensure materials are properly configured for lighting
        newModel.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach((mat) => {
                  mat.side = THREE.DoubleSide;
                });
              } else {
                child.material.side = THREE.DoubleSide;
              }
            }
          }
        });
      }

      newModel.quaternion.set(0, 0, 0, 1);
      newModel.position.set(0, 0, 0);
      
      // Scale appropriately - OBJ files often use centimeters
      const bbox = new THREE.Box3().setFromObject(newModel);
      const size = bbox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 10) {
        const scale = 10 / maxDim;
        newModel.scale.set(scale, scale, scale);
      }
      
      this.scene.add(newModel);
      this.model = newModel;
      this.captureOriginalMaterials(newModel); // Capture materials for energy system
      this.requestRender();
      
      if (this.model === newModel && loadToken === this.currentLoadToken) {
        this.fitViewToModel(newModel);
      }
    } catch (error) {
      console.error("Error loading OBJ file with MTL:", error);
    }
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
    viewport: ViewConfig["viewport"],
    screenRotation: number = 0
  ): ViewConfig {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    const view: ViewConfig = {
      name,
      position,
      thetaOffset,
      viewport,
      camera,
      screenRotation,
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

  private disposeModel() {
    if (!this.model) return;
    this.scene.remove(this.model);
    if (this.model instanceof SplatMesh) {
      this.model.dispose();
    } else {
      // Dispose of materials and geometries for regular Object3D
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
    }
    this.model = null;
  }

  private disposeStaleMeshes() {
    const staleObjects: THREE.Object3D[] = [];
    for (const child of this.scene.children) {
      if (child !== this.model && (child instanceof SplatMesh || child.type === "Group" || child instanceof THREE.Mesh)) {
        staleObjects.push(child);
      }
    }
    for (const obj of staleObjects) {
      this.scene.remove(obj);
      if (obj instanceof SplatMesh) {
        obj.dispose();
      } else {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach((mat) => mat.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
      }
    }
  }

  private revokeCurrentObjectUrl() {
    if (!this.currentObjectUrl) return;
    URL.revokeObjectURL(this.currentObjectUrl);
    this.currentObjectUrl = null;
  }

  private async fitViewToModel(model: THREE.Object3D) {
    // Wait for initialization if it's a SplatMesh
    if (model instanceof SplatMesh) {
      await model.initialized;
    }
    
    // Calculate bounding box
    let bbox: THREE.Box3;
    if (model instanceof SplatMesh) {
      bbox = model.getBoundingBox();
    } else {
      bbox = new THREE.Box3().setFromObject(model);
    }
    
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const boundingRadius = Math.max(maxDim, 0.01) * 0.5;
    const halfFov = THREE.MathUtils.degToRad(this.primaryView.camera.fov * 0.5);
    const fitDistance = boundingRadius / Math.sin(halfFov);

    this.defaultTarget.copy(center);
    this.orbitTarget.copy(center);
    this.defaultDistance = Math.max(fitDistance * 1.5, boundingRadius * 3);

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

      if (view === this.primaryView) {
        // For primary view, we trust the camera's rotation (set by rotateCamera) to be exact.
        // We only apply the radius (zoom) from spherical to allow damping.
        // overwriting position from spherical would cause jitter due to lossy Pos->Spherical->Pos conversion.
        const currentDir = new THREE.Vector3().copy(view.camera.position).sub(this.orbitTarget).normalize();
        if (currentDir.lengthSq() > 0.0001) { // Avoid zero vector
           view.camera.position.copy(this.orbitTarget).add(currentDir.multiplyScalar(this.spherical.radius));
           // No lookAt() needed - orientation is preserved from rotateCamera
        }
      } else {
        // Quad views follow the spherical coordinates strictly
        setVectorFromOrbit(this.tempSpherical, this.cameraOffset).add(this.orbitTarget);
        view.camera.position.copy(this.cameraOffset);
        
        // Reset up vector and look at target
        view.camera.up.set(0, 0, 1);
        view.camera.lookAt(this.orbitTarget);
      }
      
      // Apply screen space rotation (Roll) around the local Z axis
      if (view.screenRotation !== 0) {
        view.camera.rotateZ(view.screenRotation);
      }
    }
  }

  /**
   * Rotate camera using Quaternions to allow free rotation through poles.
   * Updates Position and Up-vector, then syncs Spherical state.
   */
  private rotateCamera(dTheta: number, dPhi: number) {
    const camera = this.primaryView.camera;
    const offset = new THREE.Vector3().copy(camera.position).sub(this.orbitTarget);

    // 1. Yaw (horizontal) around World Z
    // Note: dTheta is usually negative for drag-left
    const quatYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), dTheta);
    offset.applyQuaternion(quatYaw);
    camera.up.applyQuaternion(quatYaw);

    // 2. Pitch (vertical) around Camera Right
    // Right = Forward x Up. Forward = -offset
    const forward = offset.clone().negate().normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    
    const quatPitch = new THREE.Quaternion().setFromAxisAngle(right, dPhi);
    offset.applyQuaternion(quatPitch);
    camera.up.applyQuaternion(quatPitch);

    // Apply
    camera.position.copy(this.orbitTarget).add(offset);
    camera.lookAt(this.orbitTarget);

    // Sync spherical state (for other logic) - phi will be wrapped to [0, pi] automatically
    // but that's fine since we drive motion from Camera now.
    setOrbitFromVector(this.spherical, offset);
    this.sphericalGoal.copy(this.spherical);
  }

  private updateCamera(immediate = false) {
    this.sphericalGoal.radius = THREE.MathUtils.clamp(
      this.sphericalGoal.radius,
      this.minDistance,
      this.maxDistance
    );
    // Wrap phi through poles (reflect + theta shift) so vertical rotation is never stuck
    while (this.sphericalGoal.phi < this.minPolarAngle || this.sphericalGoal.phi > this.maxPolarAngle) {
      if (this.sphericalGoal.phi < this.minPolarAngle) {
        this.sphericalGoal.phi = 2 * this.minPolarAngle - this.sphericalGoal.phi;
        this.sphericalGoal.theta += Math.PI;
      }
      if (this.sphericalGoal.phi > this.maxPolarAngle) {
        this.sphericalGoal.phi = 2 * this.maxPolarAngle - this.sphericalGoal.phi;
        this.sphericalGoal.theta += Math.PI;
      }
    }

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

    // Note: removed makeSafe() to avoid re-clamping phi after pole wrapping

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
    // Update Uniforms
    // Use performance.now() instead of Date.now() for GPU float precision.
    // Date.now()*0.001 gives ~1.7e9 which exceeds 32-bit float precision (~7 digits),
    // causing spatial noise functions in shaders to produce uniform values.
    const time = performance.now() * 0.001;
    this.globalUniforms.uTime.value = time;
    
    // Animate Eyes (Twilight)
    if (this.eyeMaterial && this.eyeMaterial.map) {
      let targetX = 0;
      let targetY = 0;
      
      if (this.pointerState.isDragging) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        // Look at pointer
        targetX = (this.pointerState.lastX / width - 0.5) * 0.15;
        targetY = (this.pointerState.lastY / height - 0.5) * 0.15;
      } else {
        // Idle: Occasional blinking or saccades could go here
        // For now, return to center
      }
      
      const currentX = this.eyeMaterial.map.offset.x;
      const currentY = this.eyeMaterial.map.offset.y;
      // Smoothly follow
      this.eyeMaterial.map.offset.x += (targetX - currentX) * 0.1;
      this.eyeMaterial.map.offset.y += (targetY - currentY) * 0.1;
    }
    
    // Animate Particles
    if (this.particleSystem && this.particleVelocities) {
      const positions = this.particleSystem.geometry.attributes.position!.array as Float32Array;
      const count = positions.length / 3;
      const time = performance.now() * 0.001;
      
      // Speed scales with energy
      const speedScale = 0.2 + this.currentEnergy * 0.8;
      
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        
        // Circular motion + vertical drift
        // Simple orbit logic:
        const x = positions[i3]!;
        const y = positions[i3 + 1]!;
        const z = positions[i3 + 2]!; // Z is up in our world
        
        // Orbit around Z axis
        const speed = this.particleVelocities![i]! * speedScale;
        const radius = Math.sqrt(x*x + y*y);
        const angle = Math.atan2(y, x) + speed * 0.01;
        
        positions[i3] = Math.cos(angle) * radius;
        positions[i3 + 1] = Math.sin(angle) * radius;
        
        // Gentle vertical bobbing
        positions[i3 + 2] = z + Math.sin(time + i) * 0.002 * speedScale;
      }
      
      this.particleSystem.geometry.attributes.position!.needsUpdate = true;
      
      // Request render if particles are visible (energy > 0)
      if (this.currentEnergy > 0.01) {
        this.needsRender = true;
      }
    }

    // Apply inertia velocity (constant angular velocity, no friction)
    if (this.isSpinning && !this.pointerState.isDragging) {
      // Use quaternion rotation for frictionless inertia
      this.rotateCamera(this.velocityTheta, this.velocityPhi);
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

    // Calculate angular change
    const dTheta = -deltaX * this.rotateSpeed;
    const dPhi = -deltaY * this.rotateSpeed;

    // Rotate camera directly (free orbit)
    this.rotateCamera(dTheta, dPhi);

    // Update velocity (smoothed, convert to rad/frame at ~16.67ms per frame)
    const frameTime = 16.67;
    const velocitySmooth = 0.3;
    this.velocityTheta = this.velocityTheta * (1 - velocitySmooth) + (dTheta / dt) * frameTime * velocitySmooth;
    this.velocityPhi = this.velocityPhi * (1 - velocitySmooth) + (dPhi / dt) * frameTime * velocitySmooth;
    
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

  private initParticles() {
    const particleCount = 100;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount);
    const seeds = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      // Random position in a sphere/shell
      const r = 2 + Math.random() * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      
      velocities[i] = (Math.random() - 0.5) * 2; // Random orbit speed
      seeds[i] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    this.particleVelocities = velocities;

    const texture = this.createParticleTexture();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.globalUniforms.uTime,
        uEnergy: this.globalUniforms.uEnergy,
        uCharacterType: this.globalUniforms.uCharacterType,
        uTexture: { value: texture },
        uPointSize: { value: 0.3 },
        // Adjust this value to change breathing speed globally (Default: 2.5)
        uBreathSpeed: { value: 10  }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uEnergy;
        uniform float uCharacterType;
        uniform float uPointSize;
        attribute float seed;
        varying float vSeed;

        void main() {
          vSeed = seed;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          
          // Size scales with energy
          float size = uPointSize * (0.2 + uEnergy * 1.5);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uEnergy;
        uniform float uCharacterType;
        uniform float uBreathSpeed; // Controls breathing speed
        uniform sampler2D uTexture;
        varying float vSeed;

        // HSV to RGB helper
        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }

        // Pseudo-random hash for firefly flicker
        float hash(float n) {
          return fract(sin(n) * 43758.5453123);
        }

        void main() {
          vec4 texColor = texture2D(uTexture, gl_PointCoord);
          if (texColor.a < 0.01) discard;

          vec3 baseColor;
          
          if (uCharacterType == 1.0) {
            // Twilight: Ultra-saturated Magical Purple
            // Hue 0.78 (Purple/Violet), Saturation 1.0 (Pure), Value 1.5 (HDR/Neon)
            baseColor = hsv2rgb(vec3(0.78, 1.0, 1.5)); 
          } else if (uCharacterType == 2.0) {
            // Pinkie Pie: Each particle independently switches between 7 rainbow colors
            // Each particle has its own switching rate and phase (i.i.d. random)
            float rate = 1.0 + hash(vSeed * 7.0) * 4.0;   // 1–5 Hz per particle
            float phase = hash(vSeed * 13.0) * 100.0;      // random phase offset
            float timeSlot = floor(uTime * rate + phase);
            float rnd = hash(timeSlot + vSeed * 1000.0);   // large spread for decorrelation
            
            // Quantize to 7 hues: Red, Orange, Yellow, Green, Cyan, Blue, Violet
            float hue = floor(rnd * 7.0) / 7.0;
            baseColor = hsv2rgb(vec3(hue, 1.0, 1.0));
          } else {
            // Default: Warm Gold
            baseColor = vec3(1.0, 0.8, 0.5);
          }

          // Firefly breathing: each particle fades in and out independently
          // Smooth sine wave instead of erratic flicker
          // Rate: modulated by uBreathSpeed
          float breathRate = 0.8 + hash(vSeed * 33.3) * 1.2;
          float breathPhase = hash(vSeed * 55.5) * 10.0;
          
          // Full range sine wave [0, 1], speed controlled by uBreathSpeed
          float breathRaw = 0.5 + 0.5 * sin(uTime * uBreathSpeed * breathRate + breathPhase);
          
          // Apply power curve to make "on" pulses more distinct against "off"
          // breath^2 makes the low values lower and high values sharper
          float breath = breathRaw * breathRaw;

          // Max brightness scales with energy much more aggressively
          float maxBrightness = 0.5 + uEnergy * 5.0;
          float brightness = breath * maxBrightness;
          
          // --- Magic Spark Effect for Twilight ---
          if (uCharacterType == 1.0) {
             // Create "clusters" of sparks: occasional high-frequency bursts
             // Main spark trigger
             float sparkTime = uTime * (uBreathSpeed * 2.0) + vSeed * 500.0;
             // Sharp spike function
             float spark = pow(max(0.0, sin(sparkTime)), 30.0);
             
             // Modulate sparks to happen in clusters over time
             float cluster = 0.5 + 0.5 * sin(uTime * 0.5 + vSeed * 10.0);
             
             if (cluster > 0.7) { // Only spark during active cluster phases
                 brightness += spark * 8.0; // Intense burst
                 
                 // Whiten the core of the spark (magic glow)
                 float whitener = clamp(spark * 0.8, 0.0, 1.0);
                 baseColor = mix(baseColor, vec3(1.5, 1.2, 1.5), whitener);
             }
          }

          // Alpha also breathed, so they disappear completely at low point
          float alpha = texColor.a * clamp(uEnergy * 2.0, 0.0, 1.0) * breath;
          
          gl_FragColor = vec4(baseColor * brightness, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particleSystem = new THREE.Points(geometry, material);
    this.scene.add(this.particleSystem);
  }

  private createParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.5)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 32, 32);
    }
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  private captureOriginalMaterials(model: THREE.Object3D) {
    this.originalMaterials.clear();
    
    // Capture base transform
    this.baseScale.copy(model.scale);
    this.basePosition.copy(model.position);

    // Calculate Bounding Box (in Local Space) to determine "Legs" area
    // Since model.scale applies to the whole group, we need to unscale the bbox
    // or calculate it from geometries directly.
    const bbox = new THREE.Box3();
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
        bbox.union(child.geometry.boundingBox!);
      }
    });
    
    const height = bbox.max.y - bbox.min.y;
    const minY = bbox.min.y;
    console.log("Model Local BBox Y:", minY, "to", bbox.max.y, "Height:", height);

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material;
        const processMaterial = (m: THREE.Material) => {
           if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial || m instanceof THREE.MeshPhongMaterial) {
             this.originalMaterials.set(m, {
               color: m.color.clone(),
               emissive: 'emissive' in m ? (m as THREE.MeshStandardMaterial).emissive?.clone() : undefined
             });

             // Inject Leg Sway Shader & Saturation Boost
             m.onBeforeCompile = (shader) => {
               // Link uniforms object reference
               shader.uniforms.uTime = this.globalUniforms.uTime;
               shader.uniforms.uSway = this.globalUniforms.uSway;
               shader.uniforms.uEnergy = this.globalUniforms.uEnergy;
               
               // Inject Uniforms definition (Vertex)
               // Also add vWorldPositionCustom for Cloud Shadows
               if (shader.vertexShader.includes('#include <common>')) {
                  shader.vertexShader = shader.vertexShader.replace('#include <common>', `
                    #include <common>
                    uniform float uTime;
                    uniform float uSway;
                    varying vec3 vWorldPositionCustom;
                  `);
               } else {
                  shader.vertexShader = `
                    uniform float uTime;
                    uniform float uSway;
                    varying vec3 vWorldPositionCustom;
                  ` + shader.vertexShader;
               }

               // Inject motion logic (and calculate world pos)
               const swayLogic = `
                 #include <begin_vertex>
                 
                 // Leg Sway Logic
                 // Use local Y
                 float hVal = position.y; 
                 
                 // Normalize height relative to model
                 float minH = ${minY.toFixed(2)};
                 float maxH = ${bbox.max.y.toFixed(2)};
                 float totalH = max(maxH - minH, 0.01);
                 
                 float relH = (hVal - minH) / totalH;
                 
                 // Weight: 1.0 at bottom, 0.0 at top (bottom 40%)
                 float weight = 1.0 - smoothstep(0.0, 0.4, relH);
                 
                 // Only sway if energy/sway is present
                 if (weight > 0.01) {
                   float speed = 5.0;
                   float amp = uSway * 0.15; 
                   
                   // Sway motion
                   float wave = sin(uTime * speed + hVal * 2.0);
                   float waveZ = cos(uTime * speed * 0.8 + hVal * 2.0);
                   
                   transformed.x += wave * weight * amp;
                   transformed.z += waveZ * weight * amp * 0.5;
                 }
                 
                 // Calculate World Position for Cloud Shadows
                 vWorldPositionCustom = (modelMatrix * vec4(transformed, 1.0)).xyz;
               `;
               
               shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', swayLogic);

               // Inject Fragment Shader Logic for Saturation & Cloud Shadows
               const fragUniforms = `
                 uniform float uEnergy;
                 uniform float uTime;
                 varying vec3 vWorldPositionCustom;
               `;
               
               if (shader.fragmentShader.includes('#include <common>')) {
                 shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
                   #include <common>
                   ${fragUniforms}
                 `);
               } else {
                 shader.fragmentShader = fragUniforms + shader.fragmentShader;
               }

               // Cloud Shadow Logic (Modulates Diffuse Color)
               // Moving noise pattern simulating light filtering through clouds
               const cloudLogic = `
                 #include <color_fragment>
                 
                 // Cloud Shadow / Light Spot Effect
                 // Large-scale noise for dramatic light patches
                 vec3 cPos = vWorldPositionCustom * 0.5; // Larger scale = bigger spots
                 float cTime = uTime * 0.3; // Slow drift
                 
                 // Multi-octave sine interference for organic shapes
                 float n1 = sin(cPos.x * 1.0 + cTime) * cos(cPos.y * 0.7 - cTime * 0.4) * sin(cPos.z * 0.9 + cTime * 0.2);
                 float n2 = sin(cPos.x * 2.3 - cTime * 0.8) * cos(cPos.z * 1.8 + cTime * 0.6);
                 float n3 = sin(cPos.y * 1.5 + cTime * 0.5) * cos(cPos.x * 1.2 - cTime * 0.3);
                 
                 // Combine octaves
                 float cloudNoise = (n1 + n2 * 0.5 + n3 * 0.3) / 1.8;
                 
                 // Dramatic light/shadow contrast
                 // Range: 0.3 (deep shadow) to 1.7 (bright spotlight)
                 float lightIntensity = 0.3 + 1.4 * smoothstep(-0.4, 0.4, cloudNoise);
                 
                 // Apply to diffuse color (base color)
                 diffuseColor.rgb *= lightIntensity;
               `;
               
               shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', cloudLogic);

               // Saturation Boost Logic
               // Replaces dithering_fragment to apply at end of pipeline
               const saturationLogic = `
                 #include <dithering_fragment>
                 
                 // Vivid Saturation Logic
                 vec3 lumaWeights = vec3(0.299, 0.587, 0.114);
                 vec3 finalCol = gl_FragColor.rgb;
                 float luminance = dot(finalCol, lumaWeights);
                 vec3 greyScaleColor = vec3(luminance);
                 
                 // Saturation Factor
                 // 0.0 energy -> 0.0 saturation (Greyscale)
                 // 1.0 energy -> 1.4 saturation (Vivid but natural)
                 float sat = uEnergy * 1.4;
                 
                 // Apply saturation
                 // Use a better luminance weight for perception
                 vec3 balancedLuma = vec3(0.2126, 0.7152, 0.0722);
                 vec3 mixedColor = mix(vec3(dot(finalCol, balancedLuma)), finalCol, sat);
                 
                 // Vibrance/Pop
                 // Boost colors that are already colored (preserve whites/greys somewhat to avoid tinting teeth/eyes weirdly)
                 // But for "Pure" look, we just apply the mix.
                 
                 gl_FragColor.rgb = mixedColor;
                 
                 // Brightness/Exposure adjustment
                 // 0.0 energy -> 0.3 brightness (Dim)
                 // 1.0 energy -> 1.1 brightness (Bright & Pop)
                 gl_FragColor.rgb *= (0.3 + uEnergy * 0.8);
                 
                 // Subtle Contrast boost to avoid "Greyish" wash
                 gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) * (1.0 + uEnergy * 0.1) + 0.5;
               `;
               
               shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', saturationLogic);
             };
             
             // Trigger recompile
             m.needsUpdate = true;
             // @ts-ignore
             m.version = (m.version || 0) + 1;

             // Eye Detection (Twilight Sparkle)
             // blinn8SG was identified as Eyes in our MTL analysis
             if (m.name === 'blinn8SG' && m instanceof THREE.MeshStandardMaterial) {
               this.eyeMaterial = m;
             }
           }
        };

        if (Array.isArray(material)) {
           material.forEach(processMaterial);
        } else {
           processMaterial(material);
        }
      }
    });
    // Immediately apply current energy state to new model
    this.updateEnergy(this.currentEnergy);
  }

  updateEnergy(energy: number) {
    this.currentEnergy = energy;
    this.globalUniforms.uEnergy.value = energy;
    
    // 1. Update Lighting
    // Base ambient: 0.2 -> 0.9 (Bright, remove grey shadows)
    this.ambientLight.intensity = 0.2 + energy * 0.7;
    // Directional lights: Strong, clear light
    this.directionalLight1.intensity = 0.4 + energy * 1.2;
    this.directionalLight2.intensity = 0.1 + energy * 0.6;
    this.directionalLight3.intensity = 0.1 + energy * 0.4;

    // 2. Update Particles
    if (this.particleSystem) {
      if (this.currentCharacter === 'twilight') {
        this.globalUniforms.uCharacterType.value = 1.0;
      } else if (this.currentCharacter === 'pinkie') {
        this.globalUniforms.uCharacterType.value = 2.0;
      } else {
        this.globalUniforms.uCharacterType.value = 0.0;
      }
    }

    // 3. Update Model Colors (Tint only, Greyscale/Saturation handled by Shader)
    const targetColor = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    
    this.originalMaterials.forEach((original, material) => {
      // Calculate target color (Original or Boosted)
      targetColor.copy(original.color);
      
      // Global Saturation & Brightness Boost for Tint
      targetColor.getHSL(hsl);
      
      // Boost tint saturation to support the shader's boost
      // Pure Color: High Saturation
      const saturationBoost = 1.0 + energy * 0.5;
      hsl.s = Math.min(1.0, hsl.s * saturationBoost);
      
      // Lightness: Boost slightly for "Energy"
      // Remove the darkening logic
      const lightnessBoost = 1.0 + energy * 0.15;
      hsl.l = Math.min(1.0, hsl.l * lightnessBoost);
      
      targetColor.setHSL(hsl.h, hsl.s, hsl.l);

      // Apply tint
      if ('color' in material) {
        (material as THREE.MeshStandardMaterial).color.copy(targetColor);
      }
      
      // Handle emissive
      if ('emissive' in material && original.emissive) {
        const mat = material as THREE.MeshStandardMaterial;
        mat.emissive.copy(original.emissive).multiplyScalar(energy);
      }
    });

    // 4. Update Transform (Scale & Height)
    if (this.model) {
      // Scale: Keep base scale (no energy scaling)
      this.model.scale.copy(this.baseScale);
      
      // Height: Drop down
      // Z is Up. Drop by 0.5 units at 0 energy
      const zOffset = -0.5 * (1 - energy);
      this.model.position.copy(this.basePosition);
      this.model.position.z += zOffset;
    }
    
    // 5. Update Sway
    // Sway intensity: 0.0 -> 2.0
    this.globalUniforms.uSway.value = energy * 2.0;
    
    this.requestRender();
  }
}

