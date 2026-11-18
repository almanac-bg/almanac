package bank

import (
	"os"
	"path/filepath"
	"testing"
)

// webpOf is the start of a WebP file (extended) of w×h: enough for webpSize.
func webpOf(w, h int, salt string) []byte {
	b := []byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00")
	w, h = w-1, h-1
	b = append(b, byte(w), byte(w>>8), byte(w>>16), byte(h), byte(h>>8), byte(h>>16))
	return append(b, salt...)
}

// A picture comes in three sizes for the browser to pick from, half, three quarters and whole, each checked; one
// without its three-quarter copy yet (a picture from before it came) is offered in the other two, and one whose copy is
// wrong is refused.
func TestPictureSizes(t *testing.T) {
	dir := t.TempDir()
	big := webpOf(900, 600, "big")
	path := filepath.Join(dir, "x.webp")
	if err := os.WriteFile(path, big, 0o644); err != nil {
		t.Fatal(err)
	}
	sum, err := hashOf(path)
	if err != nil {
		t.Fatal(err)
	}
	write := func(name string, data []byte) {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	im := &Image{File: sum + ".webp", W: 900, H: 600}
	write(im.File, big)
	write(im.Small(), webpOf(450, 300, "small"))
	q := "/qimg/" + sum
	if p := im.checkFiles(dir); len(p) != 0 {
		t.Errorf("without its three-quarter copy: %v", p)
	}
	if v := im.view(); v.SrcSet != q+"-600.webp 450w, "+q+".webp 900w" || v.Src != q+"-600.webp" {
		t.Errorf("without its three-quarter copy: %+v", v)
	}
	write(im.Medium(), webpOf(450, 300, "medium"))
	if p := im.checkFiles(dir); len(p) != 1 || p[0] != im.Medium()+" is 450×300, not 675×450" {
		t.Errorf("a three-quarter copy of the wrong size: %v", p)
	}
	if v := im.view(); v.SrcSet != q+"-600.webp 450w, "+q+".webp 900w" {
		t.Errorf("a three-quarter copy of the wrong size is offered: %+v", v)
	}
	write(im.Medium(), webpOf(675, 450, "medium"))
	if p := im.checkFiles(dir); len(p) != 0 {
		t.Errorf("all three, each its size: %v", p)
	}
	if v := im.view(); v.SrcSet != q+"-600.webp 450w, "+q+"-900.webp 675w, "+q+".webp 900w" {
		t.Errorf("all three: %+v", v)
	}
}
