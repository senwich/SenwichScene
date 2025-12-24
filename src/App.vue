<script setup lang="ts">
import { useSplatViewer } from "./composables/useSplatViewer";

const { container, fileInput, triggerFileSelect, handleFileSelect, resetView } = useSplatViewer();
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
      随便扔点什么到这个奇怪的水晶球里🤔
    </button>
    <button class="reset-button" @click="resetView()">
      made by 生橙式😋
    </button>
    <div class="view-labels">
      <span class="view-label view-label--north">北 (+Y)</span>
      <span class="view-label view-label--east">东 (+X)</span>
      <span class="view-label view-label--west">西 (-X)</span>
      <span class="view-label view-label--south">南 (-Y)</span>
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

.container::before,
.container::after {
  content: "";
  position: absolute;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.25);
  z-index: 4;
}

.container::before {
  top: 0;
  bottom: 0;
  width: 1px;
  left: 50%;
}

.container::after {
  left: 0;
  right: 0;
  height: 1px;
  top: 50%;
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

.view-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  color: white;
  z-index: 5;
}

.view-label {
  position: absolute;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.85);
}

.view-label--north {
  top: 12px;
  left: 12px;
}

.view-label--east {
  top: 12px;
  right: 12px;
}

.view-label--west {
  bottom: 12px;
  left: 12px;
}

.view-label--south {
  bottom: 12px;
  right: 12px;
}
</style>
