<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

const container = ref<HTMLDivElement>();
const fileInput = ref<HTMLInputElement>();
const butterfly = ref<SplatMesh | null>(null);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);

// 拖动旋转相关状态
const isDragging = ref(false);
const lastMouseX = ref(0);
const lastMouseY = ref(0);
const rotationX = ref(0);
const rotationY = ref(0);

function handleResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  
  renderer.setSize(width, height);
}

// 鼠标/触摸事件处理
function handleMouseDown(event: MouseEvent | TouchEvent) {
  isDragging.value = true;
  if ('touches' in event) {
    const touch = event.touches[0];
    if (touch) {
      event.preventDefault(); // 防止页面滚动
      lastMouseX.value = touch.clientX;
      lastMouseY.value = touch.clientY;
    }
  } else {
    lastMouseX.value = event.clientX;
    lastMouseY.value = event.clientY;
  }
}

function handleMouseMove(event: MouseEvent | TouchEvent) {
  if (!isDragging.value) return;
  
  let clientX: number;
  let clientY: number;
  
  if ('touches' in event) {
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault(); // 防止页面滚动
    clientX = touch.clientX;
    clientY = touch.clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }
  
  const deltaX = clientX - lastMouseX.value;
  const deltaY = clientY - lastMouseY.value;
  
  // 根据鼠标移动计算旋转角度
  rotationY.value += deltaX * 0.01;
  rotationX.value += deltaY * 0.01;
  
  // 限制 X 轴旋转范围（避免翻转）
  rotationX.value = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotationX.value));
  
  // 应用旋转
  if (butterfly.value) {
    butterfly.value.rotation.y = rotationY.value;
    butterfly.value.rotation.x = rotationX.value;
  }
  
  lastMouseX.value = clientX;
  lastMouseY.value = clientY;
}

function handleMouseUp() {
  isDragging.value = false;
}

// 触发文件选择
function triggerFileSelect() {
  fileInput.value?.click();
}

// 处理文件选择
function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  
  // 移除旧的模型
  if (butterfly.value) {
    scene.remove(butterfly.value);
    butterfly.value.dispose();
  }
  
  // 创建对象 URL
  const url = URL.createObjectURL(file);
  
  // 创建新的模型
  const newButterfly = new SplatMesh({ url });
  newButterfly.quaternion.set(1, 0, 0, 0);
  newButterfly.position.set(0, 0, -3);
  scene.add(newButterfly);
  butterfly.value = newButterfly;
  
  // 重置旋转
  rotationX.value = 0;
  rotationY.value = 0;
}

renderer.setAnimationLoop(function animate() {
  renderer.render(scene, camera);
});

onMounted(() => {
  const canvas = container.value!;
  canvas.appendChild(renderer.domElement);
  
  // 窗口大小变化监听
  window.addEventListener('resize', handleResize);
  
  // 鼠标事件监听
  canvas.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  
  // 触摸事件监听（支持移动设备）
  canvas.addEventListener('touchstart', handleMouseDown);
  window.addEventListener('touchmove', handleMouseMove);
  window.addEventListener('touchend', handleMouseUp);
});

onUnmounted(() => {
  const canvas = container.value!;
  
  // 移除所有事件监听器
  window.removeEventListener('resize', handleResize);
  canvas.removeEventListener('mousedown', handleMouseDown);
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
  canvas.removeEventListener('touchstart', handleMouseDown);
  window.removeEventListener('touchmove', handleMouseMove);
  window.removeEventListener('touchend', handleMouseUp);
  
  // 清理模型
  if (butterfly.value) {
    butterfly.value.dispose();
  }
  
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
</style>
