#!/bin/sh
# Makes the game's font files from the families' sources (Google Fonts' copies, OFL: OFL.txt), cut to what the game
# shows. Each family is two files:
#
#   <family>.woff2        Bulgarian text whole: Cyrillic, the Latin letters and digits, and the marks the game's texts
#                         use („“ – — … № · ° × −), so a page of Bulgarian needs one file of each family it shows;
#   <family>-rest.woff2   the rest of Latin (é, č, ș), Greek and the other signs, loaded only where one shows.
#
# The weights are only those the style uses (app.css): Sofia Sans 400–900 and Extra Condensed 600–900.
# The ranges below are the @font-face rules' unicode-range in app.css, word for word: change both together.
#
# And the faces of the pictures a link shows (internal/card: a shared day's card, the site's own), which the server
# draws itself, in the weights internal/card sets them in (Sofia Sans 800 and 900, the numeral 900): it reads
# TrueType only and applies no font features, so each is a static cut of the one weight the card sets it in, cut to
# the letters a card can show (card=). Sofia Sans draws the Bulgarian letter forms by default (its locl is for
# Russian), so the card has them without the feature.
#
#   sh web/src/fonts/subset.sh      (needs python3; makes a virtual environment of its own, and removes it)
set -eu

commit=8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5 # google/fonts
main="U+0020-007E,U+00A0,U+00A7,U+00A9,U+00AB,U+00AD,U+00AE,U+00B0-00B3,U+00B7,U+00B9,U+00BB-00BE,U+00D7,U+00F7,\
U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2009,U+2010-2015,U+2018-201E,U+2022,U+2026,U+202F,U+2030,U+2032-2033,\
U+2039-203A,U+20AC,U+2116,U+2190-2193,U+2212"
rest="U+00A1-00A6,U+00A8,U+00AA,U+00AC,U+00AF,U+00B4-00B6,U+00B8,U+00BA,U+00BF-00D6,U+00D8-00F6,U+00F8-024F,\
U+0259,U+02B0-02FF,U+0300,U+0302-036F,U+0370-03FF,U+0460-048F,U+0492-04AF,U+04B2-052F,U+1E00-1EFF,U+2000-2008,\
U+200B-200F,U+2016-2017,U+201F-2021,U+2023-2025,U+2027-202E,U+2031,U+2034-2038,U+203B-209F,U+20A0-20AB,U+20AD-20CF,\
U+2100-2115,U+2117-218F,U+2194-21FF,U+2200-2211,U+2213-22FF,U+FB00-FB06"

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
python3 -m venv "$work/venv"
"$work/venv/bin/pip" install -q fonttools==4.60.2 brotli==1.2.1

# family source axes-limits
make() {
  curl -fsSL -o "$work/src.ttf" "https://raw.githubusercontent.com/google/fonts/$commit/$2"
  "$work/venv/bin/fonttools" varLib.instancer -q "$work/src.ttf" $3 -o "$work/cut.ttf"
  for part in main rest; do
    name=$1
    ranges=$main
    if [ $part = rest ]; then name=$1-rest ranges=$rest; fi
    "$work/venv/bin/pyftsubset" "$work/cut.ttf" --unicodes="$ranges" --layout-features=ccmp,calt,liga,kern,mark,mkmk,rvrn,tnum \
      --no-hinting --desubroutinize --flavor=woff2 --output-file="$here/$name.woff2"
  done
}
make sofia-sans "ofl/sofiasans/SofiaSans%5Bwght%5D.ttf" "wght=400:900"
make sofia-sans-extra-condensed "ofl/sofiasansextracondensed/SofiaSansExtraCondensed%5Bwght%5D.ttf" "wght=600:900"
ls -l "$here"/*.woff2

card="U+0020-007E,U+00A0,U+00B7,U+0400-045F,U+2013-2014,U+201C,U+201E"
cards="$here/../../../internal/card/fonts"
mkdir -p "$cards"
# name source axes
cut() {
  curl -fsSL -o "$work/src.ttf" "https://raw.githubusercontent.com/google/fonts/$commit/$2"
  "$work/venv/bin/fonttools" varLib.instancer -q "$work/src.ttf" $3 -o "$work/cut.ttf"
  "$work/venv/bin/pyftsubset" "$work/cut.ttf" --unicodes="$card" --layout-features=kern --no-hinting \
    --desubroutinize --output-file="$cards/$1.ttf"
}
cut sofia-sans-800 "ofl/sofiasans/SofiaSans%5Bwght%5D.ttf" "wght=800"
cut sofia-sans-900 "ofl/sofiasans/SofiaSans%5Bwght%5D.ttf" "wght=900"
cut sofia-sans-extra-condensed-900 "ofl/sofiasansextracondensed/SofiaSansExtraCondensed%5Bwght%5D.ttf" "wght=900"
ls -l "$cards"/*.ttf
