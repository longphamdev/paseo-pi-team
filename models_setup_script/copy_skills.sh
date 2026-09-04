#!/usr/bin/env bash
#
# copy_skills.sh
# Copy toàn bộ skill từ source folder vào ~/.pi/agent/skills
#
set -euo pipefail

# Source folder (skill gốc)
SRC="/Users/longphamdev/Codespaces/paseo-pi-team/models_setup_script/skills"

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
