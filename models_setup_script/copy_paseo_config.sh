#!/usr/bin/env bash
#
# copy_paseo_config.sh
# Copy cấu hình paseo-pi-team vào ~/.paseo-pi-team và ~/.paseo.
# Mọi nội dung (routes, hosts, capabilities...) được GIỮ NGUYÊN;
# script CHỈ thay hostId bằng hostname thật của máy chạy script.
#
set -euo pipefail

# Xác định thư mục chứa script này → chạy từ bất kỳ đâu (máy nào cũng được)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# In-place sed portability: macOS = "sed -i ''", Linux = "sed -i"
sedi() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

# Source: base template được commit trong repo (KHÔNG phải *.local.json
# nên không bị .gitignore loại). Script copy sang *.local.json và chỉ thế hostId.
SRC_PASEO="$SCRIPT_DIR/paseo-pi-team"
SRC_MODEL_ROUTING="$SRC_PASEO/model-routing.json"
SRC_CLUSTER_ROUTING="$SRC_PASEO/cluster-routing.json"
SRC_CONFIG="$SCRIPT_DIR/paseo/config.json"

# Destination folders
DEST_PASEO="${HOME}/.paseo-pi-team"
DEST_MODEL_ROUTING="$DEST_PASEO/model-routing.local.json"
DEST_CLUSTER_ROUTING="$DEST_PASEO/cluster-routing.local.json"
DEST_PASEO_DIR="${HOME}/.paseo"

# Hostname thật của máy (short form, không có .local)
HOST_ID="$(hostname -s)"

# --- Kiểm tra source ---
if [ ! -f "$SRC_MODEL_ROUTING" ]; then
  echo "❌ Thiếu source: $SRC_MODEL_ROUTING" >&2
  exit 1
fi
if [ ! -f "$SRC_CLUSTER_ROUTING" ]; then
  echo "❌ Thiếu source: $SRC_CLUSTER_ROUTING" >&2
  exit 1
fi
if [ ! -f "$SRC_CONFIG" ]; then
  echo "❌ Thiếu source: $SRC_CONFIG" >&2
  exit 1
fi

# --- Tạo destination nếu chưa có ---
mkdir -p "$DEST_PASEO"
mkdir -p "$DEST_PASEO_DIR"

echo "🖥️  Hostname phát hiện: $HOST_ID"
echo

# --- (1) Copy paseo-pi-team routing (giữ nguyên mọi thứ, CHỈ thay hostId) ---
echo "📂 Copy paseo-pi-team config:"
echo "   $SRC_PASEO"
echo "   → $DEST_PASEO"
echo

cp "$SRC_MODEL_ROUTING" "$DEST_MODEL_ROUTING"
echo "   ✅ model-routing.local.json"
cp "$SRC_CLUSTER_ROUTING" "$DEST_CLUSTER_ROUTING"
echo "   ✅ cluster-routing.local.json"

# CHỈ thay hostId, giữ nguyên routes / hosts / capabilities ...
if sedi "s/\"hostId\": *\"[^\"]*\"/\"hostId\": \"$HOST_ID\"/" "$DEST_MODEL_ROUTING"; then
  echo "   🔧 Đã set hostId = $HOST_ID trong model-routing.local.json"
fi

echo

# --- (2) Copy paseo/config.json vào ~/.paseo/ ---
echo "📂 Copy paseo config:"
echo "   $SRC_CONFIG"
echo "   → $DEST_PASEO_DIR/config.json"
cp "$SRC_CONFIG" "$DEST_PASEO_DIR/config.json"
echo "   ✅ config.json"
echo

echo "🎉 Hoàn tất: routing config vào $DEST_PASEO + config.json vào $DEST_PASEO_DIR"
