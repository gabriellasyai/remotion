# ================================================================
# Deploy completo: build → push → provisionar vast.ai → testar
#
# USO (PowerShell):
#   $env:VAST_API_KEY = "sua-key"
#   $env:GH_TOKEN = "seu-token"
#   .\docker\deploy.ps1
# ================================================================

$ErrorActionPreference = "Stop"

$GITHUB_USER = "gabriellasyai"
$IMAGE = "ghcr.io/${GITHUB_USER}/remotion-scale:latest"

# Validação
if (-not $env:VAST_API_KEY) {
    Write-Host "ERRO: VAST_API_KEY nao definida." -ForegroundColor Red
    Write-Host 'Rode: $env:VAST_API_KEY = "sua-key"'
    exit 1
}
if (-not $env:GH_TOKEN) {
    Write-Host "ERRO: GH_TOKEN nao definido." -ForegroundColor Red
    Write-Host 'Rode: $env:GH_TOKEN = "seu-token"'
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Remotion Scale - Deploy & Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Login GHCR
Write-Host "`n--- 1. Login GHCR ---" -ForegroundColor Yellow
$env:GH_TOKEN | podman login ghcr.io -u $GITHUB_USER --password-stdin
Write-Host "Login OK" -ForegroundColor Green

# 2. Build
Write-Host "`n--- 2. Build ---" -ForegroundColor Yellow
Push-Location (Split-Path $PSScriptRoot)
podman build -f docker/Dockerfile -t $IMAGE .
Pop-Location
Write-Host "Build OK: $IMAGE" -ForegroundColor Green

# 3. Push
Write-Host "`n--- 3. Push ---" -ForegroundColor Yellow
podman push $IMAGE
Write-Host "Push OK" -ForegroundColor Green

# 4. vast.ai CLI
Write-Host "`n--- 4. vast.ai CLI ---" -ForegroundColor Yellow
if (-not (Get-Command vastai -ErrorAction SilentlyContinue)) {
    pip install vastai
}
vastai set api-key $env:VAST_API_KEY
Write-Host "vast.ai OK" -ForegroundColor Green

# 5. Buscar instancia
Write-Host "`n--- 5. Buscar GPU ---" -ForegroundColor Yellow
$searchResult = vastai search offers 'gpu_name in [L40, H100, A100, L4, T4] num_gpus=1 gpu_ram>=16 cpu_ram>=64 disk_space>=50 dph_total<=2.0' --order 'dph_total' --limit 1 --raw 2>$null

$offers = $searchResult | ConvertFrom-Json
if ($offers.Count -eq 0) {
    Write-Host "Relaxando filtros..."
    $searchResult = vastai search offers 'num_gpus=1 gpu_ram>=8 cpu_ram>=32 disk_space>=50' --order 'dph_total' --limit 1 --raw 2>$null
    $offers = $searchResult | ConvertFrom-Json
}

if ($offers.Count -eq 0) {
    Write-Host "ERRO: Nenhuma instancia disponivel" -ForegroundColor Red
    exit 1
}

$OFFER_ID = $offers[0].id
$GPU_NAME = $offers[0].gpu_name
$PRICE = $offers[0].dph_total
Write-Host "Encontrada: $GPU_NAME (ID: $OFFER_ID) - `$$PRICE/hr" -ForegroundColor Green

# 6. Criar instancia
Write-Host "`n--- 6. Criar instancia ---" -ForegroundColor Yellow
vastai create instance $OFFER_ID --image $IMAGE --disk 50 --docker "--gpus all --shm-size=8g" --onstart-cmd "bash /app/scripts/quick-test.sh"
Write-Host "Instancia criada. Aguardando..." -ForegroundColor Green

# 7. Esperar ficar pronta
Write-Host "`n--- 7. Aguardando ---" -ForegroundColor Yellow
$SSH_HOST = $null
$SSH_PORT = $null

for ($i = 1; $i -le 60; $i++) {
    Start-Sleep -Seconds 10
    $instancesRaw = vastai show instances --raw 2>$null
    if ($instancesRaw) {
        $instances = $instancesRaw | ConvertFrom-Json
        foreach ($inst in $instances) {
            if ($inst.actual_status -eq "running" -and $inst.ssh_host) {
                $SSH_HOST = $inst.ssh_host
                $SSH_PORT = $inst.ssh_port
                break
            }
        }
    }
    if ($SSH_HOST) {
        Write-Host "Rodando: ${SSH_HOST}:${SSH_PORT}" -ForegroundColor Green
        break
    }
    Write-Host "  Aguardando... ($i/60)"
}

if (-not $SSH_HOST) {
    Write-Host "ERRO: Timeout" -ForegroundColor Red
    vastai show instances
    exit 1
}

# 8. Instrucoes
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DEPLOY COMPLETO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "SSH na instancia:" -ForegroundColor Yellow
Write-Host "  ssh -p $SSH_PORT root@$SSH_HOST"
Write-Host ""
Write-Host "Upload video + benchmark:" -ForegroundColor Yellow
Write-Host "  scp -P $SSH_PORT seu-video.mp4 root@${SSH_HOST}:/tmp/video.mp4"
Write-Host "  ssh -p $SSH_PORT root@$SSH_HOST 'bash /app/scripts/vast-launch.sh --video=/tmp/video.mp4 --jobs=10 --concurrency=5'"
Write-Host ""
Write-Host "Destruir depois:" -ForegroundColor Yellow
Write-Host "  vastai destroy instance $($instances[0].id)"
