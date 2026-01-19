#!/usr/bin/env bash
set -euo pipefail

### 可调参数（也可用环境变量覆盖）
: "${FPS:=3}"            # 抽帧频率
: "${COLMAP_MAX:=2000}"  # COLMAP 特征提取时的最大图像边长
: "${MAX_ITERS:=20000}"  # 训练迭代数
: "${THREADS:=0}"        # 0=自动；>0 限制 COLMAP 线程数

### 入参
if [[ $# -lt 1 ]]; then
  echo "用法: $0 /path/to/video.mp4 [scene_name]"
  exit 1
fi
VIDEO="$1"
SCENE="${2:-$(basename "${VIDEO%.*}")}"

### 目录布局
ROOT="$HOME/datasets/$SCENE/nerfstudio"
FRAMES="$ROOT/frames_src"     # 原始帧（只给 COLMAP 用）
IMAGES="$ROOT/images"         # ns 数据集 images 目录（ns-process-data 生成）
DB="$ROOT/colmap/database.db"
SPARSE="$ROOT/colmap/sparse"
OUT_SPLAT="$ROOT/export_splat"

mkdir -p "$FRAMES" "$IMAGES" "$ROOT/colmap" "$SPARSE" "$OUT_SPLAT"

### 依赖自检
need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1"; exit 1; }; }
for c in ffmpeg colmap ns-process-data ns-train ns-export xvfb-run; do need "$c"; done

### 无头/软件渲染环境（COLMAP 在 WSL 下需要）
export XDG_RUNTIME_DIR="/tmp/runtime-$USER"
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
unset QT_QPA_PLATFORM COLMAP_QT_OPENGL
export QT_OPENGL=software
export LIBGL_ALWAYS_SOFTWARE=1
[[ "$THREADS" != "0" ]] && export OMP_NUM_THREADS="$THREADS"

echo "========== [1/6] 抽帧：$VIDEO → $FRAMES (fps=$FPS) =========="
rm -f "$FRAMES"/*.jpg
ffmpeg -loglevel error -y -i "$VIDEO" -vf "fps=${FPS}" "$FRAMES/frame_%05d.jpg"
(( $(ls "$FRAMES"/*.jpg 2>/dev/null | wc -l) >= 10 )) || { echo "抽帧太少（<10），提高 FPS 或检查视频"; exit 1; }

echo "========== [2/6] COLMAP 特征提取（CPU/无界面） =========="
rm -f "$DB"; rm -rf "$SPARSE"; mkdir -p "$SPARSE"
xvfb-run -s "-screen 0 1280x1024x24" \
colmap feature_extractor \
  --database_path "$DB" \
  --image_path "$FRAMES" \
  --ImageReader.single_camera 1 \
  --ImageReader.camera_model OPENCV \
  --SiftExtraction.use_gpu 0 \
  --SiftExtraction.max_image_size "$COLMAP_MAX"

echo "========== [3/6] COLMAP 匹配（sequential→必要时回退 exhaustive） =========="
xvfb-run -s "-screen 0 1280x1024x24" colmap sequential_matcher --database_path "$DB"

echo "========== [4/6] COLMAP 建图（mapper） =========="
set +e
xvfb-run -s "-screen 0 1280x1024x24" \
colmap mapper --database_path "$DB" --image_path "$FRAMES" --output_path "$SPARSE"
set -e
if [[ ! -f "$SPARSE/0/cameras.bin" ]]; then
  echo "⚠️ sequential 未成功，改用 exhaustive 再试……"
  xvfb-run -s "-screen 0 1280x1024x24" colmap exhaustive_matcher --database_path "$DB"
  xvfb-run -s "-screen 0 1280x1024x24" \
  colmap mapper --database_path "$DB" --image_path "$FRAMES" --output_path "$SPARSE"
fi
ls "$SPARSE/0/cameras.bin" "$SPARSE/0/images.bin" "$SPARSE/0/points3D.bin" >/dev/null

echo "========== [5/6] 生成 transforms.json（沿用现有 COLMAP） =========="
# 注意：此处 --data 指向“原始帧目录 $FRAMES”（不要指向 $IMAGES）
rm -rf "$IMAGES"; mkdir -p "$IMAGES"
ns-process-data images \
  --data "$FRAMES" \
  --output-dir "$ROOT" \
  --skip-colmap
[[ -f "$ROOT/transforms.json" ]] || { echo "未生成 transforms.json"; exit 1; }

echo "========== [6/6] 训练 splatfacto 并导出 .splat =========="
# 训练（加上 --output-dir outputs，避免版本差异导致路径变来变去）
ns-train splatfacto \
  --data "$ROOT" \
  --vis tensorboard \
  --max-num-iterations "$MAX_ITERS" \
  --experiment-name "$SCENE" \
  --output-dir outputs

# 既兼容新版（outputs/<SCENE>/splatfacto/<time>/）
# 也兼容旧版（outputs/nerfstudio/splatfacto/<SCENE>/<time>/）
RUN_DIR=$(ls -td "outputs/$SCENE/splatfacto"/*/ 2>/dev/null | head -n1)
if [[ -z "${RUN_DIR:-}" ]]; then
  RUN_DIR=$(ls -td "outputs/nerfstudio/splatfacto/$SCENE"/*/ 2>/dev/null | head -n1)
fi
[[ -n "${RUN_DIR:-}" && -f "$RUN_DIR/config.yml" ]] || { echo "未找到训练输出或 config.yml"; exit 1; }

ns-export gaussian-splat \
  --load-config "$RUN_DIR/config.yml" \
  --output-dir "$OUT_SPLAT"

# 统一命名（可选）
if ls "$OUT_SPLAT"/*.splat >/dev/null 2>&1; then
  SPLAT_FILE="$(ls "$OUT_SPLAT"/*.splat | head -n1)"
  cp -f "$SPLAT_FILE" "$OUT_SPLAT/scene.splat"
fi

echo
echo "✅ 全流程完成"
echo "   场景名:     $SCENE"
echo "   数据根:     $ROOT"
echo "   训练目录:   $RUN_DIR"
echo "   导出目录:   $OUT_SPLAT"
ls -lh "$OUT_SPLAT" || true

