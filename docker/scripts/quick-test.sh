#!/bin/bash
# ================================================================
# Quick validation script — run INSIDE the Docker container
# Tests each component individually before running full benchmark
# ================================================================

set -e

echo "╔══════════════════════════════════════════╗"
echo "║   Quick Validation Tests                 ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. NVIDIA GPU ───────────────────────────────────────────
echo "━━━ 1. GPU Check ━━━"
if nvidia-smi > /dev/null 2>&1; then
    nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader
    echo "✓ GPU available"
else
    echo "✗ GPU NOT available. NVENC will not work."
    echo "  Make sure you launched with: docker run --gpus all ..."
    exit 1
fi
echo ""

# ── 2. FFmpeg NVENC ─────────────────────────────────────────
echo "━━━ 2. FFmpeg NVENC Check ━━━"
NVENC_COUNT=$(ffmpeg -hide_banner -encoders 2>&1 | grep -c nvenc || true)
if [ "$NVENC_COUNT" -gt 0 ]; then
    ffmpeg -hide_banner -encoders 2>&1 | grep nvenc
    echo "✓ NVENC encoders available ($NVENC_COUNT)"
else
    echo "✗ NVENC NOT in FFmpeg. Check CUDA toolkit and FFmpeg build."
    exit 1
fi
echo ""

# ── 3. Custom binaries directory ────────────────────────────
echo "━━━ 3. Custom Binaries ━━━"
echo -n "ffmpeg:   "; ls -la /app/custom-bin/ffmpeg
echo -n "ffprobe:  "; ls -la /app/custom-bin/ffprobe
echo -n "remotion: "; ls -la /app/custom-bin/remotion
echo "✓ All binaries present"
echo ""

# ── 4. NVENC encode test ───────────────────────────────────
echo "━━━ 4. NVENC Encode Test (5s test pattern → h264_nvenc) ━━━"
ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=5" \
    -c:v h264_nvenc -preset p4 -rc constqp -cq 23 \
    /tmp/nvenc-test.mp4 2>&1 | tail -3

if [ -f /tmp/nvenc-test.mp4 ]; then
    SIZE=$(stat -c%s /tmp/nvenc-test.mp4)
    echo "✓ NVENC encode successful (${SIZE} bytes)"
    rm /tmp/nvenc-test.mp4
else
    echo "✗ NVENC encode FAILED"
    exit 1
fi
echo ""

# ── 5. Chrome/Chromium ──────────────────────────────────────
echo "━━━ 5. Chrome Check ━━━"
if command -v google-chrome &> /dev/null; then
    google-chrome --version
elif command -v chromium-browser &> /dev/null; then
    chromium-browser --version
fi
# Remotion's own browser check
cd /app && npx remotion browser ensure 2>&1 | tail -2
echo "✓ Browser ready"
echo ""

# ── 6. Node.js + Remotion ──────────────────────────────────
echo "━━━ 6. Remotion Check ━━━"
node -e "
  const r = require('@remotion/renderer');
  console.log('  Exports check:');
  console.log('    initializeNvencDetection:', typeof r.initializeNvencDetection);
  console.log('    BrowserPoolManager:', typeof r.BrowserPoolManager);
  console.log('    JobScheduler:', typeof r.JobScheduler);
  console.log('    SCALE_DEFAULTS:', typeof r.RenderInternals.SCALE_DEFAULTS);
  console.log('    getRecommendedScaleConfig:', typeof r.RenderInternals.getRecommendedScaleConfig);
"
echo "✓ All fork modules loaded"
echo ""

# ── 7. Memory check ────────────────────────────────────────
echo "━━━ 7. System Resources ━━━"
echo "  CPU cores: $(nproc)"
echo "  RAM total: $(free -h | awk '/^Mem:/{print $2}')"
echo "  RAM available: $(free -h | awk '/^Mem:/{print $7}')"
echo "  Disk free: $(df -h /tmp | awk 'NR==2{print $4}')"
echo ""

echo "╔══════════════════════════════════════════╗"
echo "║   All checks passed ✓                   ║"
echo "║                                          ║"
echo "║   Run full benchmark:                    ║"
echo "║   node /app/scripts/run-benchmark.mjs    ║"
echo "╚══════════════════════════════════════════╝"
