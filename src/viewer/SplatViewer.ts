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

  private views: ViewConfig[];
  private readonly viewByPosition = new Map<ViewPosition, ViewConfig>();
  private primaryView: ViewConfig;

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
    uSway: { value: 0 }
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
  private readonly axisLockThreshold = 1.5;

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

    this.setupQuadViews();
    // Default to quad views
    
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
    this.primaryView = this.views[0];
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
      let materials: MTLLoader.MaterialCreator | undefined;

      if (mtlMatch) {
        const mtlFilename = mtlMatch[1].trim();
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
      setVectorFromOrbit(this.tempSpherical, this.cameraOffset).add(this.orbitTarget);
      view.camera.position.copy(this.cameraOffset);
      
      // Reset up vector and look at target
      view.camera.up.set(0, 0, 1);
      view.camera.lookAt(this.orbitTarget);
      
      // Apply screen space rotation (Roll) around the local Z axis
      if (view.screenRotation !== 0) {
        view.camera.rotateZ(view.screenRotation);
      }
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
    // Update Uniforms
    const time = Date.now() * 0.001;
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
      const positions = this.particleSystem.geometry.attributes.position.array as Float32Array;
      const count = positions.length / 3;
      const time = Date.now() * 0.001;
      
      // Speed scales with energy
      const speedScale = 0.2 + this.currentEnergy * 0.8;
      
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        
        // Circular motion + vertical drift
        // Simple orbit logic:
        const x = positions[i3];
        const y = positions[i3 + 1];
        const z = positions[i3 + 2]; // Z is up in our world
        
        // Orbit around Z axis
        const speed = this.particleVelocities[i] * speedScale;
        const radius = Math.sqrt(x*x + y*y);
        const angle = Math.atan2(y, x) + speed * 0.01;
        
        positions[i3] = Math.cos(angle) * radius;
        positions[i3 + 1] = Math.sin(angle) * radius;
        
        // Gentle vertical bobbing
        positions[i3 + 2] = z + Math.sin(time + i) * 0.002 * speedScale;
      }
      
      this.particleSystem.geometry.attributes.position.needsUpdate = true;
      
      // Request render if particles are visible (energy > 0)
      if (this.currentEnergy > 0.01) {
        this.needsRender = true;
      }
    }

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

  private initParticles() {
    const particleCount = 100;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      // Random position in a sphere/shell
      const r = 2 + Math.random() * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      
      velocities[i] = (Math.random() - 0.5) * 2; // Random orbit speed
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particleVelocities = velocities;

    const texture = this.createParticleTexture();
    const material = new THREE.PointsMaterial({
      color: 0xffdd88, // Warm magical glow
      size: 0.15,
      map: texture,
      transparent: true,
      opacity: 0, // Start invisible
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

             // Inject Leg Sway Shader
             m.onBeforeCompile = (shader) => {
               console.log("[Shader] Injecting Leg Sway for", m.name);
               shader.uniforms.uTime = this.globalUniforms.uTime;
               shader.uniforms.uSway = this.globalUniforms.uSway;
               
               shader.vertexShader = `
                 uniform float uTime;
                 uniform float uSway;
               ` + shader.vertexShader;

               // Inject motion logic
               // SIMPLIFIED DEBUG LOGIC: Sway everything to verify system
               const swayLogic = `
                 #include <begin_vertex>
                 
                 // Force sway if uSway > 0
                 // Use a mix of Y and Z for height to handle different model orientations
                 float hVal = position.y + position.z; 
                 
                 float speed = 6.0;
                 float amp = uSway * 0.15; // Base amplitude
                 
                 // Wavy motion
                 float wave = sin(uTime * speed + hVal * 2.0);
                 
                 // Apply to X and Z (horizontal plane)
                 transformed.x += wave * amp;
                 transformed.z += cos(uTime * speed * 0.9 + hVal) * amp;
               `;
               
               shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', swayLogic);
             };
             
             // Trigger recompile
             m.needsUpdate = true;
             // @ts-ignore
             m.version = (m.version || 0) + 1; // Force recompile in newer Three.js

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
    
    // 1. Update Lighting
    // Base ambient: 0.1 -> 0.6 (Stronger contrast)
    this.ambientLight.intensity = 0.1 + energy * 0.5;
    // Directional lights: very dim -> bright
    this.directionalLight1.intensity = 0.1 + energy * 0.9;
    this.directionalLight2.intensity = 0.0 + energy * 0.4;
    this.directionalLight3.intensity = 0.0 + energy * 0.3;

    // 2. Update Particles
    if (this.particleSystem) {
      const material = this.particleSystem.material as THREE.PointsMaterial;
      material.opacity = Math.max(0, energy * 1.0); // Full range
      material.size = 0.02 + energy * 0.18; // More dramatic size change
      
      // Custom Particle Colors
      if (this.currentCharacter === 'twilight') {
        material.color.setHex(0xcc88ff); // Magical Purple
      } else if (this.currentCharacter === 'pinkie') {
        material.color.setHex(0xffaaaa); // Party Pink
      } else {
        material.color.setHex(0xffdd88); // Default Gold
      }
    }

    // 3. Update Model Colors
    // 0% energy = Dark Grey (0x222222) -> More dramatic "dead" look
    const greyColor = new THREE.Color(0x222222);
    const targetColor = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    
    this.originalMaterials.forEach((original, material) => {
      // Calculate target color (Original or Boosted)
      targetColor.copy(original.color);
      
      if (this.currentCharacter === 'twilight' && energy > 0.8) {
        // Boost Saturation for Twilight at high energy
        targetColor.getHSL(hsl);
        hsl.s = Math.min(1.0, hsl.s * 1.5); 
        hsl.l = Math.min(1.0, hsl.l * 1.1);
        targetColor.setHSL(hsl.h, hsl.s, hsl.l);
      }

      // Lerp color
      material.color.copy(targetColor).lerp(greyColor, 1 - energy);
      
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
    // Sway intensity scaled up for visibility
    // Model max dim is 10, so we need larger sway
    this.globalUniforms.uSway.value = Math.max(0, (energy - 0.1) * 2.0);
    // console.log("Energy:", energy.toFixed(3), "Sway:", this.globalUniforms.uSway.value.toFixed(3));
    
    this.requestRender();
  }
}

