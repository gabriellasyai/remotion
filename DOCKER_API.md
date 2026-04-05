# Docker API — Remotion Scale Rendering

Guia para integrar o fork de renderização em escala no seu app via Docker.

## Imagem

```
ghcr.io/gabriellasyai/remotion-scale:latest
```

Pública. Inclui FFmpeg com NVENC, Chrome headless, e todo o fork buildado.

## Arquitetura

```
┌──────────────┐       HTTP/gRPC        ┌──────────────────────────┐
│   Seu App    │ ────────────────────→   │  Container Docker        │
│  (qualquer   │   envia jobs de render  │  remotion-scale:latest   │
│  linguagem)  │ ←────────────────────   │                          │
│              │   recebe .mp4 pronto    │  Node.js worker interno  │
└──────────────┘                         │  JobScheduler + NVENC    │
                                         │  BrowserPool + Pipe      │
                                         └──────────────────────────┘
```

O container roda um worker Node.js que expõe uma API para receber jobs de render. Seu app (Python, Go, PHP, qualquer coisa) envia requests e recebe os vídeos prontos.

---

## Modo 1: Worker Script Direto

Crie um script `worker.mjs` que seu app executa via `docker exec` ou monta como volume:

```javascript
// worker.mjs
import {
  BrowserPoolManager,
  JobScheduler,
  initializeNvencDetection,
  getRecommendedScaleConfig,
  bundle,
  selectComposition,
} from '@remotion/renderer';
import fs from 'fs';

const CONCURRENT_JOBS = parseInt(process.env.CONCURRENT_JOBS || '10');
const GPU_TYPE = process.env.GPU_TYPE || 'enterprise';
const SERVE_URL = process.env.SERVE_URL;
const JOBS_FILE = process.env.JOBS_FILE; // JSON com lista de clips

async function main() {
  // Setup
  await initializeNvencDetection({
    indent: false,
    logLevel: 'info',
    binariesDirectory: '/app/custom-bin',
  });

  const scaleConfig = getRecommendedScaleConfig(CONCURRENT_JOBS);

  const pool = await BrowserPoolManager.create({
    browserOptions: {},
    maxBrowsers: scaleConfig.maxBrowsers,
    pagesPerBrowser: 8,
    logLevel: 'warn',
  });

  const scheduler = new JobScheduler({
    maxConcurrentJobs: CONCURRENT_JOBS,
    browserPool: pool,
    nvencGpuType: GPU_TYPE,
    onJobComplete: (job) => console.log(`[DONE] ${job.id}`),
    onJobError: (job, err) => console.error(`[FAIL] ${job.id}: ${err.message}`),
  });

  // Ler jobs do arquivo JSON
  const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));

  const renderJobs = await Promise.all(
    jobs.map(async (job) => {
      const composition = await selectComposition({
        serveUrl: SERVE_URL,
        id: job.compositionId,
        inputProps: job.inputProps,
      });

      return {
        options: {
          serveUrl: SERVE_URL,
          composition,
          codec: 'h264',
          outputLocation: job.outputPath,
          hardwareAcceleration: 'if-possible',
          forceParallelEncoding: true,
          binariesDirectory: '/app/custom-bin',
          jpegQuality: scaleConfig.jpegQuality,
          concurrency: scaleConfig.concurrencyPerJob,
          logLevel: 'warn',
        },
      };
    }),
  );

  console.log(`Rendering ${renderJobs.length} clips...`);
  const start = Date.now();
  await scheduler.addBatch(renderJobs);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`All done in ${elapsed}s`);

  await scheduler.shutdown();
  await pool.closeAll();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

### Rodar

```bash
# 1. Preparar o JSON de jobs
cat > /tmp/jobs.json << 'EOF'
[
  {
    "compositionId": "MyVideo",
    "inputProps": {"text": "Clip 1", "videoUrl": "/data/video1.mp4"},
    "outputPath": "/output/clip-1.mp4"
  },
  {
    "compositionId": "MyVideo",
    "inputProps": {"text": "Clip 2", "videoUrl": "/data/video2.mp4"},
    "outputPath": "/output/clip-2.mp4"
  }
]
EOF

# 2. Rodar o container
docker run --gpus all --shm-size=8g \
  -v /caminho/seu/bundle:/bundle \
  -v /caminho/seus/videos:/data \
  -v /caminho/output:/output \
  -v /tmp/jobs.json:/tmp/jobs.json \
  -v /caminho/worker.mjs:/app/worker.mjs \
  -e SERVE_URL=/bundle \
  -e JOBS_FILE=/tmp/jobs.json \
  -e CONCURRENT_JOBS=10 \
  -e GPU_TYPE=enterprise \
  ghcr.io/gabriellasyai/remotion-scale:latest \
  node /app/worker.mjs
```

---

## Modo 2: HTTP API Server

Crie um server Express/Fastify dentro do container que recebe jobs via POST:

```javascript
// server.mjs
import express from 'express';
import {
  BrowserPoolManager,
  JobScheduler,
  initializeNvencDetection,
  getRecommendedScaleConfig,
  selectComposition,
} from '@remotion/renderer';
import fs from 'fs';

const app = express();
app.use(express.json());

let scheduler;
let pool;
let ready = false;

async function init() {
  await initializeNvencDetection({
    indent: false,
    logLevel: 'info',
    binariesDirectory: '/app/custom-bin',
  });

  const config = getRecommendedScaleConfig(
    parseInt(process.env.CONCURRENT_JOBS || '10'),
  );

  pool = await BrowserPoolManager.create({
    browserOptions: {},
    maxBrowsers: config.maxBrowsers,
    pagesPerBrowser: 8,
    logLevel: 'warn',
  });

  scheduler = new JobScheduler({
    maxConcurrentJobs: parseInt(process.env.CONCURRENT_JOBS || '10'),
    browserPool: pool,
    nvencGpuType: process.env.GPU_TYPE || 'enterprise',
  });

  ready = true;
  console.log('Renderer ready');
}

// Health check
app.get('/health', (req, res) => {
  res.json({ ready, stats: scheduler?.getStats() });
});

// Render single clip
app.post('/render', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'Not ready' });

  const { serveUrl, compositionId, inputProps, outputPath } = req.body;

  try {
    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps,
    });

    const result = await scheduler.addJob({
      serveUrl,
      composition,
      codec: 'h264',
      outputLocation: outputPath,
      hardwareAcceleration: 'if-possible',
      forceParallelEncoding: true,
      binariesDirectory: '/app/custom-bin',
      logLevel: 'warn',
    });

    const size = fs.statSync(outputPath).size;
    res.json({ success: true, outputPath, size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Render batch
app.post('/render/batch', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'Not ready' });

  const { serveUrl, jobs } = req.body;

  try {
    const renderJobs = await Promise.all(
      jobs.map(async (job) => {
        const composition = await selectComposition({
          serveUrl,
          id: job.compositionId,
          inputProps: job.inputProps,
        });
        return {
          options: {
            serveUrl,
            composition,
            codec: 'h264',
            outputLocation: job.outputPath,
            hardwareAcceleration: 'if-possible',
            forceParallelEncoding: true,
            binariesDirectory: '/app/custom-bin',
            logLevel: 'warn',
          },
        };
      }),
    );

    const start = Date.now();
    await scheduler.addBatch(renderJobs);
    const elapsed = (Date.now() - start) / 1000;

    res.json({
      success: true,
      count: jobs.length,
      totalSeconds: elapsed,
      avgPerClip: elapsed / jobs.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats
app.get('/stats', (req, res) => {
  res.json({
    scheduler: scheduler?.getStats(),
    pool: pool?.getStats(),
  });
});

init().then(() => {
  app.listen(3333, () => console.log('API running on :3333'));
});
```

### Rodar

```bash
docker run --gpus all --shm-size=8g \
  -p 3333:3333 \
  -v /caminho/seu/bundle:/bundle \
  -v /caminho/output:/output \
  ghcr.io/gabriellasyai/remotion-scale:latest \
  node /app/server.mjs
```

### Chamar do seu app

```bash
# Health check
curl http://localhost:3333/health

# Render single
curl -X POST http://localhost:3333/render \
  -H "Content-Type: application/json" \
  -d '{
    "serveUrl": "/bundle",
    "compositionId": "MyVideo",
    "inputProps": {"text": "Hello"},
    "outputPath": "/output/clip.mp4"
  }'

# Render batch (60 clips)
curl -X POST http://localhost:3333/render/batch \
  -H "Content-Type: application/json" \
  -d '{
    "serveUrl": "/bundle",
    "jobs": [
      {"compositionId": "MyVideo", "inputProps": {"text": "Clip 1"}, "outputPath": "/output/1.mp4"},
      {"compositionId": "MyVideo", "inputProps": {"text": "Clip 2"}, "outputPath": "/output/2.mp4"}
    ]
  }'

# Stats
curl http://localhost:3333/stats
```

### Python

```python
import requests

# Render batch
response = requests.post("http://localhost:3333/render/batch", json={
    "serveUrl": "/bundle",
    "jobs": [
        {"compositionId": "MyVideo", "inputProps": {"text": f"Clip {i}"}, "outputPath": f"/output/clip-{i}.mp4"}
        for i in range(60)
    ]
})
print(response.json())
# {"success": true, "count": 60, "totalSeconds": 280.5, "avgPerClip": 4.7}
```

---

## Modo 3: vast.ai (Scale on Demand)

Para burst rendering — sobe uma GPU por alguns minutos, renderiza tudo, destrói:

```bash
# 1. Instalar CLI
pip install vastai
vastai set api-key SUA_KEY

# 2. Criar instância
vastai search offers 'gpu_name in [L40, L4, T4, RTX_A6000] num_gpus=1 gpu_ram>=16 cpu_ram>=60' -o 'dph_total' --limit 3
vastai create instance OFFER_ID --image ghcr.io/gabriellasyai/remotion-scale:latest --disk 50

# 3. Attach SSH + upload bundle e vídeos
vastai attach ssh INSTANCE_ID "$(cat ~/.ssh/id_ed25519.pub)"
scp -P PORT seu-bundle.tar.gz root@HOST:/tmp/
scp -P PORT jobs.json root@HOST:/tmp/

# 4. Rodar
ssh -p PORT root@HOST 'cd /app && node worker.mjs'

# 5. Download resultados
scp -P PORT root@HOST:/output/*.mp4 ./resultados/

# 6. Destruir
vastai destroy instance INSTANCE_ID
```

---

## Variáveis de Ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `CONCURRENT_JOBS` | `10` | Máximo de jobs simultâneos |
| `GPU_TYPE` | `enterprise` | `consumer` (5 NVENC) ou `enterprise` (ilimitado) |
| `SERVE_URL` | — | Path do bundle Remotion |
| `JOBS_FILE` | — | Path do JSON de jobs (modo worker) |

## Volumes

| Mount | Container Path | Descrição |
|-------|---------------|-----------|
| Bundle Remotion | `/bundle` | Seu projeto buildado |
| Vídeos de entrada | `/data` | Arquivos de vídeo fonte |
| Output | `/output` | Onde os .mp4 renderizados são salvos |

## Requisitos da Máquina Host

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| GPU | NVIDIA com NVENC (GTX 1050+) | T4/L4/L40/A6000 |
| RAM | 32GB | 64-128GB |
| Disco | 50GB livre | NVMe |
| Docker | 20.10+ com nvidia-container-toolkit | — |
| NVIDIA Driver | 530+ | 550+ |

```bash
# Verificar se nvidia-docker está ok
docker run --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```
