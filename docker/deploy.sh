#!/bin/bash
# ================================================================
# Deploy completo: build → push → provisionar vast.ai → testar
#
# USO:
#   export VAST_API_KEY="sua-key"
#   export GH_TOKEN="seu-token"
#   bash docker/deploy.sh
# ================================================================

set -e

GITHUB_USER="gabriellasyai"
IMAGE="ghcr.io/${GITHUB_USER}/remotion-scale:latest"

# ── Validação ───────────────────────────────────────────────
if [ -z "$VAST_API_KEY" ]; then
    echo "ERRO: VAST_API_KEY não definida. Rode: export VAST_API_KEY=\"sua-key\""
    exit 1
fi
if [ -z "$GH_TOKEN" ]; then
    echo "ERRO: GH_TOKEN não definido. Rode: export GH_TOKEN=\"seu-token\""
    exit 1
fi

echo "╔══════════════════════════════════════════╗"
echo "║   Remotion Scale - Deploy & Test         ║"
echo "╚══════════════════════════════════════════╝"

# ── 1. Login no GitHub Container Registry ───────────────────
echo ""
echo "━━━ 1. Login GHCR ━━━"
echo "$GH_TOKEN" | podman login ghcr.io -u "$GITHUB_USER" --password-stdin
echo "✓ Logged in to ghcr.io"

# ── 2. Build da imagem ──────────────────────────────────────
echo ""
echo "━━━ 2. Build ━━━"
cd "$(dirname "$0")/.."
podman build -f docker/Dockerfile -t "$IMAGE" .
echo "✓ Image built: $IMAGE"

# ── 3. Push para GHCR ──────────────────────────────────────
echo ""
echo "━━━ 3. Push ━━━"
podman push "$IMAGE"
echo "✓ Image pushed: $IMAGE"

# ── 4. Instalar vast.ai CLI ────────────────────────────────
echo ""
echo "━━━ 4. vast.ai CLI ━━━"
if ! command -v vastai &> /dev/null; then
    pip install vastai
fi
vastai set api-key "$VAST_API_KEY"
echo "✓ vast.ai configured"

# ── 5. Buscar instância GPU ────────────────────────────────
echo ""
echo "━━━ 5. Provisionar GPU ━━━"
echo "Buscando instância com L40/H100/A100/L4/T4..."

# Buscar a instância mais barata com GPU enterprise e 64GB+ RAM
INSTANCE_ID=$(vastai search offers \
    'gpu_name in [L40, H100, A100, L4, T4] \
     num_gpus=1 \
     gpu_ram>=16 \
     cpu_ram>=64 \
     disk_space>=50 \
     inet_down>=200 \
     dph_total<=2.0' \
    --order 'dph_total' \
    --limit 1 \
    --raw | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'])" 2>/dev/null)

if [ -z "$INSTANCE_ID" ]; then
    echo "Nenhuma instância encontrada. Relaxando filtros..."
    INSTANCE_ID=$(vastai search offers \
        'num_gpus=1 gpu_ram>=8 cpu_ram>=32 disk_space>=50' \
        --order 'dph_total' \
        --limit 1 \
        --raw | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'])" 2>/dev/null)
fi

if [ -z "$INSTANCE_ID" ]; then
    echo "ERRO: Nenhuma instância disponível"
    exit 1
fi

echo "Instância encontrada: $INSTANCE_ID"

# ── 6. Criar instância ─────────────────────────────────────
echo "Criando instância..."
vastai create instance "$INSTANCE_ID" \
    --image "$IMAGE" \
    --disk 50 \
    --docker "--gpus all --shm-size=8g" \
    --onstart-cmd "bash /app/scripts/quick-test.sh && echo READY"

echo "✓ Instância criada. Aguardando inicialização..."

# ── 7. Esperar ficar pronta ─────────────────────────────────
echo ""
echo "━━━ 6. Aguardando instância ━━━"
for i in $(seq 1 60); do
    STATUS=$(vastai show instances --raw | python3 -c "
import sys, json
instances = json.load(sys.stdin)
for inst in instances:
    if inst.get('actual_status') == 'running':
        print(f\"RUNNING {inst.get('ssh_host','')} {inst.get('ssh_port','')}\")
        break
" 2>/dev/null)

    if [[ "$STATUS" == RUNNING* ]]; then
        SSH_HOST=$(echo "$STATUS" | awk '{print $2}')
        SSH_PORT=$(echo "$STATUS" | awk '{print $3}')
        echo "✓ Instância rodando: $SSH_HOST:$SSH_PORT"
        break
    fi
    echo "  Aguardando... ($i/60)"
    sleep 10
done

if [ -z "$SSH_HOST" ]; then
    echo "ERRO: Timeout esperando instância"
    vastai show instances
    exit 1
fi

# ── 8. Rodar benchmark ─────────────────────────────────────
echo ""
echo "━━━ 7. Rodando Benchmark ━━━"
echo "SSH: $SSH_HOST:$SSH_PORT"
echo ""
echo "Para rodar manualmente:"
echo "  ssh -p $SSH_PORT root@$SSH_HOST 'bash /app/scripts/vast-launch.sh --jobs=10 --concurrency=5'"
echo ""
echo "Para upload de vídeo + benchmark:"
echo "  scp -P $SSH_PORT seu-video.mp4 root@$SSH_HOST:/tmp/uploaded-video.mp4"
echo "  ssh -p $SSH_PORT root@$SSH_HOST 'bash /app/scripts/vast-launch.sh --video=/tmp/uploaded-video.mp4'"
echo ""
echo "Para destruir a instância depois:"
echo "  vastai destroy instance \$(vastai show instances --raw | python3 -c \"import sys,json; print(json.load(sys.stdin)[0]['id'])\")"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Deploy completo ✓                      ║"
echo "╚══════════════════════════════════════════╝"
