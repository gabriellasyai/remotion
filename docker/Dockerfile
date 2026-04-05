# ============================================================
# Remotion Scale Rendering Fork - Docker Image for vast.ai
# GPU: NVIDIA (L40, H100, A100, L4, T4, etc.)
# Base: CUDA 12.4 + Ubuntu 22.04
# ============================================================

FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS ffmpeg-builder

# ── Build FFmpeg with NVENC ─────────────────────────────────
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    pkg-config \
    yasm \
    nasm \
    cmake \
    wget \
    ca-certificates \
    libx264-dev \
    libx265-dev \
    libvpx-dev \
    libfdk-aac-dev \
    libmp3lame-dev \
    libopus-dev \
    libass-dev \
    libfreetype6-dev \
    libgnutls28-dev \
    libnuma-dev \
    libzimg-dev \
    && rm -rf /var/lib/apt/lists/*

# NVIDIA Video Codec SDK headers (nv-codec-headers)
RUN git clone --depth 1 --branch n12.2.72.0 \
    https://git.videolan.org/git/ffmpeg/nv-codec-headers.git /tmp/nv-codec-headers && \
    cd /tmp/nv-codec-headers && make install && \
    rm -rf /tmp/nv-codec-headers

# Build FFmpeg 7.1 with NVENC + NVDEC + CUDA
RUN git clone --depth 1 --branch n7.1 https://git.ffmpeg.org/ffmpeg.git /tmp/ffmpeg && \
    cd /tmp/ffmpeg && \
    ./configure \
        --prefix=/usr/local/ffmpeg \
        --enable-gpl \
        --enable-nonfree \
        --enable-cuda-nvcc \
        --enable-libnpp \
        --enable-nvenc \
        --enable-nvdec \
        --enable-cuvid \
        --enable-libx264 \
        --enable-libx265 \
        --enable-libvpx \
        --enable-libfdk-aac \
        --enable-libmp3lame \
        --enable-libopus \
        --enable-libass \
        --enable-libfreetype \
        --enable-libzimg \
        --enable-gnutls \
        --extra-cflags="-I/usr/local/cuda/include" \
        --extra-ldflags="-L/usr/local/cuda/lib64" \
        --disable-doc \
        --disable-debug \
        --enable-shared \
        --disable-static && \
    make -j$(nproc) && \
    make install && \
    rm -rf /tmp/ffmpeg


# ============================================================
# Runtime stage
# ============================================================
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility,video

# ── System deps + Chrome deps ──────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    gnupg \
    unzip \
    python3 \
    pip \
    # Chrome/Chromium dependencies
    libnss3 \
    libdbus-1-3 \
    libatk1.0-0 \
    libasound2 \
    libxrandr2 \
    libxkbcommon0 \
    libxfixes3 \
    libxcomposite1 \
    libxdamage1 \
    libgbm1 \
    libcups2 \
    libcairo2 \
    libpango-1.0-0 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxshmfence1 \
    fonts-noto \
    fonts-noto-cjk \
    fonts-liberation \
    # FFmpeg runtime deps
    libx264-163 \
    libx265-199 \
    libvpx7 \
    libfdk-aac2 \
    libmp3lame0 \
    libopus0 \
    libass9 \
    libfreetype6 \
    libzimg2 \
    libnuma1 \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 + bun ───────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# ── Copy FFmpeg from builder ────────────────────────────────
COPY --from=ffmpeg-builder /usr/local/ffmpeg /usr/local/ffmpeg
ENV PATH="/usr/local/ffmpeg/bin:${PATH}"
ENV LD_LIBRARY_PATH="/usr/local/ffmpeg/lib:${LD_LIBRARY_PATH}"

# ── Copy Remotion fork ──────────────────────────────────────
WORKDIR /app
COPY . /app/

# ── Install + Build (only renderer and dependencies) ───────
RUN bun install --frozen-lockfile || bun install
RUN npx turbo run make --filter=@remotion/cli... --no-update-notifier

# ── Setup custom binaries directory ─────────────────────────
# Combines NVENC-enabled FFmpeg with Remotion's compositor binary
RUN mkdir -p /app/custom-bin && \
    ln -sf /usr/local/ffmpeg/bin/ffmpeg /app/custom-bin/ffmpeg && \
    ln -sf /usr/local/ffmpeg/bin/ffprobe /app/custom-bin/ffprobe && \
    cp /app/packages/compositor-linux-x64-gnu/remotion /app/custom-bin/remotion && \
    chmod +x /app/custom-bin/remotion

# ── Ensure Chrome browser ──────────────────────────────────
RUN cd /app && node_modules/.bin/remotion browser ensure

# ── Copy test assets and scripts ────────────────────────────
COPY docker/test-composition /app/test-composition
COPY docker/scripts /app/scripts

RUN cd /app/test-composition && bun install

# ── Verify setup ────────────────────────────────────────────
RUN echo "=== NVENC Check ===" && \
    /usr/local/ffmpeg/bin/ffmpeg -hide_banner -encoders 2>&1 | grep nvenc && \
    echo "=== GPU Check ===" && \
    (nvidia-smi 2>/dev/null || echo "nvidia-smi not available at build time (expected)") && \
    echo "=== Node ===" && node --version && \
    echo "=== Bun ===" && bun --version

WORKDIR /app
ENTRYPOINT ["bash"]
