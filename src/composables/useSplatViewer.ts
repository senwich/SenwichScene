import { onMounted, onUnmounted, ref } from "vue";
import { SplatViewer } from "../viewer/SplatViewer";

export function useSplatViewer() {
  const container = ref<HTMLDivElement>();
  const fileInput = ref<HTMLInputElement>();
  const viewer = new SplatViewer();

  const triggerFileSelect = () => {
    const input = fileInput.value;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const handleFileSelect = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    viewer.loadFile(file);
    target.value = "";
  };

  const resetView = (immediate?: boolean) => viewer.resetView(immediate);

  const loadFromUrl = (url: string) => {
    viewer.loadFromUrl(url);
  };

  const loadTwilightSparkle = () => {
    viewer.loadFromUrl('/models/TwilightSparkle/TwilightSparkle.obj');
  };

  const loadPinkiePie = () => {
    viewer.loadFromUrl('/models/PinkiePie/PinkiePie.obj');
  };

  const updateEnergy = (energy: number) => {
    viewer.updateEnergy(energy);
  };

  const setViewMode = (mode: 'quad' | 'single') => {
    viewer.setViewMode(mode);
  };

  onMounted(() => {
    if (container.value) {
      viewer.mount(container.value);
    }
  });

  onUnmounted(() => {
    viewer.unmount();
  });

  return {
    container,
    fileInput,
    triggerFileSelect,
    handleFileSelect,
    resetView,
    loadFromUrl,
    loadTwilightSparkle,
    loadPinkiePie,
    updateEnergy,
    setViewMode,
  };
}



