<script setup lang="ts">
import { useSplatViewer } from "./composables/useSplatViewer";

const { container, fileInput, triggerFileSelect, handleFileSelect, resetView, loadTwilightSparkle, loadPinkiePie } = useSplatViewer();
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
    <div class="controls-sidebar">
      <button class="file-button" @click="triggerFileSelect">
        随便扔点什么 🤔
      </button>
      <button class="twilight-button" @click="loadTwilightSparkle">
        TS 🦄
      </button>
      <button class="pinkie-button" @click="loadPinkiePie">
        PP 🧁
      </button>
      <button class="reset-button" @click="resetView()">
        重置
      </button>
      <div class="credit-label">
        made by 生橙式
      </div>
    </div>
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

.controls-sidebar {
  position: absolute;
  top: 20px;
  left: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 10;
  pointer-events: none; /* Let clicks pass through empty space */
}

.controls-sidebar button {
  pointer-events: auto; /* Enable clicks on buttons */
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  text-align: left;
  width: 160px;
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.credit-label {
  margin-top: 5px;
  padding: 4px 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  user-select: none;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 10px;
}
</style>
