import { ref, onMounted, onUnmounted } from "vue";

export function usePonyCare() {
  const energy = ref(1.0); // 0.0 to 1.0
  const isVisible = ref(true);
  
  // Configuration
  const GROWTH_TIME_SEC = 1 * 60; // 10 minutes to full
  const DECAY_TIME_SEC = 2*60; // 12 hours to empty
  
  const GROWTH_RATE = 1.0 / GROWTH_TIME_SEC;
  const DECAY_RATE = 1.0 / DECAY_TIME_SEC;
  
  const STORAGE_KEY = "pony_care_state";
  let lastTime = Date.now();
  let animationFrameId: number;

  const loadState = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        const now = Date.now();
        const elapsedSec = (now - state.lastSeen) / 1000;
        
        // Apply decay for offline time
        const offlineDecay = elapsedSec * DECAY_RATE;
        // Don't go below 0
        const newEnergy = Math.max(0, state.energy - offlineDecay);
        energy.value = newEnergy;
        
        console.log(`[PonyCare] Loaded state. Offline for ${elapsedSec.toFixed(1)}s. Decay: -${offlineDecay.toFixed(3)}. New Energy: ${newEnergy.toFixed(3)}`);
      } else {
        energy.value = 0.5; // Default start
      }
    } catch (e) {
      console.error("Failed to load pony care state", e);
      energy.value = 0.5; // Default start
    }
  };

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        energy: energy.value,
        lastSeen: Date.now()
      }));
    } catch (e) {
      // Ignore storage errors
    }
  };

  const updateLoop = () => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000; // seconds
    lastTime = now;

    if (isVisible.value) {
      // Grow when visible
      if (energy.value < 1.0) {
        energy.value = Math.min(1.0, energy.value + GROWTH_RATE * dt);
      }
    } else {
      // Decay when hidden (though requestAnimationFrame might pause, we handle this via visibility change + timestamp diff)
      // Note: Browsers usually throttle rAF in background tabs to 1fps or stop it.
      // We rely on 'visibilitychange' to handle large chunks of time, but for active background, we decay here.
      if (energy.value > 0) {
        energy.value = Math.max(0, energy.value - DECAY_RATE * dt);
      }
    }
    
    // DEBUG: Log energy every ~1s (when dt accumulates)
    if (Math.random() < 0.05) {
       console.log("Energy:", energy.value.toFixed(3));
    }
    
    // Auto-save periodically or on significant change? 
    // For now, we save on visibility change and rely on memory for active session.
    // But to be safe against crashes, maybe save every minute? 
    // Let's just rely on visibility change for persistence to avoid IO thrashing.
    
    animationFrameId = requestAnimationFrame(updateLoop);
  };

  const handleVisibilityChange = () => {
    const now = Date.now();
    
    if (document.hidden) {
      // Going hidden
      isVisible.value = false;
      saveState();
      console.log("[PonyCare] Hidden. State saved.");
    } else {
      // Coming back
      isVisible.value = true;
      lastTime = now;
      console.log("[PonyCare] Visible. Recalculating...");
      loadState(); 
    }
  };

  onMounted(() => {
    loadState();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    isVisible.value = !document.hidden;
    lastTime = Date.now();
    updateLoop();
    
    // Periodically save state (e.g. every 30s) just in case
    const saveInterval = setInterval(saveState, 30000);
    onUnmounted(() => clearInterval(saveInterval));
  });

  onUnmounted(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    cancelAnimationFrame(animationFrameId);
    saveState();
  });

  return {
    energy
  };
}
