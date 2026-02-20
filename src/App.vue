<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useSplatViewer } from "./composables/useSplatViewer";
import { usePonyCare } from "./composables/usePonyCare";

const { container, fileInput, triggerFileSelect, handleFileSelect, resetView, loadTwilightSparkle, loadPinkiePie, updateEnergy } = useSplatViewer();
const { energy } = usePonyCare();

// Connect energy system to viewer
watch(energy, (newEnergy) => {
  updateEnergy(newEnergy);
});

// ── Sidebar toggle (hamburger button / swipe) ──
const sidebarOpen = ref(false);

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
}

function closeSidebar() {
  sidebarOpen.value = false;
}

// Touch swipe detection
let touchStartX = 0;
let touchStartY = 0;
const SWIPE_EDGE = 30;
const SWIPE_MIN = 50;

function onTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}

function onTouchEnd(e: TouchEvent) {
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = t.clientX - touchStartX;
  const dy = Math.abs(t.clientY - touchStartY);
  if (touchStartX < SWIPE_EDGE && dx > SWIPE_MIN && dx > dy) {
    sidebarOpen.value = true;
  } else if (sidebarOpen.value && dx < -SWIPE_MIN && Math.abs(dx) > dy) {
    sidebarOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
});

onUnmounted(() => {
  document.removeEventListener('touchstart', onTouchStart);
  document.removeEventListener('touchend', onTouchEnd);
});
</script>

<template>
  <div class="container" ref="container">
    <input
      ref="fileInput"
      type="file"
      accept=".ply,.obj"
      @change="handleFileSelect"
      style="display: none"
    />

    <!-- Always-visible labels at top-left -->
    <div class="top-left-labels">
      <div class="energy-indicator" title="Focus Energy">
        <div class="energy-hint">不要离开，也许有魔法能让小马重获生机...</div>
        <div class="energy-bar">
          <div class="energy-fill" :style="{ width: (energy * 100) + '%' }"></div>
        </div>
      </div>
      <div class="credit-label">made by 生橙式</div>
    </div>

    <!-- ☰ Hamburger button — always visible -->
    <button class="hamburger-btn" :class="{ 'hamburger-open': sidebarOpen }" @click="toggleSidebar">
      <span></span><span></span><span></span>
    </button>

    <!-- Left-edge hover trigger (PC only, pure CSS reveal) -->
    <div class="hover-trigger">
      <div class="controls-sidebar hover-sidebar">
        <button class="file-button" @click="triggerFileSelect">随便扔点什么 🤔</button>
        <button class="twilight-button" @click="loadTwilightSparkle">TS 🦄</button>
        <button class="pinkie-button" @click="loadPinkiePie">PP 🧁</button>
        <button class="reset-button" @click="resetView()">重置</button>
      </div>
    </div>

    <!-- JS-controlled sidebar (hamburger / swipe) -->
    <div class="controls-sidebar js-sidebar" :class="{ 'sidebar-visible': sidebarOpen }">
      <button class="file-button" @click="triggerFileSelect">随便扔点什么 🤔</button>
      <button class="twilight-button" @click="loadTwilightSparkle">TS 🦄</button>
      <button class="pinkie-button" @click="loadPinkiePie">PP 🧁</button>
      <button class="reset-button" @click="resetView()">重置</button>
    </div>

    <!-- Backdrop — closes sidebar on click -->
    <div v-if="sidebarOpen" class="sidebar-backdrop" @click="closeSidebar"></div>
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
  background-color: #000;
}
.container:active {
  cursor: grabbing;
}

/* ═══════════════════════════════════════════════
   Always-visible labels (top-left)
   ═══════════════════════════════════════════════ */
.top-left-labels {
  position: absolute;
  top: clamp(10px, 1.5vw, 20px);
  left: clamp(10px, 1.5vw, 20px);
  z-index: 20;
  pointer-events: none;
  max-width: clamp(140px, 18vw, 220px);
}

.energy-indicator { padding: 0 4px; }

.energy-hint {
  font-size: clamp(8px, 1vw, 11px);
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 6px;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  letter-spacing: 0.5px;
}

.energy-bar {
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.energy-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%);
  transition: width 0.5s linear;
  box-shadow: 0 0 5px rgba(255, 154, 158, 0.5);
}

.credit-label {
  margin-top: 5px;
  padding: 4px 8px;
  font-size: clamp(9px, 0.9vw, 12px);
  color: rgba(255, 255, 255, 0.5);
  text-align: left;
  user-select: none;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 10px;
}

/* ═══════════════════════════════════════════════
   ☰ Hamburger button (always visible)
   ═══════════════════════════════════════════════ */
.hamburger-btn {
  display: flex;
  position: absolute;
  top: clamp(10px, 1.5vw, 20px);
  right: clamp(10px, 1.5vw, 20px);
  z-index: 30;
  width: clamp(30px, 3.5vw, 40px);
  height: clamp(30px, 3.5vw, 40px);
  padding: 6px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  cursor: pointer;
  flex-direction: column;
  justify-content: space-around;
  align-items: center;
  transition: background 0.2s ease;
}
.hamburger-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.hamburger-btn span {
  display: block;
  width: clamp(16px, 1.8vw, 22px);
  height: 2px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 2px;
  transition: all 0.3s ease;
  transform-origin: center;
}

.hamburger-btn.hamburger-open span:nth-child(1) {
  transform: rotate(45deg) translate(5px, 5px);
}
.hamburger-btn.hamburger-open span:nth-child(2) {
  opacity: 0;
}
.hamburger-btn.hamburger-open span:nth-child(3) {
  transform: rotate(-45deg) translate(5px, -5px);
}

/* ═══════════════════════════════════════════════
   Hover trigger zone (PC only, pure CSS)
   A tall narrow strip on the left edge.
   On hover, it reveals .hover-sidebar via CSS.
   ═══════════════════════════════════════════════ */
.hover-trigger {
  position: absolute;
  top: 0;
  left: 0;
  width: 22px;
  height: 100%;
  z-index: 16;
}

/* The hover-sidebar sits inside the trigger, hidden off-screen */
.hover-sidebar {
  position: absolute;
  top: 50%;
  left: 0;
  transform: translate(calc(-100% + 5px), -50%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s ease;
  opacity: 1;
  pointer-events: none;
}

/* When hovering the trigger strip OR the sidebar itself, slide it in */
.hover-trigger:hover .hover-sidebar {
  transform: translate(0, -50%);
  opacity: 1;
  pointer-events: auto;
}

/* On touch-only devices, hide the hover trigger entirely */
@media (hover: none) {
  .hover-trigger {
    display: none;
  }
}

/* ═══════════════════════════════════════════════
   JS-controlled sidebar (hamburger / swipe)
   ═══════════════════════════════════════════════ */
.js-sidebar {
  position: absolute;
  top: 50%;
  left: 0;
  transform: translate(calc(-100% + 5px), -50%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s ease;
  opacity: 1;
  pointer-events: none;
  z-index: 25;
}
.js-sidebar.sidebar-visible {
  transform: translate(0, -50%);
  opacity: 1;
  pointer-events: auto;
}

/* ═══════════════════════════════════════════════
   Shared sidebar panel styles
   ═══════════════════════════════════════════════ */
.controls-sidebar {
  display: flex;
  flex-direction: column;
  gap: clamp(6px, 1vw, 12px);
  padding: clamp(10px, 1.5vw, 20px);
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-radius: 0 12px 12px 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-left: none;
  /* Visible peek-out right edge as affordance hint */
  border-right: 2px solid rgba(255, 255, 255, 0.35);
}

.controls-sidebar button {
  padding: clamp(6px, 0.8vw, 10px) clamp(10px, 1.5vw, 18px);
  font-size: clamp(11px, 1.2vw, 15px);
  font-weight: 500;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  text-align: left;
  width: clamp(100px, 12vw, 180px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  white-space: nowrap;
}

.file-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
}
.file-button:hover {
  transform: translateX(2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.6);
}

.twilight-button {
  background: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%);
  box-shadow: 0 2px 8px rgba(155, 89, 182, 0.4);
}
.twilight-button:hover {
  transform: translateX(2px);
  box-shadow: 0 4px 12px rgba(155, 89, 182, 0.6);
}

.pinkie-button {
  background: linear-gradient(135deg, #e91e63 0%, #ec407a 100%);
  box-shadow: 0 2px 8px rgba(233, 30, 99, 0.4);
}
.pinkie-button:hover {
  transform: translateX(2px);
  box-shadow: 0 4px 12px rgba(233, 30, 99, 0.6);
}

.reset-button {
  background: rgba(255, 255, 255, 0.9);
  color: #444 !important;
  border: 1px solid rgba(118, 75, 162, 0.35) !important;
  box-shadow: 0 2px 8px rgba(118, 75, 162, 0.15);
}
.reset-button:hover {
  background: rgba(255, 255, 255, 1);
  transform: translateX(2px);
  box-shadow: 0 4px 12px rgba(118, 75, 162, 0.25);
}

.controls-sidebar button:active {
  transform: translateX(0);
  opacity: 0.9;
}

/* ═══════════════════════════════════════════════
   Backdrop (dismiss sidebar on click)
   ═══════════════════════════════════════════════ */
.sidebar-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 24;
  background: rgba(0, 0, 0, 0.15);
}
</style>
