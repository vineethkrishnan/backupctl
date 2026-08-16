#!/usr/bin/env bash
#
# Renders every .txt capture in this directory to a matching .png.
#
# Every image is pinned to the same pixel width so they all scale to the same
# apparent font size on the docs site. VitePress fits each image to the content
# column, so an image's on-page text size is inversely proportional to its pixel
# width — mixing widths makes narrow captures render huge and wide ones tiny.
#
# Width is pinned by capping every line at COLUMNS characters and padding the
# first line out to exactly COLUMNS. freeze's own --width flag is not usable
# here: it widens the canvas without scaling the font, which shrinks the text
# instead of keeping it consistent.

set -euo pipefail

# 120 is the smallest budget that fits the widest capture (118 chars) without
# wrapping. Wrapping tighter than the content splits table rows mid-value.
COLUMNS=120
THEME=dracula

cd "$(dirname "$0")"

for capture in *.txt; do
  padded="$(mktemp -d)/${capture}"
  awk -v cols="$COLUMNS" 'NR==1 { printf "%-*s\n", cols, $0; next } { print }' "$capture" > "$padded"

  freeze "$padded" \
    --window \
    --theme "$THEME" \
    --wrap "$COLUMNS" \
    --border.radius 12 \
    --shadow.blur 20 \
    -o "${capture%.txt}.png"

  rm -f "$padded"
done

echo
echo "Rendered widths (all values must match):"
for image in *.png; do
  sips -g pixelWidth -g pixelHeight "$image" 2>/dev/null |
    awk -v name="$image" '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{printf "  %-30s %sx%s\n", name, w, h}'
done
