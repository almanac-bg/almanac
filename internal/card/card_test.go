package card

import (
	"bytes"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
)

// A card is a PNG of the size link previews take, drawn the same each time for the same result; CARD_OUT names a
// folder to keep the cards drawn, to look at.
func TestDraw(t *testing.T) {
	for name, c := range map[string]Card{
		"seven":   {Issue: "Брой 9 · 20 ноември", Shape: "1110111010"},
		"ten":     {Issue: "Брой 365 · 11 ноември", Shape: "1111111111"},
		"none":    {Issue: "Брой 42 · 23 декември", Shape: "0000000000"},
		"counted": {Issue: "Брой 3 · 14 ноември", Shape: "101101101"},
	} {
		b, err := Draw(c)
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		if s := img.Bounds().Size(); s.X != Width || s.Y != Height {
			t.Errorf("%s: %v", name, s)
		}
		again, _ := Draw(c)
		if !bytes.Equal(b, again) {
			t.Errorf("%s: drawn differently the second time", name)
		}
		if dir := os.Getenv("CARD_OUT"); dir != "" {
			if err := os.WriteFile(filepath.Join(dir, name+".png"), b, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
}

// Every letter a card can show is in the face it's set in: a face cut too small (web/src/fonts/subset.sh) would leave
// a gap where the letter goes.
func TestFacesHaveTheLetters(t *testing.T) {
	all, err := fonts()
	if err != nil {
		t.Fatal(err)
	}
	months := "януари февруари март април май юни юли август септември октомври ноември декември"
	for name, text := range map[string]string{
		"literata-600":                   Name + Ask,
		"literata-italic-500":            Footer + "от 0123456789",
		"sofia-sans-500":                 Waits,
		"sofia-sans-700":                 Site + strings.ToUpper("Брой 0123456789 · "+months),
		"sofia-sans-extra-condensed-800": "0123456789",
	} {
		f, err := opentype.NewFace(all[name], &opentype.FaceOptions{Size: 20, DPI: 72, Hinting: font.HintingNone})
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range text {
			if _, ok := f.GlyphAdvance(r); !ok && r != ' ' {
				t.Errorf("%s has no %q", name, r)
			}
		}
	}
}

func BenchmarkDraw(b *testing.B) {
	for b.Loop() {
		if _, err := Draw(Card{Issue: "Брой 9 · 20 ноември", Shape: "1110111010"}); err != nil {
			b.Fatal(err)
		}
	}
}
