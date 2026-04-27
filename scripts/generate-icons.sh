#!/bin/bash
# Generates all PWA icons from a 1024x1024 source.
# Requires ImageMagick: brew install imagemagick

set -e

SOURCE="icons/source-1024.png"
ICONS_DIR="icons"

if [ ! -f "$SOURCE" ]; then
  echo "Source not found at $SOURCE; generating one programmatically..."
  mkdir -p "$ICONS_DIR"
  # Deep navy background with gold five-pointed star centered (~70% of frame).
  # Polygon points are a regular five-pointed star at radius 360 around (512,512).
  magick -size 1024x1024 xc:'#060d1f' \
    -fill '#fbbf24' -stroke '#f59e0b' -strokewidth 4 \
    -draw "polygon 512,152 596,422 880,422 650,588 738,858 512,692 286,858 374,588 144,422 428,422" \
    "$SOURCE"
fi

echo "Generating PWA icons from $SOURCE..."

# Standard square icons
for SIZE in 72 96 128 144 152 192 384 512; do
  magick "$SOURCE" -resize ${SIZE}x${SIZE} "$ICONS_DIR/icon-${SIZE}.png"
  echo "  ok icon-${SIZE}.png"
done

# Maskable icons (Android adaptive icons) — 10% safe zone padding
for SIZE in 192 512; do
  PAD=$(($SIZE * 10 / 100))
  INNER=$(($SIZE - $PAD * 2))
  magick "$SOURCE" -resize ${INNER}x${INNER} \
    -background "#060d1f" -gravity center -extent ${SIZE}x${SIZE} \
    "$ICONS_DIR/icon-${SIZE}-maskable.png"
  echo "  ok icon-${SIZE}-maskable.png"
done

# Apple touch icon (iOS)
magick "$SOURCE" -resize 180x180 "$ICONS_DIR/apple-touch-icon.png"
echo "  ok apple-touch-icon.png"

# Favicons
magick "$SOURCE" -resize 32x32 "$ICONS_DIR/favicon-32.png"
magick "$SOURCE" -resize 16x16 "$ICONS_DIR/favicon-16.png"
echo "  ok favicon-32.png, favicon-16.png"

# .ico (legacy)
magick "$ICONS_DIR/favicon-32.png" "$ICONS_DIR/favicon-16.png" "favicon.ico"
echo "  ok favicon.ico (root)"

# Shortcut icons (placeholders — replace with custom designs later)
cp "$ICONS_DIR/icon-96.png" "$ICONS_DIR/shortcut-practice.png"
cp "$ICONS_DIR/icon-96.png" "$ICONS_DIR/shortcut-toys.png"
echo "  ok shortcut icons (placeholder copies)"

echo "Done. Icons in $ICONS_DIR/"
