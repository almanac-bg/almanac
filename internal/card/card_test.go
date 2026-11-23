package card

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"

	"github.com/almanac-bg/almanac/internal/bank"
)

var day = []string{"movies", "technology", "history", "nature", "geography", "literature", "music", "general",
	"science", "sports"}

// A card is a PNG of the size link previews take, drawn the same each time for the same result; CARD_OUT names a
// folder to keep the pictures drawn, to look at.
func TestDraw(t *testing.T) {
	pictures := map[string]func() ([]byte, error){"site": Site}
	for name, c := range map[string]Card{
		"seven": {Issue: 9, Date: "20 ноември", Chapters: day, Shape: "1102111013"},
		"ten":   {Issue: 365, Date: "11 ноември", Chapters: day, Shape: "1111111111"},
		"none":  {Issue: 42, Date: "23 декември", Chapters: day, Shape: "0000000000"},
		"near":  {Issue: 10, Date: "21 ноември", Chapters: day, Shape: "2222222222"},
		"wide":  {Issue: 10000, Date: "29 септември", Chapters: day, Shape: "1201201201"},
		"national": {Issue: 194, Date: "24 май", National: "Денят на българската азбука и култура", Chapters: day,
			Shape: "1101110111"},
		"unknown": {Issue: 3, Date: "14 ноември", Chapters: day[:7], Shape: "101101"},
	} {
		pictures[name] = func() ([]byte, error) { return Draw(c) }
	}
	for name, draw := range pictures {
		b, err := draw()
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
		again, _ := draw()
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

// Right, близо and wrong part without colour (DECISIONS.md: never by colour alone), in grey, for every chapter: right
// is filled to its edges on both sides; близо on its left side only, inside a whole edge; wrong on neither, inside a
// dashed edge, its glyph faded; and one that counts for nobody is dashed and empty.
func TestTilesPartInGrey(t *testing.T) {
	for chapter := range vivid {
		chapters := make([]string, 10)
		for i := range chapters {
			chapters[i] = chapter
		}
		b, err := Draw(Card{Issue: 1, Date: "12 ноември", Chapters: chapters, Shape: "1203000000"})
		if err != nil {
			t.Fatal(err)
		}
		img, _ := png.Decode(bytes.NewReader(b))
		const size, gap = 120, 18
		x0, y0 := Width-64-5*size-4*gap, (Height-2*size-gap)/2
		// grey is the lightest grey in a part of tile i (x and y from its corner): light all over, or not.
		grey := func(i, xa, xb, ya, yb int) (lightest uint8) {
			for y := y0 + ya; y < y0+yb; y++ {
				for x := x0 + i*(size+gap) + xa; x < x0+i*(size+gap)+xb; x++ {
					lightest = max(lightest, color.GrayModel.Convert(img.At(x, y)).(color.Gray).Y)
				}
			}
			return lightest
		}
		filled := func(i, xa, xb int) bool { return grey(i, xa, xb, 40, 80) < 230 }
		whole := func(i int) bool { return grey(i, 30, 90, 2, 5) < 230 } // its edge along the top
		for i, want := range []struct {
			name               string
			left, right, whole bool
		}{{"right", true, true, true}, {"близо", true, false, true}, {"wrong", false, false, false},
			{"void", false, false, false}} {
			left, right := filled(i, 8, 14), filled(i, 106, 112)
			if left != want.left || right != want.right || whole(i) != want.whole {
				t.Errorf("%s, %s: filled at the left %v, at the right %v; its edge whole %v", chapter, want.name, left,
					right, whole(i))
			}
		}
		if grey(3, 12, 108, 12, 108) < 250 {
			t.Errorf("%s: one that counts for nobody has something in it", chapter)
		}
		darkest := uint8(255)
		for y := y0 + 30; y < y0+90; y++ {
			for x := x0 + 2*(size+gap) + 30; x < x0+2*(size+gap)+90; x++ {
				darkest = min(darkest, color.GrayModel.Convert(img.At(x, y)).(color.Gray).Y)
			}
		}
		if darkest > 240 {
			t.Errorf("%s: a wrong one has no glyph", chapter)
		}
	}
}

// The chapters' colours are app.css's by day (its first :root, before the dark theme), every one of them, and every
// chapter has its glyph.
func TestChaptersAreTheClients(t *testing.T) {
	src, err := os.ReadFile("../../web/src/app.css")
	if err != nil {
		t.Fatal(err)
	}
	css := string(src)
	start := strings.Index(css, ":root {")
	end := strings.Index(css, "@media (prefers-color-scheme: dark)")
	if start < 0 || end < start {
		t.Fatal("app.css has no day's :root before its dark theme")
	}
	for name, colours := range map[string]map[string]color.RGBA{"t": vivid, "d": deep} {
		pairs := regexp.MustCompile(`--`+name+`-(\w+): #([0-9a-f]{6});`).FindAllStringSubmatch(css[start:end], -1)
		if len(pairs) != len(colours) {
			t.Errorf("--%s-: app.css has %d, here %d", name, len(pairs), len(colours))
		}
		for _, p := range pairs {
			c, ok := colours[p[1]]
			if got := fmt.Sprintf("%02x%02x%02x", c.R, c.G, c.B); !ok || got != p[2] {
				t.Errorf("--%s-%s: %s here, app.css %s", name, p[1], got, p[2])
			}
		}
	}
	all, err := glyphs()
	if err != nil {
		t.Fatal(err)
	}
	for chapter := range vivid {
		if len(all[chapter]) == 0 {
			t.Errorf("no glyph for %s", chapter)
		}
	}
}

// A glyph is drawn as the browser draws its SVG: a circle's arcs come round to a circle, a rotation turns about its
// centre, a stroke is as wide as it says.
func TestGlyphPaths(t *testing.T) {
	lines, closed, err := flatten("M2 32a30 30 0 1 0 60 0a30 30 0 1 0 -60 0Z", identity)
	if err != nil || len(lines) != 1 || !closed[0] {
		t.Fatal(lines, closed, err)
	}
	for _, p := range lines[0] {
		if d := (p.x-32)*(p.x-32) + (p.y-32)*(p.y-32); d < 29.9*29.9 || d > 30.1*30.1 {
			t.Fatalf("a point of the circle off it: %v", p)
		}
	}
	m, err := transform("rotate(90 32 32)")
	if err != nil {
		t.Fatal(err)
	}
	if p := m.apply(pt{32, 2}); abs(p.x-62) > 1e-9 || abs(p.y-32) > 1e-9 {
		t.Errorf("rotate(90 32 32) takes (32, 2) to %v", p)
	}
	lines, _, err = flatten("M10 10h5v5H10l1 1c1 1 2 2 3 3s1 1 2 2q1 1 2 2t2 2z", identity)
	if err != nil || len(lines) != 1 {
		t.Fatal(lines, err)
	}
	if p := lines[0][4]; p != (pt{11, 16}) {
		t.Errorf("a relative line from (10, 15) ends at %v", p)
	}
	if _, _, err := flatten("M10 10L5", identity); err == nil {
		t.Error("a path that ends early")
	}
	// A stroke 2 wide at the glyph's 64 is that much of the picture: a line across a 64px glyph is 2px wide.
	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	line, err := readGlyphs([]byte(`{"line": "<path class=\"l0\" d=\"M8 32H56\" stroke-width=\"2\"/>"}`))
	if err != nil {
		t.Fatal(err)
	}
	paint(img, line["line"], vivid["mix"], 0, 0, 64, 1)
	for y := 28; y < 36; y++ {
		_, _, _, a := img.At(32, y).RGBA()
		if want := y == 31 || y == 32; (a > 0xf000) != want {
			t.Errorf("the line's row %d: alpha %x", y, a)
		}
	}
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// Every letter a picture can show is in the face it's set in: a face cut too small (web/src/fonts/subset.sh) would
// leave a gap where the letter goes.
func TestFacesHaveTheLetters(t *testing.T) {
	all, err := fonts()
	if err != nil {
		t.Fatal(err)
	}
	// The date says its month, and a national day's name after it (bank.NationalName).
	dates := "0123456789 · януари февруари март април май юни юли август септември октомври ноември декември"
	for _, d := range bank.NationalDays {
		dates += d.Name
	}
	for name, text := range map[string]string{
		"sofia-sans-900":                 Name + "Брой" + Line,
		"sofia-sans-800":                 Address + dates,
		"sofia-sans-extra-condensed-900": "0123456789",
	} {
		f, err := opentype.NewFace(all[name], &opentype.FaceOptions{Size: 20, DPI: 72, Hinting: font.HintingNone})
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range strings.ReplaceAll(text, " ", "") {
			if _, ok := f.GlyphAdvance(r); !ok {
				t.Errorf("%s has no %q", name, r)
			}
		}
	}
}

func BenchmarkDraw(b *testing.B) {
	for b.Loop() {
		if _, err := Draw(Card{Issue: 9, Date: "20 ноември", Chapters: day, Shape: "1102111013"}); err != nil {
			b.Fatal(err)
		}
	}
}
