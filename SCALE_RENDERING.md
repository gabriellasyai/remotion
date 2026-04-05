# Remotion Scale Rendering Fork

High-scale rendering engine built on top of Remotion. Designed for producing **60-70+ video clips simultaneously** with 30-40 concurrent render jobs.

## Problem

Vanilla Remotion spawns an isolated Chrome browser + FFmpeg process per render job. At 40 concurrent jobs this means:

- 40 Chrome processes (~24-40GB RAM)
- 40 FFmpeg software encoders fighting for CPU
- Thousands of intermediate frames written to disk per second
- System becomes I/O and memory bound, not CPU bound

This fork solves that with 5 integrated optimizations.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   JobScheduler                       │
│  - Priority queue                                    │
│  - Concurrency control (maxConcurrentJobs)           │
│  - NVENC session management (semaphore)              │
│  - Lifecycle callbacks (progress, complete, error)   │
├─────────────────────────────────────────────────────┤
│               BrowserPoolManager                     │
│  - N shared Chrome instances (not 1 per job)         │
│  - Load-balanced page distribution                   │
│  - Crash recovery + automatic recycling              │
├─────────────────────────────────────────────────────┤
│                 renderMedia()                         │
│  - NVENC hardware encoding (h264_nvenc/hevc_nvenc)   │
│  - Force pipe mode (frames → FFmpeg stdin, no disk)  │
│  - Tuned defaults for scale (JPEG 70, low threads)   │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

### Installation

```bash
git clone <this-repo>
cd remotion
bun install
bun run build
```

### Minimal Example

```typescript
import {
  BrowserPoolManager,
  JobScheduler,
  initializeNvencDetection,
} from '@remotion/renderer';

// Initialize NVENC detection (call once at startup)
await initializeNvencDetection({
  indent: false,
  logLevel: 'info',
  binariesDirectory: null,
});

// Create shared browser pool
const pool = await BrowserPoolManager.create({
  browserOptions: {},
  maxBrowsers: 4,       // 4 Chrome instances
  pagesPerBrowser: 8,   // 8 tabs each = 32 concurrent pages
});

// Create job scheduler
const scheduler = new JobScheduler({
  maxConcurrentJobs: 30,
  browserPool: pool,
  nvencGpuType: 'enterprise',   // T4/L4/A10 = unlimited NVENC sessions
  onJobComplete: (job) => console.log(`Done: ${job.id}`),
  onJobError: (job, err) => console.error(`Failed: ${job.id}`, err.message),
});

// Enqueue clips
const results = await scheduler.addBatch(
  clips.map((clip) => ({
    options: {
      serveUrl: 'http://localhost:3000/bundle',
      composition: clip,
      codec: 'h264',
      outputLocation: `./output/${clip.id}.mp4`,
      hardwareAcceleration: 'if-possible',
    },
  })),
);

// Cleanup
await scheduler.shutdown();
await pool.closeAll();
```

---

## API Reference

### `initializeNvencDetection(options)`

Probes FFmpeg for NVENC encoder availability. **Must be called once before rendering.**

```typescript
await initializeNvencDetection({
  indent: false,
  logLevel: 'info',          // 'verbose' for debug output
  binariesDirectory: null,   // custom FFmpeg path, or null for system default
});
```

Returns `true` if `h264_nvenc` is available, `false` otherwise.

---

### `BrowserPoolManager`

Manages a pool of Chrome browser instances shared across all render jobs.

#### `BrowserPoolManager.create(config)`

```typescript
const pool = await BrowserPoolManager.create({
  // Required
  browserOptions: {},              // ChromiumOptions (same as renderMedia)

  // Optional (all have sensible defaults)
  maxBrowsers: 4,                  // default: ceil(cpuCount / 8)
  pagesPerBrowser: 8,              // default: 8
  maxPagesBeforeRecycle: 200,      // recycle browser after N pages served
  chromeMode: 'headless-shell',    // default: 'headless-shell'
  logLevel: 'info',
  indent: false,
  browserExecutable: null,         // custom Chrome path
  forceDeviceScaleFactor: undefined,
});
```

#### `pool.acquirePage()`

```typescript
const {browser, page} = await pool.acquirePage();
// ... use the page ...
pool.releasePage(browser, page);
```

#### `pool.acquireBrowser()`

Used internally by `renderMedia()` when `browserPool` option is provided.

```typescript
const {browser, release} = await pool.acquireBrowser();
// ... render job uses the browser ...
release();  // returns browser to pool
```

#### `pool.getStats()`

```typescript
const stats = pool.getStats();
// { activeBrowsers: 4, activePages: 28, queuedRequests: 0 }
```

#### `pool.closeAll()`

Gracefully closes all browsers and rejects queued requests.

---

### `JobScheduler`

Orchestrates concurrent render jobs with priority queuing and NVENC session management.

#### Constructor

```typescript
const scheduler = new JobScheduler({
  maxConcurrentJobs: 40,           // default: 4
  maxConcurrentEncodes: 5,         // default: based on nvencGpuType
  browserPool: pool,               // from BrowserPoolManager.create()
  nvencGpuType: 'enterprise',      // 'consumer' (5 sessions) | 'enterprise' (unlimited)

  // Lifecycle callbacks
  onJobStart: (job) => {},
  onJobProgress: (job, progress) => {},
  onJobComplete: (job) => {},
  onJobError: (job, error) => {},
});
```

#### `scheduler.addJob(options, priority?)`

Add a single render job. Returns when complete.

```typescript
const result = await scheduler.addJob({
  serveUrl: 'http://localhost:3000/bundle',
  composition: myComposition,
  codec: 'h264',
  outputLocation: './output/clip.mp4',
  hardwareAcceleration: 'if-possible',
  jpegQuality: 70,
  concurrency: 4,
}, 0);  // priority 0 = highest
```

#### `scheduler.addBatch(jobs)`

Add multiple jobs. Returns ordered results when ALL complete.

```typescript
const results = await scheduler.addBatch([
  { options: { ...clip1Options }, priority: 0 },
  { options: { ...clip2Options }, priority: 1 },
  { options: { ...clip3Options }, priority: 1 },
]);
// results[0] = clip1 result, results[1] = clip2 result, ...
```

#### `scheduler.getStats()`

```typescript
const stats = scheduler.getStats();
// { queued: 12, rendering: 8, completed: 40, failed: 0, totalJobs: 60 }
```

#### `scheduler.waitForAll()`

Block until all queued and in-progress jobs finish.

#### `scheduler.cancelPending()`

Cancel all queued jobs. In-progress jobs continue to completion.

#### `scheduler.shutdown()`

Graceful shutdown: cancels pending, waits for active, closes NVENC manager.

---

### `getRecommendedScaleConfig(concurrentJobs)`

Returns optimal settings for a given number of concurrent jobs.

```typescript
import { getRecommendedScaleConfig } from '@remotion/renderer';

const config = getRecommendedScaleConfig(40);
// {
//   concurrencyPerJob: 2,        // tabs per job (adaptive to CPU count)
//   maxBrowsers: 5,              // Chrome instances needed
//   jpegQuality: 70,             // lower for scale (vs 80 default)
//   offthreadVideoThreads: 1,    // conservative for scale
//   cycleIntervalMs: 1000,       // slower tab cycling with many tabs
// }
```

---

### `SCALE_DEFAULTS`

Static defaults for high-scale rendering. Use directly or as reference.

```typescript
import { SCALE_DEFAULTS } from '@remotion/renderer';

SCALE_DEFAULTS.jpegQuality;           // 70
SCALE_DEFAULTS.concurrencyPerJob;     // 4
SCALE_DEFAULTS.pagesPerBrowser;       // 8
SCALE_DEFAULTS.maxBrowsers(32);       // ceil(32/8) = 4
SCALE_DEFAULTS.cycleIntervalMs(160);  // max(200, 160*25) = 4000 → capped at 2000
SCALE_DEFAULTS.offthreadVideoThreads; // 1
SCALE_DEFAULTS.videoThreadsPerJob(32, 40); // max(1, floor(32/80)) = 1
```

---

### New CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--hardware-acceleration` | `disable` | `'disable'` \| `'if-possible'` \| `'required'` — enables NVENC on Linux/Windows |
| `--force-parallel-encoding` | `false` | Bypass memory heuristic, always pipe frames to FFmpeg stdin |
| `--nvenc-gpu-index` | `0` | GPU device index for NVENC (multi-GPU systems) |

---

## Full Production Example

```typescript
import {
  BrowserPoolManager,
  JobScheduler,
  initializeNvencDetection,
  getRecommendedScaleConfig,
  bundle,
  selectComposition,
} from '@remotion/renderer';

// ── Configuration ──────────────────────────────────

const CONCURRENT_JOBS = 40;
const GPU_TYPE = 'enterprise';   // T4/L4/A10
const SERVE_URL = 'http://localhost:3000/bundle';

// ── Bootstrap ──────────────────────────────────────

async function main() {
  // 1. Detect NVENC
  const nvencAvailable = await initializeNvencDetection({
    indent: false,
    logLevel: 'info',
    binariesDirectory: null,
  });
  console.log(`NVENC available: ${nvencAvailable}`);

  // 2. Get recommended config
  const scaleConfig = getRecommendedScaleConfig(CONCURRENT_JOBS);
  console.log('Scale config:', scaleConfig);

  // 3. Create browser pool
  const pool = await BrowserPoolManager.create({
    browserOptions: {},
    maxBrowsers: scaleConfig.maxBrowsers,
    pagesPerBrowser: 8,
    logLevel: 'info',
  });

  // 4. Create scheduler
  const scheduler = new JobScheduler({
    maxConcurrentJobs: CONCURRENT_JOBS,
    browserPool: pool,
    nvencGpuType: GPU_TYPE,
    onJobStart: (job) => {
      console.log(`[START] ${job.id}`);
    },
    onJobProgress: (job, progress) => {
      const pct = Math.round(progress.progress * 100);
      process.stdout.write(`\r[${job.id}] ${pct}% | ${progress.renderedFrames} frames`);
    },
    onJobComplete: (job) => {
      console.log(`\n[DONE] ${job.id}`);
    },
    onJobError: (job, error) => {
      console.error(`\n[FAIL] ${job.id}: ${error.message}`);
    },
  });

  // 5. Define clips to render
  const clips = [
    { id: 'intro-001', compositionId: 'MyComp', inputProps: { text: 'Hello' } },
    { id: 'intro-002', compositionId: 'MyComp', inputProps: { text: 'World' } },
    // ... 60+ clips
  ];

  // 6. Resolve compositions and enqueue
  const jobs = await Promise.all(
    clips.map(async (clip) => {
      const composition = await selectComposition({
        serveUrl: SERVE_URL,
        id: clip.compositionId,
        inputProps: clip.inputProps,
      });

      return {
        options: {
          serveUrl: SERVE_URL,
          composition,
          codec: 'h264' as const,
          outputLocation: `./output/${clip.id}.mp4`,
          hardwareAcceleration: 'if-possible' as const,
          forceParallelEncoding: true,
          jpegQuality: scaleConfig.jpegQuality,
          concurrency: scaleConfig.concurrencyPerJob,
        },
      };
    }),
  );

  // 7. Render all clips
  console.log(`\nRendering ${jobs.length} clips with ${CONCURRENT_JOBS} concurrent jobs...\n`);
  const startTime = Date.now();

  try {
    const results = await scheduler.addBatch(jobs);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nAll ${results.length} clips rendered in ${elapsed}s`);
  } catch (error) {
    console.error('Batch failed:', error);
  }

  // 8. Cleanup
  await scheduler.shutdown();
  await pool.closeAll();
}

main().catch(console.error);
```

---

## Recommended Server Configuration

### For 30-40 concurrent jobs (production)

```
CPU:    32 cores / 64 threads (AMD EPYC 7543 or equivalent)
RAM:    128GB DDR5 ECC
GPU:    NVIDIA T4 16GB or L4 24GB (enterprise — unlimited NVENC sessions)
Disk:   2TB NVMe Gen4
OS:     Ubuntu 22.04 LTS
```

**Estimated cost:**
- Hetzner/OVH bare metal: ~$300-500/month
- AWS g4dn.8xlarge (T4): ~$1,300/month
- GCP g2-standard-32 (L4): ~$1,000/month

### GPU Selection Guide

| GPU | NVENC Sessions | VRAM | Best For |
|-----|---------------|------|----------|
| GeForce RTX 4070 | 5 max | 12GB | Dev/testing, <15 concurrent jobs |
| GeForce RTX 4090 | 5 max | 24GB | Dev/testing, <15 concurrent jobs |
| Tesla T4 | Unlimited | 16GB | Production, 30-40 concurrent jobs |
| NVIDIA L4 | Unlimited | 24GB | Production, 40+ concurrent jobs |
| NVIDIA A10 | Unlimited | 24GB | Heavy production, 50+ concurrent jobs |

**Consumer GPUs (GeForce):** Max 3-5 simultaneous NVENC sessions. Use `nvencGpuType: 'consumer'` — the scheduler will queue encoding jobs beyond the limit.

**Enterprise GPUs (T4/L4/A10):** No session limit. Use `nvencGpuType: 'enterprise'`.

---

## Resource Estimation

### With this fork (optimized)

```
40 concurrent jobs:

  Shared browser pool (5 instances × 2.5GB)  = 12.5GB
  40 Node.js workers × 300MB                 = 12GB
  40 FFmpeg NVENC (low RAM) × 100MB          = 4GB
  OS + buffers + asset cache                 = 8GB
  ─────────────────────────────────────────────
  Total:                                      ~36GB
  With 1.5x safety margin:                   ~54GB → 64GB works, 128GB comfortable
```

### Without this fork (vanilla Remotion)

```
40 concurrent jobs:

  40 Chrome processes × 1.5GB               = 60GB
  40 FFmpeg libx264 × 800MB                 = 32GB
  40 Node.js × 300MB                        = 12GB
  OS + overhead                              = 10GB
  ─────────────────────────────────────────────
  Total:                                      ~114GB
  With 1.5x safety margin:                   ~170GB → needs 192-256GB
```

---

## How Each Optimization Works

### 1. NVENC Hardware Encoding

Offloads H.264/H.265 encoding from CPU to NVIDIA GPU. The CPU is freed for Chrome frame capture.

```
Before: 40 × libx264 = CPU saturated between capture + encoding
After:  40 × h264_nvenc = CPU 100% for capture, GPU handles encoding
```

FFmpeg flags generated: `-c:v h264_nvenc -rc constqp -cq <quality> -preset p4 -gpu 0`

### 2. Shared Browser Pool

Instead of 40 isolated Chrome processes, shares 4-6 Chrome instances with tabs distributed across jobs.

```
Before: 40 browsers × 600MB = 24GB
After:  5 browsers × 2.5GB  = 12.5GB
```

### 3. Force Pipe Mode

Frames go directly from Chrome → FFmpeg stdin. No disk I/O.

```
Before: Chrome → JPEG → disk write → FFmpeg reads from disk
After:  Chrome → JPEG → pipe → FFmpeg stdin (image2pipe)
```

### 4. Job Scheduler

Prevents resource exhaustion by controlling concurrency and NVENC session allocation.

### 5. Performance Tuning

Adaptive defaults: lower JPEG quality (70 vs 80), slower tab cycling, conservative thread allocation.

---

## Troubleshooting

### NVENC not detected

```
NVENC hardware acceleration not available, falling back to software encoding (libx264)
```

Check:
1. NVIDIA drivers installed: `nvidia-smi`
2. FFmpeg has NVENC support: `ffmpeg -encoders | grep nvenc`
3. If using custom FFmpeg: pass `binariesDirectory` to `initializeNvencDetection()`

### Out of memory

- Reduce `maxConcurrentJobs`
- Reduce `pagesPerBrowser` (default 8 → try 4)
- Lower `maxBrowsers`
- Use `getRecommendedScaleConfig()` for automatic tuning

### Browser crashes

The `BrowserPoolManager` automatically recovers from browser crashes:
- Removes crashed browser from pool
- Launches replacement on next page request
- In-progress pages on crashed browser will fail and can be retried by the scheduler

### NVENC session limit reached (consumer GPU)

```
NvencSessionManager: waiting for available session...
```

This is expected on GeForce GPUs (5 session limit). Jobs queue and proceed as sessions free up. For no limits, use enterprise GPU or set higher `maxConcurrentEncodes`.

---

## Production Benchmark Results (2026-04-05)

All benchmarks ran on **vast.ai** with real video content (68MB, 1080x1920, 1:16 duration).

### Test 1: Simple Composition (10s clip, 1920x1080)
**Machine:** RTX A6000 (48GB VRAM), 96 cores, 472GB RAM

| Scenario | Total Time | Per Clip | Speedup |
|----------|-----------|----------|---------|
| Vanilla (5 sequential, libx264) | 171.2s | 34.2s | 1.0x |
| Fork (5 concurrent, NVENC+pool) | 86.1s | 17.2s | **1.99x** |

### Test 2: Viral Stress Test (60s clip, 1080x1920, 8 layers)
**Machine:** NVIDIA L40 (46GB VRAM), 256 cores, 1TB RAM
**Composition layers:** OffthreadVideo + Ken Burns + Shake + Zoom Pulse + Dynamic Blur + Animated Captions (pop/karaoke/bounce/glow) + Lower Thirds + Particles + Vignette + Flash Transitions + Progress Bar

| Scenario | Total Time | Per Clip | Throughput |
|----------|-----------|----------|------------|
| 1 clip (baseline) | 121.9s | 121.9s | 0.5 clips/min |
| 5 concurrent | 156.9s | 31.4s | 1.9 clips/min |
| **10 concurrent** | **242.1s** | **24.2s** | **2.5 clips/min** |
| 20 concurrent | 556.7s | 27.8s | 2.2 clips/min |

**Key findings:**
- **Sweet spot: 10 concurrent jobs** = maximum throughput (2.5 clips/min)
- **4.4x speedup** at 20 concurrent vs sequential
- **60 clips projection:** 28 min (fork) vs 122 min (sequential)
- Beyond 10 concurrent, diminishing returns due to Chrome memory pressure per tab
