<p align="center">
  <img src="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-dark.apng" alt="Remotion Scale Fork" width="600">
</p>

<h1 align="center">Remotion Scale Rendering Fork</h1>

<p align="center">
  Renderização de vídeo em escala com GPUs NVIDIA.<br/>
  60+ clips simultâneos. 4.4x mais rápido. Open source.
</p>

<p align="center">
  <a href="#benchmark">Benchmark</a> &bull;
  <a href="#como-usar">Como Usar</a> &bull;
  <a href="#docker">Docker</a> &bull;
  <a href="#api-reference">API</a> &bull;
  <a href="SCALE_RENDERING.md">Docs Completos</a> &bull;
  <a href="DOCKER_API.md">Docker API</a>
</p>

---

## O Problema

Remotion vanilla cria um Chrome + FFmpeg isolado por job de render. Com 40 jobs simultâneos:

```
40 Chrome instances    = 24-40GB RAM
40 FFmpeg (libx264)    = 32GB RAM + CPU saturada
40 jobs escrevendo     = I/O de disco saturado
Total                  = ~120GB RAM. Inviável.
```

## A Solução

5 otimizações cirúrgicas no `packages/renderer`:

| # | Otimização | O que faz | Arquivo |
|---|-----------|-----------|---------|
| 1 | **NVENC Encoding** | h264_nvenc/hevc_nvenc — GPU encoda, CPU livre | `nvenc-detection.ts`, `get-codec-name.ts` |
| 2 | **Browser Pool** | 40 jobs compartilham 5 Chrome instances | `browser-pool.ts` |
| 3 | **Pipe Mode** | Frames direto pro FFmpeg, zero disco | `prestitcher-memory-usage.ts` |
| 4 | **Job Scheduler** | Fila com prioridade + controle NVENC | `job-scheduler.ts` |
| 5 | **Scale Defaults** | Auto-config pra alta concorrência | `scale-defaults.ts` |

**Resultado: 120GB RAM -> 44GB. 122 min -> 28 min para 60 clips.**

---

<a name="benchmark"></a>
## Benchmark

Testado em produção no **vast.ai** com vídeo real (68MB, 1080x1920, 1:16).

### Viral Stress Test (60s, TikTok vertical, 8 layers)

Composição com: OffthreadVideo + Ken Burns + Shake + Zoom Pulse + Blur dinâmico + Legendas animadas (pop/karaoke/bounce/glow) + Lower Thirds + Partículas + Vignette + Flash + Progress Bar

**NVIDIA L40 (46GB VRAM) | 256 cores | 1TB RAM**

| Cenário | Tempo Total | Por Clip | Throughput |
|---------|------------|----------|------------|
| 1 clip (baseline) | 121.9s | 121.9s | 0.5 clips/min |
| 5 simultâneos | 156.9s | 31.4s | 1.9 clips/min |
| **10 simultâneos** | **242.1s** | **24.2s** | **2.5 clips/min** |
| 20 simultâneos | 556.7s | 27.8s | 2.2 clips/min |

```
60 clips sequencial:  122 min (2 horas)
60 clips fork (20x):   28 min
Speedup:              4.4x
```

### Composição simples (10s, 1920x1080)

**RTX A6000 (48GB VRAM) | 96 cores | 472GB RAM**

| Cenário | Tempo Total | Speedup |
|---------|------------|---------|
| Vanilla (5 sequencial) | 171.2s | 1.0x |
| Fork (5 simultâneos) | 86.1s | **1.99x** |

---

<a name="como-usar"></a>
## Como Usar

### Quick Start (programático)

```typescript
import {
  BrowserPoolManager,
  JobScheduler,
  initializeNvencDetection,
  getRecommendedScaleConfig,
  selectComposition,
} from '@remotion/renderer';

// 1. Inicializar NVENC
await initializeNvencDetection({
  indent: false,
  logLevel: 'info',
  binariesDirectory: null,
});

// 2. Config recomendada para 20 jobs
const config = getRecommendedScaleConfig(20);

// 3. Browser pool compartilhado
const pool = await BrowserPoolManager.create({
  browserOptions: {},
  maxBrowsers: config.maxBrowsers,
});

// 4. Scheduler
const scheduler = new JobScheduler({
  maxConcurrentJobs: 20,
  browserPool: pool,
  nvencGpuType: 'enterprise',
});

// 5. Renderizar 60 clips
const results = await scheduler.addBatch(
  clips.map((clip) => ({
    options: {
      serveUrl: 'http://localhost:3000/bundle',
      composition: clip,
      codec: 'h264',
      outputLocation: `./output/${clip.id}.mp4`,
      hardwareAcceleration: 'if-possible',
      forceParallelEncoding: true,
    },
  })),
);

// 6. Cleanup
await scheduler.shutdown();
await pool.closeAll();
```

### CLI

```bash
# Render com NVENC
npx remotion render src/index.ts MyComp out.mp4 \
  --hardware-acceleration=if-possible \
  --force-parallel-encoding \
  --nvenc-gpu-index=0
```

---

<a name="docker"></a>
## Docker

Imagem pública com FFmpeg NVENC + Chrome headless + fork completo:

```bash
docker run --gpus all --shm-size=8g \
  -v ./bundle:/bundle \
  -v ./output:/output \
  ghcr.io/gabriellasyai/remotion-scale:latest \
  node /app/worker.mjs
```

**3 modos de integração:**
- **Worker script** — docker exec com JSON de jobs
- **HTTP API** — POST /render/batch, qualquer linguagem
- **vast.ai** — GPU on-demand, burst rendering

Docs completos: **[DOCKER_API.md](DOCKER_API.md)**

---

<a name="api-reference"></a>
## API Reference

### Novos exports de `@remotion/renderer`

#### `initializeNvencDetection(options)`
Detecta h264_nvenc/hevc_nvenc no FFmpeg. Chamar uma vez no startup.

#### `BrowserPoolManager.create(config)`
Pool de Chrome instances compartilhadas. Configs: `maxBrowsers`, `pagesPerBrowser`, `maxPagesBeforeRecycle`.

#### `JobScheduler(config)`
Orquestrador de jobs com fila de prioridade. Configs: `maxConcurrentJobs`, `browserPool`, `nvencGpuType`.

#### `getRecommendedScaleConfig(concurrentJobs)`
Retorna configuração otimizada dado o número de jobs planejados.

#### `SCALE_DEFAULTS`
Constantes para renderização em escala (jpegQuality, concurrencyPerJob, etc).

### Novas opções de `renderMedia()`

| Opção | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `hardwareAcceleration` | `'disable' \| 'if-possible' \| 'required'` | `'disable'` | Habilita NVENC no Linux/Windows |
| `forceParallelEncoding` | `boolean` | `false` | Pipe mode forçado (sem heurística de memória) |
| `browserPool` | `BrowserPoolManager` | `undefined` | Pool compartilhado de browsers |

### Novas opções CLI

| Flag | Descrição |
|------|-----------|
| `--hardware-acceleration` | `disable` / `if-possible` / `required` |
| `--force-parallel-encoding` | Ativa pipe mode sempre |
| `--nvenc-gpu-index` | Índice da GPU para NVENC (multi-GPU) |

---

## GPUs Compatíveis

| GPU | NVENC Sessions | Uso |
|-----|---------------|-----|
| GeForce GTX 1050+ | 3-5 max | Dev/teste |
| GeForce RTX 4070/4090 | 5 max | Produção pequena |
| Tesla T4 | Ilimitado | Produção |
| NVIDIA L4 | Ilimitado | Produção |
| NVIDIA L40 | Ilimitado | Produção pesada |
| NVIDIA A10/A100 | Ilimitado | Enterprise |

Consumer GPUs funcionam — o `NvencSessionManager` enfileira automaticamente.

---

## Servidor Recomendado

```
CPU:    32 cores (AMD EPYC / Xeon)
RAM:    128GB
GPU:    NVIDIA T4/L4 (enterprise, NVENC ilimitado)
Disco:  2TB NVMe
OS:     Ubuntu 22.04

Custo: ~$300-500/mês (Hetzner/OVH)
```

---

## Estrutura do Fork

```
packages/renderer/src/
├── nvenc-detection.ts          # Detecção de NVENC via FFmpeg probe
├── browser-pool.ts             # BrowserPoolManager
├── browser-pool-config.ts      # Tipos de configuração
├── job-scheduler.ts            # JobScheduler com fila de prioridade
├── job-queue.ts                # AsyncQueue genérica
├── nvenc-session-manager.ts    # Semáforo de sessões NVENC
├── scale-defaults.ts           # Defaults para renderização em escala
├── options/
│   ├── force-parallel-encoding.tsx
│   └── nvenc-gpu-index.tsx
├── get-codec-name.ts           # (modificado) NVENC para Linux/Windows
├── ffmpeg-args.ts              # (modificado) flags NVENC
├── prestitcher-memory-usage.ts # (modificado) estimativa menor com NVENC
├── render-media.ts             # (modificado) browserPool + forceParallelEncoding
├── render-frames.ts            # (modificado) integração browser pool
└── crf.ts                      # (modificado) CRF → CQ para NVENC
```

**9 arquivos novos | 24 arquivos modificados | ~1.630 linhas adicionadas**

---

## Build

```bash
git clone https://github.com/gabriellasyai/remotion.git
cd remotion
git checkout scale-rendering
bun install
bun run build
```

### Docker

```bash
# Build local (usa Podman ou Docker)
podman build -f docker/Dockerfile -t remotion-scale:latest .

# Ou usa a imagem pré-buildada
docker pull ghcr.io/gabriellasyai/remotion-scale:latest
```

---

## Baseado em

Este fork é baseado no [Remotion](https://github.com/remotion-dev/remotion) por [Jonny Burger](https://github.com/JonnyBurger). Remotion tem licença especial — leia [LICENSE.md](LICENSE.md).

## Autor

**[@gabriellasyai](https://github.com/gabriellasyai)**

Fork focado em renderização de vídeo viral em escala para TikTok/Reels/Shorts.
