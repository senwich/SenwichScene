#!/usr/bin/env bash
set -euo pipefail

### Conda 环境初始化（如果存在）
if [[ -f "$HOME/miniforge/etc/profile.d/conda.sh" ]]; then
  set +u
  source "$HOME/miniforge/etc/profile.d/conda.sh"
  conda activate nerfstudio 2>/dev/null || true
  set -u
fi

# WSL 环境下可能出现 HOME/USER 异常（指向 Windows 路径或为空），强制修正
if [[ -z "${USER:-}" ]]; then
  USER="$(id -un 2>/dev/null || echo "user")"
fi
if [[ "$HOME" == *":"* || ! -d "$HOME" ]]; then
  HOME="/home/$USER"
fi

### 可调参数（也可用环境变量覆盖）
: "${FPS:=3}"                  # 抽帧频率
: "${COLMAP_MAX:=2000}"        # COLMAP 特征提取时的最大图像边长
: "${MAX_ITERS:=30000}"        # 训练迭代数 (提升一些以适应难例)
: "${THREADS:=2}"              # COLMAP 线程数（降低可避免 flann 崩溃）
: "${SKIP_TRAIN:=0}"           # 1=跳过训练与导出，只做 COLMAP + transforms
: "${SIFT_PEAK_THRESHOLD:=0.0005}" # SIFT 特征点检测阈值，越小越灵敏 (默认 ~0.013)
: "${COLMAP_PRESET:=aggressive}"   # COLMAP 预设：aggressive / default
: "${COLMAP_MATCHER:=exhaustive}"  # exhaustive / sequential
: "${COLMAP_MATCHER_PASS2:=sequential}"
: "${COLMAP_PASS2:=1}"             # 1=注册过少时自动第二遍
: "${COLMAP_USE_GPU:=0}"           # 1=用GPU做SIFT/匹配
: "${COLMAP_USE_MASK:=1}"          # 1=对COLMAP使用前景mask
: "${EXPORT_MASKS:=1}"             # 1=导出mask图片给COLMAP
: "${SIFT_MAX_NUM_FEATURES:=16384}"
: "${SIFT_EDGE_THRESHOLD:=20}"
: "${SIFT_OCTAVE_RESOLUTION:=4}"
: "${SIFT_NUM_OCTAVES:=5}"
: "${SIFT_MAX_ORIENTATIONS:=4}"
: "${SIFT_ESTIMATE_AFFINE:=0}"
: "${SIFT_UPRIGHT:=0}"
: "${MATCH_MAX_RATIO:=0.85}"
: "${MATCH_MAX_DISTANCE:=0.8}"
: "${MATCH_CROSS_CHECK:=0}"
: "${MATCH_GUIDED:=1}"
: "${MATCH_MAX_NUM:=65536}"
: "${TVG_MIN_INLIER_RATIO:=0.2}"
: "${TVG_MIN_NUM_INLIERS:=12}"
: "${TVG_MAX_ERROR:=6}"
: "${TVG_MAX_NUM_TRIALS:=20000}"
: "${SEQUENTIAL_OVERLAP:=15}"
: "${SEQUENTIAL_LOOP_DETECTION:=0}"
: "${SIFT_PEAK_THRESHOLD_PASS2:=0.0002}"
: "${SIFT_MAX_NUM_FEATURES_PASS2:=65536}"
: "${SIFT_EDGE_THRESHOLD_PASS2:=30}"
: "${SIFT_OCTAVE_RESOLUTION_PASS2:=5}"
: "${SIFT_NUM_OCTAVES_PASS2:=6}"
: "${SIFT_MAX_ORIENTATIONS_PASS2:=6}"
: "${SIFT_ESTIMATE_AFFINE_PASS2:=1}"
: "${MATCH_MAX_RATIO_PASS2:=0.95}"
: "${MATCH_MAX_DISTANCE_PASS2:=0.9}"
: "${MATCH_CROSS_CHECK_PASS2:=0}"
: "${MATCH_GUIDED_PASS2:=1}"
: "${MATCH_MAX_NUM_PASS2:=65536}"
: "${TVG_MIN_INLIER_RATIO_PASS2:=0.1}"
: "${TVG_MIN_NUM_INLIERS_PASS2:=8}"
: "${TVG_MAX_ERROR_PASS2:=8}"
: "${TVG_MAX_NUM_TRIALS_PASS2:=50000}"
: "${SEQUENTIAL_OVERLAP_PASS2:=20}"
: "${SEQUENTIAL_LOOP_DETECTION_PASS2:=0}"
: "${MAPPER_INIT_MIN_TRI_ANGLE:=4}"
: "${MAPPER_MIN_NUM_MATCHES:=15}"
: "${MAPPER_INIT_MIN_NUM_INLIERS:=50}"
: "${MAPPER_INIT_MAX_ERROR:=4}"
: "${MAPPER_INIT_MAX_REG_TRIALS:=4}"
: "${MAPPER_MAX_REG_TRIALS:=6}"
: "${MAPPER_FILTER_MAX_REPROJ_ERROR:=4}"
: "${MAPPER_TRI_MIN_ANGLE:=1.5}"
: "${MAPPER_INIT_MIN_TRI_ANGLE_PASS2:=2}"
: "${MAPPER_MIN_NUM_MATCHES_PASS2:=8}"
: "${MAPPER_INIT_MIN_NUM_INLIERS_PASS2:=30}"
: "${MAPPER_INIT_MAX_ERROR_PASS2:=6}"
: "${MAPPER_INIT_MAX_REG_TRIALS_PASS2:=10}"
: "${MAPPER_MAX_REG_TRIALS_PASS2:=15}"
: "${MAPPER_FILTER_MAX_REPROJ_ERROR_PASS2:=6}"
: "${MAPPER_TRI_MIN_ANGLE_PASS2:=1.0}"
: "${PRESET:=}"                # 预设配置（例如：golden_tree）
: "${AUTO_TURNTABLE:=1}"       # COLMAP 失败时自动启用转台相机
: "${FORCE_TURNTABLE:=0}"      # 1=强制使用转台相机（忽略 COLMAP）
: "${MIN_REGISTERED:=10}"      # 触发转台模式的最少注册图像数
: "${TT_CAMERA_DISTANCE:=3.0}" # 转台相机半径
: "${TT_CAMERA_HEIGHT:=0.3}"   # 转台相机高度
: "${TT_START_ANGLE:=0.0}"     # 转台起始角度（度）
: "${TT_CW:=0}"                # 1=顺时针旋转
: "${TT_FOCAL:=0}"             # 焦距 (0=自动估计)
: "${TT_NUM_RANDOM:=2000}"     # 转台随机初始化高斯数量
: "${TT_RANDOM_SCALE:=1.0}"    # 转台随机初始化范围
: "${GSPLAT_TILE_SIZE:=16}"    # gsplat tile_size（CUDA模式推荐较小）
: "${GSPLAT_BATCH_PER_ITER:=20}" # gsplat torch渲染的batch大小（越小越省显存）
: "${GSPLAT_USE_TORCH:=0}"     # 1=使用gsplat的PyTorch版渲染，避免CUDA共享内存报错
: "${GSPLAT_FORCE_PACKED:=0}"  # 1=强制 packed 模式以降低内存
: "${NS_CACHE_IMAGES:=cpu}"    # 训练时缓存图片位置（cpu/gpu）
: "${NS_CACHE_IMAGES_TYPE:=uint8}" # 缓存图片类型（uint8 更省内存）
: "${NS_IMAGES_ON_GPU:=False}" # 训练时是否将图片放到GPU
: "${NS_NUM_DOWNSCALES:=3}"    # 增大下采样降低显存压力
: "${NS_STOP_SPLIT_AT:=8000}"  # 提前停止分裂降低高斯数量
: "${NS_SH_DEGREE:=3}"         # 球谐阶数（降低可节省显存）
: "${LOW_VRAM:=1}"             # 1=低显存模式（8GB GPU 建议开启）
: "${NS_DEVICE_TYPE:=cuda}"    # 训练设备：cuda/cpu
: "${NS_RANDOM_INIT:=False}"   # 随机初始化高斯（低显存可开启）
: "${NS_NUM_RANDOM:=20000}"    # 随机初始化高斯数量
: "${NS_RANDOM_SCALE:=3.0}"    # 随机初始化范围
: "${NS_REFINE_EVERY:=1000}"   # 降低 densify 频率
: "${NS_USE_ABSGRAD:=False}"   # 关闭 absgrad 降低显存
: "${NS_CAMERA_RES_SCALE:=0.5}" # 训练分辨率缩放 (0-1)
: "${NS_LOAD_3D_POINTS:=True}" # 是否加载 COLMAP 3D 点
: "${NS_CULL_ALPHA_THRESH:=0.1}" # 透明度剔除阈值（越大越省显存）
: "${CUDA_ALLOC_CONF:=expandable_segments:True}" # 缓解CUDA内存碎片
: "${TORCH_LOAD_WEIGHTS_ONLY:=0}" # 0=允许 torch.load 加载完整对象
: "${TORCH_DISABLE_DYNAMO:=1}" # 1=关闭 torch.compile / dynamo 以避免 OOM
: "${TORCHDYNAMO_DISABLE:=1}"  # 兼容旧环境变量
: "${TORCH_COMPILE_DISABLE:=1}" # 关闭 torch.compile
: "${TORCHINDUCTOR_DISABLE:=1}" # 1=关闭 inductor 编译
: "${TRAIN_ONLY:=0}"           # 1=仅训练（跳过 COLMAP 与 transforms 生成）
: "${BG_THRESH:=6}"            # 背景差分阈值（越小越敏感）
: "${CROP_MARGIN:=0.15}"       # 裁剪边界扩展比例
: "${MIN_AREA_PCT:=0.01}"      # 最小目标面积占比（低于则不裁剪）
: "${APPLY_CLAHE:=0}"          # 1=使用CLAHE增强亮度
: "${MASK_BG:=0}"              # 1=背景置黑（基于背景差分）
: "${CROP_ENABLED:=0}"         # 1=裁剪目标并缩放回原尺寸（可能影响相机内参）
: "${CAMERA_MODEL:=OPENCV}"    # 相机模型（可选：SIMPLE_RADIAL / PINHOLE 等）
: "${COLMAP_CAMERA_MODEL:=$CAMERA_MODEL}" # COLMAP相机模型
: "${COLMAP_SINGLE_CAMERA:=1}" # 1=单相机内参（建议保持1）
: "${COLMAP_APPLY_CLAHE:=1}"
: "${COLMAP_MASK_BG:=1}"
: "${COLMAP_CROP_ENABLED:=0}"  # COLMAP默认禁用裁剪，避免内参不一致
: "${COLMAP_BG_THRESH:=$BG_THRESH}"
: "${COLMAP_CROP_MARGIN:=$CROP_MARGIN}"
: "${COLMAP_MIN_AREA_PCT:=$MIN_AREA_PCT}"
: "${TRAIN_APPLY_CLAHE:=$APPLY_CLAHE}"
: "${TRAIN_MASK_BG:=$MASK_BG}"
: "${TRAIN_CROP_ENABLED:=$CROP_ENABLED}"

### 入参
if [[ $# -lt 1 ]]; then
  echo "用法: $0 /path/to/video.mp4 [scene_name]"
  echo "提示: 对于全黑背景/细线条物体，建议使用本脚本。"
  exit 1
fi
VIDEO="$1"
SCENE="${2:-$(basename "${VIDEO%.*}")}"

### 目录布局
ROOT="$HOME/datasets/$SCENE/nerfstudio"
FRAMES_RAW="$ROOT/frames_raw"       # 原始帧
FRAMES_COLMAP="$ROOT/frames_colmap" # COLMAP专用帧
FRAMES_TRAIN="$ROOT/frames_train"   # 训练专用帧
IMAGES="$ROOT/images"               # ns 数据集 images 目录
MASKS="$ROOT/masks"                 # COLMAP 前景 mask 目录
DB="$ROOT/colmap/database.db"
SPARSE="$ROOT/colmap/sparse"
OUT_SPLAT="$ROOT/export_splat"

mkdir -p "$FRAMES_RAW" "$FRAMES_COLMAP" "$FRAMES_TRAIN" "$IMAGES" "$MASKS" "$ROOT/colmap" "$SPARSE" "$OUT_SPLAT"
export MASKS EXPORT_MASKS BG_THRESH CROP_MARGIN MIN_AREA_PCT APPLY_CLAHE MASK_BG CROP_ENABLED GSPLAT_TILE_SIZE GSPLAT_USE_TORCH
export GSPLAT_TILE_SIZE GSPLAT_BATCH_PER_ITER GSPLAT_USE_TORCH GSPLAT_FORCE_PACKED NS_CACHE_IMAGES NS_CACHE_IMAGES_TYPE NS_IMAGES_ON_GPU NS_NUM_DOWNSCALES NS_STOP_SPLIT_AT NS_SH_DEGREE NS_DEVICE_TYPE NS_RANDOM_INIT NS_NUM_RANDOM NS_RANDOM_SCALE NS_REFINE_EVERY NS_USE_ABSGRAD NS_CAMERA_RES_SCALE NS_LOAD_3D_POINTS NS_CULL_ALPHA_THRESH CUDA_ALLOC_CONF
export TORCH_DISABLE_DYNAMO TORCHDYNAMO_DISABLE TORCH_COMPILE_DISABLE TORCHINDUCTOR_DISABLE TORCH_LOAD_WEIGHTS_ONLY TRAIN_ONLY

if [[ "$PRESET" == "golden_tree" ]]; then
  NS_CACHE_IMAGES="gpu"
  NS_CACHE_IMAGES_TYPE="uint8"
  NS_IMAGES_ON_GPU="False"
  NS_NUM_DOWNSCALES=2
  NS_STOP_SPLIT_AT=15000
  NS_SH_DEGREE=3
  NS_RANDOM_INIT=False
  NS_NUM_RANDOM=50000
  NS_RANDOM_SCALE=10.0
  NS_REFINE_EVERY=100
  NS_USE_ABSGRAD=True
  NS_CAMERA_RES_SCALE=1.0
  NS_LOAD_3D_POINTS=True
  NS_CULL_ALPHA_THRESH=0.1
fi

if [[ "$COLMAP_PRESET" == "default" ]]; then
  SIFT_PEAK_THRESHOLD=0.0066
  SIFT_MAX_NUM_FEATURES=8192
  SIFT_EDGE_THRESHOLD=10
  SIFT_OCTAVE_RESOLUTION=3
  SIFT_NUM_OCTAVES=4
  SIFT_MAX_ORIENTATIONS=2
  SIFT_ESTIMATE_AFFINE=0
  SIFT_UPRIGHT=0
  MATCH_MAX_RATIO=0.8
  MATCH_MAX_DISTANCE=0.7
  MATCH_CROSS_CHECK=1
  MATCH_GUIDED=0
  MATCH_MAX_NUM=32768
  TVG_MIN_INLIER_RATIO=0.25
  TVG_MIN_NUM_INLIERS=15
  TVG_MAX_ERROR=4
  TVG_MAX_NUM_TRIALS=10000
  SEQUENTIAL_OVERLAP=10
  SEQUENTIAL_LOOP_DETECTION=0
  MAPPER_INIT_MIN_TRI_ANGLE=16
  MAPPER_MIN_NUM_MATCHES=15
  MAPPER_INIT_MIN_NUM_INLIERS=100
  MAPPER_INIT_MAX_ERROR=4
  MAPPER_INIT_MAX_REG_TRIALS=2
  MAPPER_MAX_REG_TRIALS=3
  MAPPER_FILTER_MAX_REPROJ_ERROR=4
  MAPPER_TRI_MIN_ANGLE=1.5
fi

if [[ "$LOW_VRAM" == "1" ]]; then
  NS_CACHE_IMAGES="cpu"
  NS_CACHE_IMAGES_TYPE="uint8"
  NS_IMAGES_ON_GPU="False"
  NS_NUM_DOWNSCALES=4
  NS_STOP_SPLIT_AT=0
  NS_SH_DEGREE=0
  NS_RANDOM_INIT=True
  NS_NUM_RANDOM=200
  NS_RANDOM_SCALE=1.0
  NS_REFINE_EVERY=1000
  NS_USE_ABSGRAD=False
  NS_CAMERA_RES_SCALE=0.125
  NS_LOAD_3D_POINTS=False
  NS_CULL_ALPHA_THRESH=0.1
  GSPLAT_USE_TORCH=0
  GSPLAT_FORCE_PACKED=1
  GSPLAT_TILE_SIZE=64
  GSPLAT_BATCH_PER_ITER=8
fi

# 确保 sitecustomize.py 在 PYTHONPATH 中（用于动态调整 gsplat tile_size）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}"

### 依赖自检
need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1"; exit 1; }; }
for c in ffmpeg colmap ns-process-data ns-train ns-export xvfb-run; do need "$c"; done

### 无头/软件渲染环境（COLMAP 在 WSL 下需要）
export XDG_RUNTIME_DIR="/tmp/runtime-$USER"
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
unset QT_QPA_PLATFORM COLMAP_QT_OPENGL
export QT_OPENGL=software
export LIBGL_ALWAYS_SOFTWARE=1
export OMP_NUM_THREADS="$THREADS"
export OPENBLAS_NUM_THREADS="$THREADS"
export MKL_NUM_THREADS="$THREADS"
export NUMEXPR_NUM_THREADS="$THREADS"

if [[ "$TRAIN_ONLY" != "1" ]]; then
  echo "========== [1/6] 抽帧并预处理 =========="
  rm -f "$FRAMES_RAW"/*.jpg
  rm -rf "$FRAMES_COLMAP" "$FRAMES_TRAIN"
  # 先抽帧
  ffmpeg -loglevel error -y -i "$VIDEO" -vf "fps=${FPS}" "$FRAMES_RAW/frame_raw_%05d.jpg"
  COUNT=$(ls "$FRAMES_RAW"/frame_raw_*.jpg 2>/dev/null | wc -l)
  (( COUNT >= 10 )) || { echo "抽帧太少（$COUNT < 10），提高 FPS 或检查视频"; exit 1; }
  echo "已抽取 $COUNT 帧，准备分别处理 COLMAP 与训练帧..."

  process_frames() {
    local src="$1"
    local dst="$2"
    local apply_clahe="$3"
    local mask_bg="$4"
    local crop_enabled="$5"
    local bg_thresh="$6"
    local crop_margin="$7"
    local min_area_pct="$8"
    local export_masks="$9"

    rm -rf "$dst"
    mkdir -p "$dst"
    cp "$src"/frame_raw_*.jpg "$dst"/

    FRAMES="$dst" \
    BG_THRESH="$bg_thresh" \
    CROP_MARGIN="$crop_margin" \
    MIN_AREA_PCT="$min_area_pct" \
    APPLY_CLAHE="$apply_clahe" \
    MASK_BG="$mask_bg" \
    CROP_ENABLED="$crop_enabled" \
    EXPORT_MASKS="$export_masks" \
    python - <<'PY'
import glob
import os
import cv2
import numpy as np

frames_dir = os.environ["FRAMES"]
bg_thresh = int(os.environ.get("BG_THRESH", "12"))
crop_margin = float(os.environ.get("CROP_MARGIN", "0.15"))
min_area_pct = float(os.environ.get("MIN_AREA_PCT", "0.01"))
apply_clahe = os.environ.get("APPLY_CLAHE", "1") == "1"
mask_bg = os.environ.get("MASK_BG", "0") == "1"
crop_enabled = os.environ.get("CROP_ENABLED", "0") == "1"
export_masks = os.environ.get("EXPORT_MASKS", "0") == "1"
mask_dir = os.environ.get("MASKS", "")

if export_masks and mask_dir:
    os.makedirs(mask_dir, exist_ok=True)

paths = sorted(glob.glob(os.path.join(frames_dir, "frame_raw_*.jpg")))
if not paths:
    raise SystemExit("No raw frames found.")

imgs = [cv2.imread(p) for p in paths]
if any(im is None for im in imgs):
    raise SystemExit("Failed to read some frames.")

h, w = imgs[0].shape[:2]
bg = None
if mask_bg or crop_enabled or export_masks:
    stack = np.stack(imgs, axis=0).astype(np.float32)
    bg = np.median(stack, axis=0).astype(np.uint8)

kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)) if apply_clahe else None

for img, path in zip(imgs, paths):
    out_img = img
    mask = None

    if mask_bg or crop_enabled or export_masks:
        diff = cv2.absdiff(img, bg)
        diff_gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(diff_gray, bg_thresh, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.dilate(mask, kernel, iterations=2)

    if crop_enabled and mask is not None:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            cnt = max(contours, key=cv2.contourArea)
            area = cv2.contourArea(cnt)
        else:
            cnt = None
            area = 0

        if cnt is None or area < min_area_pct * (h * w):
            x1, y1, x2, y2 = 0, 0, w, h
            mask_crop = np.ones((h, w), dtype=np.uint8) * 255
        else:
            x, y, cw, ch = cv2.boundingRect(cnt)
            margin_w = int(cw * crop_margin)
            margin_h = int(ch * crop_margin)
            x1 = max(0, x - margin_w)
            y1 = max(0, y - margin_h)
            x2 = min(w, x + cw + margin_w)
            y2 = min(h, y + ch + margin_h)
            mask_crop = mask[y1:y2, x1:x2]

        out_img = img[y1:y2, x1:x2]
        out_img = cv2.resize(out_img, (w, h), interpolation=cv2.INTER_CUBIC)
        mask = cv2.resize(mask_crop, (w, h), interpolation=cv2.INTER_NEAREST)

    if apply_clahe:
        lab = cv2.cvtColor(out_img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        l = clahe.apply(l)
        out_img = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

    if mask_bg and mask is not None:
        out_img = out_img.copy()
        out_img[mask == 0] = 0

    if export_masks and mask_dir:
        if mask is None:
            mask = np.ones((h, w), dtype=np.uint8) * 255
        mask_name = os.path.basename(path).replace("frame_raw_", "frame_")
        mask_name = os.path.splitext(mask_name)[0] + ".png"
        cv2.imwrite(os.path.join(mask_dir, mask_name), mask)

    out_name = os.path.basename(path).replace("frame_raw_", "frame_")
    out_path = os.path.join(frames_dir, out_name)
    cv2.imwrite(out_path, out_img)

for p in paths:
    os.remove(p)
PY
  }

  rm -rf "$MASKS"
  mkdir -p "$MASKS"
  process_frames "$FRAMES_RAW" "$FRAMES_COLMAP" "$COLMAP_APPLY_CLAHE" "$COLMAP_MASK_BG" "$COLMAP_CROP_ENABLED" "$COLMAP_BG_THRESH" "$COLMAP_CROP_MARGIN" "$COLMAP_MIN_AREA_PCT" "$EXPORT_MASKS"
  process_frames "$FRAMES_RAW" "$FRAMES_TRAIN" "$TRAIN_APPLY_CLAHE" "$TRAIN_MASK_BG" "$TRAIN_CROP_ENABLED" "$BG_THRESH" "$CROP_MARGIN" "$MIN_AREA_PCT" 0
  echo "预处理完成：$COUNT 帧 (COLMAP 与训练已分离)"

  run_colmap_pass() {
    local pass="$1"
    local peak max_features edge_thresh octave_res num_octaves max_orient affine upright
    local match_ratio match_dist match_cross match_guided match_max
    local tvg_min_ratio tvg_min_inliers tvg_max_error tvg_max_trials
    local seq_overlap seq_loop matcher
    local mapper_init_min_tri mapper_min_matches mapper_init_min_inliers
    local mapper_init_max_error mapper_init_max_reg mapper_max_reg
    local mapper_filter_max_error mapper_tri_min_angle

    if [[ "$pass" == "2" ]]; then
      peak="$SIFT_PEAK_THRESHOLD_PASS2"
      max_features="$SIFT_MAX_NUM_FEATURES_PASS2"
      edge_thresh="$SIFT_EDGE_THRESHOLD_PASS2"
      octave_res="$SIFT_OCTAVE_RESOLUTION_PASS2"
      num_octaves="$SIFT_NUM_OCTAVES_PASS2"
      max_orient="$SIFT_MAX_ORIENTATIONS_PASS2"
      affine="$SIFT_ESTIMATE_AFFINE_PASS2"
      upright="$SIFT_UPRIGHT"
      match_ratio="$MATCH_MAX_RATIO_PASS2"
      match_dist="$MATCH_MAX_DISTANCE_PASS2"
      match_cross="$MATCH_CROSS_CHECK_PASS2"
      match_guided="$MATCH_GUIDED_PASS2"
      match_max="$MATCH_MAX_NUM_PASS2"
      tvg_min_ratio="$TVG_MIN_INLIER_RATIO_PASS2"
      tvg_min_inliers="$TVG_MIN_NUM_INLIERS_PASS2"
      tvg_max_error="$TVG_MAX_ERROR_PASS2"
      tvg_max_trials="$TVG_MAX_NUM_TRIALS_PASS2"
      seq_overlap="$SEQUENTIAL_OVERLAP_PASS2"
      seq_loop="$SEQUENTIAL_LOOP_DETECTION_PASS2"
      matcher="$COLMAP_MATCHER_PASS2"
      mapper_init_min_tri="$MAPPER_INIT_MIN_TRI_ANGLE_PASS2"
      mapper_min_matches="$MAPPER_MIN_NUM_MATCHES_PASS2"
      mapper_init_min_inliers="$MAPPER_INIT_MIN_NUM_INLIERS_PASS2"
      mapper_init_max_error="$MAPPER_INIT_MAX_ERROR_PASS2"
      mapper_init_max_reg="$MAPPER_INIT_MAX_REG_TRIALS_PASS2"
      mapper_max_reg="$MAPPER_MAX_REG_TRIALS_PASS2"
      mapper_filter_max_error="$MAPPER_FILTER_MAX_REPROJ_ERROR_PASS2"
      mapper_tri_min_angle="$MAPPER_TRI_MIN_ANGLE_PASS2"
      echo "========== [2/6] COLMAP Pass2（更激进参数） =========="
    else
      peak="$SIFT_PEAK_THRESHOLD"
      max_features="$SIFT_MAX_NUM_FEATURES"
      edge_thresh="$SIFT_EDGE_THRESHOLD"
      octave_res="$SIFT_OCTAVE_RESOLUTION"
      num_octaves="$SIFT_NUM_OCTAVES"
      max_orient="$SIFT_MAX_ORIENTATIONS"
      affine="$SIFT_ESTIMATE_AFFINE"
      upright="$SIFT_UPRIGHT"
      match_ratio="$MATCH_MAX_RATIO"
      match_dist="$MATCH_MAX_DISTANCE"
      match_cross="$MATCH_CROSS_CHECK"
      match_guided="$MATCH_GUIDED"
      match_max="$MATCH_MAX_NUM"
      tvg_min_ratio="$TVG_MIN_INLIER_RATIO"
      tvg_min_inliers="$TVG_MIN_NUM_INLIERS"
      tvg_max_error="$TVG_MAX_ERROR"
      tvg_max_trials="$TVG_MAX_NUM_TRIALS"
      seq_overlap="$SEQUENTIAL_OVERLAP"
      seq_loop="$SEQUENTIAL_LOOP_DETECTION"
      matcher="$COLMAP_MATCHER"
      mapper_init_min_tri="$MAPPER_INIT_MIN_TRI_ANGLE"
      mapper_min_matches="$MAPPER_MIN_NUM_MATCHES"
      mapper_init_min_inliers="$MAPPER_INIT_MIN_NUM_INLIERS"
      mapper_init_max_error="$MAPPER_INIT_MAX_ERROR"
      mapper_init_max_reg="$MAPPER_INIT_MAX_REG_TRIALS"
      mapper_max_reg="$MAPPER_MAX_REG_TRIALS"
      mapper_filter_max_error="$MAPPER_FILTER_MAX_REPROJ_ERROR"
      mapper_tri_min_angle="$MAPPER_TRI_MIN_ANGLE"
      echo "========== [2/6] COLMAP Pass1（常规参数） =========="
    fi

    rm -f "$DB"; rm -rf "$SPARSE"; mkdir -p "$SPARSE"
    local mask_args=()
    if [[ "$COLMAP_USE_MASK" == "1" && -d "$MASKS" && -n "$(ls -A "$MASKS" 2>/dev/null)" ]]; then
      mask_args=(--ImageReader.mask_path "$MASKS")
    fi

    xvfb-run -s "-screen 0 1280x1024x24" \
    colmap feature_extractor \
      --database_path "$DB" \
      --image_path "$FRAMES_COLMAP" \
      --ImageReader.single_camera "$COLMAP_SINGLE_CAMERA" \
      --ImageReader.camera_model "$COLMAP_CAMERA_MODEL" \
      "${mask_args[@]}" \
      --SiftExtraction.use_gpu "$COLMAP_USE_GPU" \
      --SiftExtraction.num_threads "$THREADS" \
      --SiftExtraction.max_image_size "$COLMAP_MAX" \
      --SiftExtraction.peak_threshold "$peak" \
      --SiftExtraction.edge_threshold "$edge_thresh" \
      --SiftExtraction.octave_resolution "$octave_res" \
      --SiftExtraction.num_octaves "$num_octaves" \
      --SiftExtraction.max_num_features "$max_features" \
      --SiftExtraction.max_num_orientations "$max_orient" \
      --SiftExtraction.estimate_affine_shape "$affine" \
      --SiftExtraction.upright "$upright" \
      --SiftExtraction.domain_size_pooling 1

    if [[ "$matcher" == "sequential" ]]; then
      xvfb-run -s "-screen 0 1280x1024x24" \
      colmap sequential_matcher \
        --database_path "$DB" \
        --SiftMatching.use_gpu "$COLMAP_USE_GPU" \
        --SiftMatching.num_threads "$THREADS" \
        --SiftMatching.max_ratio "$match_ratio" \
        --SiftMatching.max_distance "$match_dist" \
        --SiftMatching.cross_check "$match_cross" \
        --SiftMatching.guided_matching "$match_guided" \
        --SiftMatching.max_num_matches "$match_max" \
        --TwoViewGeometry.min_num_inliers "$tvg_min_inliers" \
        --TwoViewGeometry.min_inlier_ratio "$tvg_min_ratio" \
        --TwoViewGeometry.max_error "$tvg_max_error" \
        --TwoViewGeometry.max_num_trials "$tvg_max_trials" \
        --SequentialMatching.overlap "$seq_overlap" \
        --SequentialMatching.loop_detection "$seq_loop"
    else
      xvfb-run -s "-screen 0 1280x1024x24" \
      colmap exhaustive_matcher \
        --database_path "$DB" \
        --SiftMatching.use_gpu "$COLMAP_USE_GPU" \
        --SiftMatching.num_threads "$THREADS" \
        --SiftMatching.max_ratio "$match_ratio" \
        --SiftMatching.max_distance "$match_dist" \
        --SiftMatching.cross_check "$match_cross" \
        --SiftMatching.guided_matching "$match_guided" \
        --SiftMatching.max_num_matches "$match_max" \
        --TwoViewGeometry.min_num_inliers "$tvg_min_inliers" \
        --TwoViewGeometry.min_inlier_ratio "$tvg_min_ratio" \
        --TwoViewGeometry.max_error "$tvg_max_error" \
        --TwoViewGeometry.max_num_trials "$tvg_max_trials"
    fi

    xvfb-run -s "-screen 0 1280x1024x24" \
    colmap mapper \
      --database_path "$DB" \
      --image_path "$FRAMES_COLMAP" \
      --output_path "$SPARSE" \
      --Mapper.init_min_tri_angle "$mapper_init_min_tri" \
      --Mapper.min_num_matches "$mapper_min_matches" \
      --Mapper.init_min_num_inliers "$mapper_init_min_inliers" \
      --Mapper.init_max_error "$mapper_init_max_error" \
      --Mapper.init_max_reg_trials "$mapper_init_max_reg" \
      --Mapper.max_reg_trials "$mapper_max_reg" \
      --Mapper.filter_max_reproj_error "$mapper_filter_max_error" \
      --Mapper.tri_min_angle "$mapper_tri_min_angle" \
      --Mapper.multiple_models 0 \
      --Mapper.extract_colors 0 \
      --Mapper.num_threads $((THREADS > 0 ? THREADS : $(nproc)))
  }

  analyze_colmap() {
    if [[ ! -f "$SPARSE/0/cameras.bin" ]]; then
      echo 0
      return
    fi
    colmap model_analyzer --path "$SPARSE/0" 2>/dev/null | awk '/Registered images/ {print $NF; exit}'
  }

  run_colmap_pass 1
  REGISTERED_IMAGES=$(analyze_colmap || echo 0)
  if [[ -z "${REGISTERED_IMAGES:-}" ]]; then
    REGISTERED_IMAGES=0
  fi

  if [[ "$COLMAP_PASS2" == "1" && "$REGISTERED_IMAGES" -lt "$MIN_REGISTERED" ]]; then
    echo "⚠️ COLMAP 注册过少（$REGISTERED_IMAGES/$COUNT），尝试更激进参数..."
    run_colmap_pass 2
    REGISTERED_IMAGES=$(analyze_colmap || echo 0)
    if [[ -z "${REGISTERED_IMAGES:-}" ]]; then
      REGISTERED_IMAGES=0
    fi
  fi

  if [[ ! -f "$SPARSE/0/cameras.bin" ]]; then
    echo "❌ COLMAP 建图失败：未生成稀疏点云。"
    echo "建议尝试："
    echo "1. 检查视频是否太暗"
    echo "2. 提高 APPLY_CLAHE/MASK_BG/CROP_ENABLED"
    exit 1
  fi

  echo "COLMAP 注册图像: $REGISTERED_IMAGES / $COUNT"

  echo "========== [5/6] 生成 transforms.json =========="
  rm -rf "$IMAGES"; mkdir -p "$IMAGES"
  ns-process-data images \
    --data "$FRAMES_TRAIN" \
    --output-dir "$ROOT" \
    --skip-colmap

  [[ -f "$ROOT/transforms.json" ]] || { echo "未生成 transforms.json"; exit 1; }

  if [[ "$FORCE_TURNTABLE" == "1" || ( "$AUTO_TURNTABLE" == "1" && "$REGISTERED_IMAGES" -lt "$MIN_REGISTERED" ) ]]; then
    echo "⚠️ 使用转台相机位姿（COLMAP 注册过少或强制启用）"
    if [[ "$TT_CW" == "1" ]]; then
      CW_FLAG="--cw"
    else
      CW_FLAG=""
    fi
    python "$SCRIPT_DIR/generate_turntable_transforms.py" \
      "$ROOT/images" \
      "$ROOT/transforms.json" \
      --distance "$TT_CAMERA_DISTANCE" \
      --height "$TT_CAMERA_HEIGHT" \
      --start-angle "$TT_START_ANGLE" \
      $CW_FLAG \
      --width 0 \
      --height-px 0 \
      --focal "$TT_FOCAL"
    NS_LOAD_3D_POINTS=False
    NS_RANDOM_INIT=True
    NS_NUM_RANDOM="$TT_NUM_RANDOM"
    NS_RANDOM_SCALE="$TT_RANDOM_SCALE"
  fi
else
  [[ -f "$ROOT/transforms.json" ]] || { echo "TRAIN_ONLY=1 但未找到 transforms.json"; exit 1; }
fi

if [[ "$SKIP_TRAIN" == "1" ]]; then
  echo "========== [6/6] 跳过训练（SKIP_TRAIN=1） =========="
  exit 0
fi

echo "========== [6/6] 训练 splatfacto 并导出 .splat =========="
TORCH_DISABLE_DYNAMO="$TORCH_DISABLE_DYNAMO" \
TORCHDYNAMO_DISABLE="$TORCHDYNAMO_DISABLE" \
TORCH_COMPILE_DISABLE="$TORCH_COMPILE_DISABLE" \
TORCHINDUCTOR_DISABLE="$TORCHINDUCTOR_DISABLE" \
PYTORCH_CUDA_ALLOC_CONF="$CUDA_ALLOC_CONF" \
ns-train splatfacto \
  --vis tensorboard \
  --max-num-iterations "$MAX_ITERS" \
  --experiment-name "$SCENE" \
  --output-dir outputs \
  --pipeline.model.cull-alpha-thresh "$NS_CULL_ALPHA_THRESH" \
  --pipeline.datamanager.cache-images "$NS_CACHE_IMAGES" \
  --pipeline.datamanager.cache-images-type "$NS_CACHE_IMAGES_TYPE" \
  --pipeline.datamanager.images-on-gpu "$NS_IMAGES_ON_GPU" \
  --pipeline.datamanager.camera-res-scale-factor "$NS_CAMERA_RES_SCALE" \
  --pipeline.model.num-downscales "$NS_NUM_DOWNSCALES" \
  --pipeline.model.stop-split-at "$NS_STOP_SPLIT_AT" \
  --pipeline.model.sh-degree "$NS_SH_DEGREE" \
  --pipeline.model.random-init "$NS_RANDOM_INIT" \
  --pipeline.model.num-random "$NS_NUM_RANDOM" \
  --pipeline.model.random-scale "$NS_RANDOM_SCALE" \
  --pipeline.model.refine-every "$NS_REFINE_EVERY" \
  --pipeline.model.use-absgrad "$NS_USE_ABSGRAD" \
  --machine.device-type "$NS_DEVICE_TYPE" \
  nerfstudio-data \
  --data "$ROOT" \
  --load-3D-points "$NS_LOAD_3D_POINTS"

RUN_DIR=$(ls -td "outputs/$SCENE/splatfacto"/*/ 2>/dev/null | head -n1)
if [[ -z "${RUN_DIR:-}" ]]; then
  RUN_DIR=$(ls -td "outputs/nerfstudio/splatfacto/$SCENE"/*/ 2>/dev/null | head -n1)
fi
[[ -n "${RUN_DIR:-}" && -f "$RUN_DIR/config.yml" ]] || { echo "未找到训练输出或 config.yml"; exit 1; }

ns-export gaussian-splat \
  --load-config "$RUN_DIR/config.yml" \
  --output-dir "$OUT_SPLAT"

if ls "$OUT_SPLAT"/*.splat >/dev/null 2>&1; then
  SPLAT_FILE="$(ls "$OUT_SPLAT"/*.splat | head -n1)"
  cp -f "$SPLAT_FILE" "$OUT_SPLAT/scene.splat"
elif ls "$OUT_SPLAT"/*.ply >/dev/null 2>&1; then
  SPLAT_FILE="$(ls "$OUT_SPLAT"/*.ply | head -n1)"
  cp -f "$SPLAT_FILE" "$OUT_SPLAT/scene.ply"
fi

echo
echo "✅ 全流程完成 (Turntable Mode)"
echo "   场景名:     $SCENE"
echo "   数据根:     $ROOT"
echo "   训练目录:   $RUN_DIR"
echo "   导出目录:   $OUT_SPLAT"
ls -lh "$OUT_SPLAT" || true
