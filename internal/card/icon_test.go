package card

import (
	"bytes"
	"flag"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "draw the icons in web/public again")

const public = "../../web/public"

// The icons in web/public are the ones Icon draws: one version of the mark, never a colour of an older look left in
// one of them (the phone's icon stayed lilac for weeks after the game turned bright). -update draws them again.
func TestIcons(t *testing.T) {
	for _, ic := range Icons {
		b, err := ic.Draw()
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(public, ic.File)
		if *update {
			if err := os.WriteFile(path, b, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		have, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !alike(t, have, b) {
			t.Errorf("web/public/%s isn't what Icon draws: go test ./internal/card -run TestIcons -update", ic.File)
		}
	}
}

// alike says two PNGs are the same picture: the same size, and every pixel within a few levels of the other's (the
// rasterizer's arithmetic differs a little between machines: an edge's antialiasing, never a colour).
func alike(t *testing.T, a, b []byte) bool {
	t.Helper()
	ia, err := png.Decode(bytes.NewReader(a))
	if err != nil {
		t.Fatal(err)
	}
	ib, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	if ia.Bounds() != ib.Bounds() {
		return false
	}
	near := func(x, y uint32) bool { return max(x, y)-min(x, y) <= 4<<8 }
	for y := ia.Bounds().Min.Y; y < ia.Bounds().Max.Y; y++ {
		for x := ia.Bounds().Min.X; x < ia.Bounds().Max.X; x++ {
			r1, g1, b1, a1 := ia.At(x, y).RGBA()
			r2, g2, b2, a2 := ib.At(x, y).RGBA()
			if !near(r1, r2) || !near(g1, g2) || !near(b1, b2) || !near(a1, a2) {
				return false
			}
		}
	}
	return true
}

// The mark's SVGs (the browser's icon, the mail's BIMI) are painted in the icons' three colours and no other, with the
// rosette's own petal.
func TestMarkSVGs(t *testing.T) {
	want := []string{"#16132b", "#e0a81e", "#f5f3ff"}
	for _, name := range []string{"favicon.svg", "bimi.svg"} {
		b, err := os.ReadFile(filepath.Join(public, name))
		if err != nil {
			t.Fatal(err)
		}
		var have []string
		for _, m := range regexp.MustCompile(`fill="(#[0-9a-fA-F]{6})"`).FindAllStringSubmatch(string(b), -1) {
			if c := strings.ToLower(m[1]); !slices.Contains(have, c) {
				have = append(have, c)
			}
		}
		slices.Sort(have)
		if !slices.Equal(have, want) {
			t.Errorf("%s is painted %v, not the mark's %v", name, have, want)
		}
		if !strings.Contains(string(b), "M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z") {
			t.Errorf("%s hasn't the rosette's petal", name)
		}
	}
}
