#!/bin/bash
# ================================================================
# Upload your test videos to a running vast.ai instance
#
# Usage:
#   bash docker/scripts/upload-video.sh <vast-ssh-host> <port> <video-file>
#
# Example:
#   bash docker/scripts/upload-video.sh ssh5.vast.ai 12345 ~/videos/my-clip.mp4
#
# After uploading, run the benchmark:
#   ssh -p 12345 root@ssh5.vast.ai "bash /app/scripts/vast-launch.sh --video=/tmp/uploaded-video.mp4"
# ================================================================

HOST=$1
PORT=$2
VIDEO=$3

if [ -z "$HOST" ] || [ -z "$PORT" ] || [ -z "$VIDEO" ]; then
    echo "Usage: $0 <host> <port> <video-file>"
    echo "Example: $0 ssh5.vast.ai 12345 ~/videos/test.mp4"
    exit 1
fi

if [ ! -f "$VIDEO" ]; then
    echo "Error: Video file not found: $VIDEO"
    exit 1
fi

FILENAME=$(basename "$VIDEO")
echo "Uploading $VIDEO to $HOST:$PORT..."
scp -P "$PORT" "$VIDEO" "root@$HOST:/tmp/uploaded-video.mp4"
echo "Done. Video uploaded to /tmp/uploaded-video.mp4"
echo ""
echo "Now run the benchmark:"
echo "  ssh -p $PORT root@$HOST 'bash /app/scripts/vast-launch.sh --video=/tmp/uploaded-video.mp4 --jobs=10 --concurrency=5'"
