#!/usr/bin/env bash
#
# copy_skills.sh
# Copy toàn bộ skill từ source folder vào ~/.pi/agent/skills
#
set -euo pipefail

# Xác định thư mục chứa script này → chạy từ bất kỳ đâu (máy nào cũng được)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source folder (skill gốc) — luôn tính từ vị trí script, không phụ thuộc cwd
SRC="$SCRIPT_DIR/skills"

# Destination folder (skill đích)
DEST="${HOME}/.pi/agent/skills"

# --- Kiểm tra source ---
if [ ! -d "$SRC" ]; then
  echo "❌ Source folder không tồn tại: $SRC" >&2
  exit 1
fi

# --- Tạo destination nếu chưa có ---
mkdir -p "$DEST"

echo "📂 Copy skills từ:"
echo "   $SRC"
echo "   → $DEST"
echo

# --- Copy từng item (không ghi đè nếu đã tồn tại) ---
copied=0
skipped=0
for item in "$SRC"/*; do
  [ -e "$item" ] || continue
  name="$(basename "$item")"
  if [ -e "$DEST/$name" ]; then
    echo "   ⏭️  $name (đã tồn tại, bỏ qua)"
    skipped=$((skipped + 1))
  else
    cp -R "$item" "$DEST/"
    echo "   ✅ $name"
    copied=$((copied + 1))
  fi
done

echo
echo "🎉 Đã copy $copied skill(s) mới, bỏ qua $skipped skill(s) đã có trong $DEST"
