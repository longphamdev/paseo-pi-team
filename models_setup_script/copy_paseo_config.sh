#!/usr/bin/env bash
#
# copy_paseo_config.sh
# 1) Copy toàn bộ nội dung folder paseo-pi-team vào ~/.paseo-pi-team
#    - tự động thay hostId bằng hostname thật của máy chạy script
# 2) Copy paseo/config.json vào ~/.paseo/config.json
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

# Source folders (luôn tính từ vị trí script, không phụ thuộc cwd)
SRC_PASEO="$SCRIPT_DIR/paseo-pi-team"
SRC_CONFIG="$SCRIPT_DIR/paseo/config.json"

# Destination folders
DEST_PASEO="${HOME}/.paseo-pi-team"
DEST_PASEO_DIR="${HOME}/.paseo"

# Hostname thật của máy (short form, không có .local)
HOST_ID="$(hostname -s)"

# --- Kiểm tra source ---
if [ ! -d "$SRC_PASEO" ]; then
  echo "❌ Source folder không tồn tại: $SRC_PASEO" >&2
  exit 1
fi
if [ ! -f "$SRC_CONFIG" ]; then
  echo "❌ Source config không tồn tại: $SRC_CONFIG" >&2
  exit 1
fi

# --- Tạo destination nếu chưa có ---
mkdir -p "$DEST_PASEO"
mkdir -p "$DEST_PASEO_DIR"

echo "🖥️  Hostname phát hiện: $HOST_ID"
echo

# --- (1) Copy paseo-pi-team config ---
echo "📂 Copy paseo-pi-team config từ:"
echo "   $SRC_PASEO"
echo "   → $DEST_PASEO"
echo

copied=0
for item in "$SRC_PASEO"/*; do
  [ -e "$item" ] || continue
  name="$(basename "$item")"
  cp -R "$item" "$DEST_PASEO/"
  echo "   ✅ $name"
  copied=$((copied + 1))
done

# Tự động thay hostId bằng hostname thật của máy trong model-routing.local.json
MODEL_ROUTING="$DEST_PASEO/model-routing.local.json"
if [ -f "$MODEL_ROUTING" ]; then
  if sedi "s/\"hostId\": *\"[^\"]*\"/\"hostId\": \"$HOST_ID\"/" "$MODEL_ROUTING"; then
    echo "   🔧 Đã set hostId = $HOST_ID trong $(basename "$MODEL_ROUTING")"
  fi
fi

echo

# --- (2) Copy paseo/config.json vào ~/.paseo/ ---
echo "📂 Copy paseo config:"
echo "   $SRC_CONFIG"
echo "   → $DEST_PASEO_DIR/config.json"
cp "$SRC_CONFIG" "$DEST_PASEO_DIR/config.json"
echo "   ✅ config.json"
echo

echo "🎉 Hoàn tất: $copied item(s) vào $DEST_PASEO + config.json vào $DEST_PASEO_DIR"
