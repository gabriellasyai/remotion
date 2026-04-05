#!/bin/bash
# ================================================================
# vast.ai Launch Script
#
# How to use on vast.ai:
#
# 1. Build and push the image:
#    docker build -f docker/Dockerfile -t <your-dockerhub>/remotion-scale:latest .
#    docker push <your-dockerhub>/remotion-scale:latest
#
# 2. On vast.ai, create an instance:
#    - Image: <your-dockerhub>/remotion-scale:latest
#    - GPU: 1x L40, H100, A100, L4, or T4
#    - Disk: 50GB+
#    - RAM: 64GB+ recommended
#    - Docker options: --gpus all --shm-size=8g
#
# 3. SSH into the instance and run:
#    bash /app/scripts/vast-launch.sh
#
# 4. Or run with custom video:
#    bash /app/scripts/vast-launch.sh --video=/path/to/your-video.mp4
#
# ================================================================

set -e

echo "╔══════════════════════════════════════════╗"
echo "║   vast.ai Remotion Scale Benchmark       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Parse args
VIDEO_PATH=""
JOBS=10
CONCURRENCY=5

for arg in "$@"; do
    case $arg in
        --video=*) VIDEO_PATH="${arg#*=}" ;;
        --jobs=*) JOBS="${arg#*=}" ;;
        --concurrency=*) CONCURRENCY="${arg#*=}" ;;
    esac
done

# ── Step 1: Quick validation ───────────────────────────────
echo "Step 1: Running validation checks..."
bash /app/scripts/quick-test.sh
echo ""

# ── Step 2: Handle test video ──────────────────────────────
echo "Step 2: Setting up test video..."
COMP_PUBLIC="/app/test-composition/public"
mkdir -p "$COMP_PUBLIC"

if [ -n "$VIDEO_PATH" ] && [ -f "$VIDEO_PATH" ]; then
    echo "  Using provided video: $VIDEO_PATH"
    cp "$VIDEO_PATH" "$COMP_PUBLIC/test-video.mp4"
elif [ ! -f "$COMP_PUBLIC/test-video.mp4" ]; then
    echo "  No video provided. Generating 60s test pattern..."
    ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=60" \
        -f lavfi -i "sine=frequency=440:duration=60" \
        -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k \
        "$COMP_PUBLIC/test-video.mp4" 2>/dev/null
    echo "  Test video generated."
fi
echo ""

# ── Step 3: Detect GPU type ────────────────────────────────
echo "Step 3: Detecting GPU type..."
GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
GPU_TYPE="enterprise"

# Consumer GPUs have GeForce/RTX in the name
if echo "$GPU_NAME" | grep -qi "geforce\|rtx [2-5][0-9]"; then
    GPU_TYPE="consumer"
fi
echo "  GPU: $GPU_NAME → type: $GPU_TYPE"

# Adjust concurrency for consumer GPUs (max 5 NVENC sessions)
if [ "$GPU_TYPE" = "consumer" ] && [ "$CONCURRENCY" -gt 5 ]; then
    echo "  ⚠ Consumer GPU detected. Capping NVENC concurrent encodes to 5."
    echo "  (capture concurrency stays at $CONCURRENCY, encoding queues)"
fi
echo ""

# ── Step 4: Run benchmark ──────────────────────────────────
echo "Step 4: Running benchmark..."
echo ""

node /app/scripts/run-benchmark.mjs \
    --jobs="$JOBS" \
    --concurrency="$CONCURRENCY" \
    --gpu-type="$GPU_TYPE" \
    --composition="ShortClip" \
    --output-dir="/tmp/benchmark-output"

# ── Step 5: Results ────────────────────────────────────────
echo ""
echo "Results saved to /tmp/benchmark-output/"
echo "  - benchmark-report.json (raw data)"
echo "  - vanilla/ (baseline renders)"
echo "  - fork/ (optimized renders)"
echo ""
echo "To copy results out:"
echo "  scp -P <port> root@<host>:/tmp/benchmark-output/benchmark-report.json ."
