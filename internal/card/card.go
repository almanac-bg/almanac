// Package card draws the picture a link to a shared day's result shows where it's sent (Viber, Messenger, WhatsApp:
// its Open Graph image, 1200 × 630): the edition's paper, whatever the theme of whoever opens it, with the mark and
// the name, the day's issue, the double rule, the score as the hero numeral, its shape (a filled square for each right
// answer, an open one for the rest), „Колко ще познаеш ти?“ and the footer with the address. Never an answer, never a
// name: what it shows is the score and its shape, which the shared text says too (play/share.go).
//
// It's drawn here, in Go, with the game's own faces (fonts: static TrueType cuts of the client's families, made by
// web/src/fonts/subset.sh; the SIL Open Font License, fonts/OFL.txt), and the mark drawn from web/public/favicon.svg's
// petal as shapes. Drawing one takes some milliseconds of CPU: the server keeps what it drew (server/share.go), and a
// card is the same for every result of one shape on one day, so there are only so many to draw.
package card

import (
	"bytes"
	"embed"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"strings"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

// Width and Height are the card's size: what link previews take for a large picture.
const (
	Width  = 1200
	Height = 630
)

// Card is what a card shows.
type Card struct {
	// Issue is the day's issue as its dateline says it („Брой 9 · 20 ноември“): set in capitals on the card.
	Issue string
	// Shape is how the questions that count went, in order: '1' right, '0' not (wrong, close, or not answered).
	Shape string
}

// The edition's day colours (web/DESIGN.md): the card is always on paper.
var (
	paper = color.RGBA{0xf6, 0xf1, 0xe7, 0xff}
	ink   = color.RGBA{0x1c, 0x19, 0x15, 0xff}
	ink2  = color.RGBA{0x4a, 0x44, 0x3b, 0xff}
	gold  = color.RGBA{0xd9, 0xa2, 0x1b, 0xff}
)

//go:embed fonts/*.ttf
var faces embed.FS

// fonts are the faces the card is set in, read once.
var fonts = sync.OnceValues(func() (map[string]*opentype.Font, error) {
	out := map[string]*opentype.Font{}
	for _, name := range []string{"literata-600", "literata-italic-500", "sofia-sans-500", "sofia-sans-700",
		"sofia-sans-extra-condensed-800"} {
		b, err := faces.ReadFile("fonts/" + name + ".ttf")
		if err != nil {
			return nil, err
		}
		if out[name], err = opentype.Parse(b); err != nil {
			return nil, fmt.Errorf("card: %s: %w", name, err)
		}
	}
	return out, nil
})

// Words are what every card says besides its result.
const (
	Name   = "АЛМАНАХ"
	Ask    = "Колко ще познаеш ти?"
	Waits  = "Същите десет въпроса чакат и теб."
	Footer = "Десет въпроса на ден, едни и същи за цяла България"
	Site   = "almanac.bg"
)

// Draw draws a card as a PNG.
func Draw(c Card) ([]byte, error) {
	all, err := fonts()
	if err != nil {
		return nil, err
	}
	// A face keeps buffers of its own: one for each drawing, never shared between two at once.
	face := func(name string, size float64) font.Face {
		f, _ := opentype.NewFace(all[name], &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingNone})
		return f
	}
	img := image.NewRGBA(image.Rect(0, 0, Width, Height))
	draw.Draw(img, img.Bounds(), image.NewUniform(paper), image.Point{}, draw.Src)
	const left, right = 60, Width - 60

	// The masthead: the mark, the name spaced out, the issue in small capitals at the right; the double rule under it.
	rosette(img, left, 50, 41)
	name := face("literata-600", 31)
	write(img, name, ink, left+41+17, 83, Name, 0.22*31)
	kicker := face("sofia-sans-700", 18)
	issue := strings.ToUpper(c.Issue)
	write(img, kicker, ink2, right-measure(kicker, issue, 0.12*18)+0.12*18, 77, issue, 0.12*18)
	fill(img, left, 117, right, 121, ink)
	fill(img, left, 125, right, 127, ink)

	// The footer: a rule, the line about the game, the address.
	fill(img, left, 541, right, 543, ink)
	write(img, face("literata-italic-500", 25), ink2, left, 580, Footer, 0)
	site := face("sofia-sans-700", 25)
	write(img, site, ink, right-measure(site, Site, 0.5), 580, Site, 0.5)

	// The score: the right answers as the hero numeral, „от 10“ beside it; then the shape, and the question to whoever
	// opens it.
	rights := strings.Count(c.Shape, "1")
	hero := face("sofia-sans-extra-condensed-800", 288)
	n := fmt.Sprint(rights)
	x := write(img, hero, ink, left-4, 422, n, 0)
	x = write(img, face("literata-italic-500", 60), ink2, x+19, 422, fmt.Sprintf("от %d", len(c.Shape)), 0)
	x += 60
	const square, gap = 43.0, 11.0
	for i, mark := range c.Shape {
		at := x + float64(i)*(square+gap)
		box(img, at, 256, at+square, 256+square, 4, ink)
		if mark != '1' {
			box(img, at+4, 260, at+square-4, 256+square-4, 1, paper)
		}
	}
	write(img, face("literata-600", 41), ink, x, 361, Ask, 0)
	write(img, face("sofia-sans-500", 24), ink2, x, 400, Waits, 0)

	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// write sets s in face from x on the baseline y, with track more between the letters, and says where it ended.
func write(dst draw.Image, face font.Face, c color.Color, x, y float64, s string, track float64) float64 {
	src := image.NewUniform(c)
	dot := fixed.Point26_6{X: fixed.Int26_6(math.Round(x * 64)), Y: fixed.Int26_6(math.Round(y * 64))}
	prev := rune(-1)
	for _, r := range s {
		if prev >= 0 {
			dot.X += face.Kern(prev, r)
		}
		dr, mask, maskp, advance, ok := face.Glyph(dot, r)
		if ok {
			draw.DrawMask(dst, dr, src, image.Point{}, mask, maskp, draw.Over)
		}
		dot.X += advance + fixed.Int26_6(math.Round(track*64))
		prev = r
	}
	return float64(dot.X)/64 - track
}

// measure is how wide write sets s.
func measure(face font.Face, s string, track float64) float64 {
	w := fixed.Int26_6(0)
	prev := rune(-1)
	for _, r := range s {
		if prev >= 0 {
			w += face.Kern(prev, r)
		}
		a, _ := face.GlyphAdvance(r)
		w += a + fixed.Int26_6(math.Round(track*64))
		prev = r
	}
	return float64(w)/64 - track
}

// fill fills a rectangle of whole pixels (a rule).
func fill(dst draw.Image, x0, y0, x1, y1 int, c color.Color) {
	draw.Draw(dst, image.Rect(x0, y0, x1, y1), image.NewUniform(c), image.Point{}, draw.Over)
}

// shape fills a path drawn within the box (x0, y0)–(x1, y1): a rasterizer only that big, the path drawn on it
// (trace) with the box's corner at its origin.
func shape(dst draw.Image, x0, y0, x1, y1 float64, c color.Color, trace func(z *vector.Rasterizer, x, y float64)) {
	r := image.Rect(int(math.Floor(x0)), int(math.Floor(y0)), int(math.Ceil(x1)), int(math.Ceil(y1)))
	z := vector.NewRasterizer(r.Dx(), r.Dy())
	trace(z, float64(r.Min.X), float64(r.Min.Y))
	z.Draw(dst, r, image.NewUniform(c), image.Point{})
}

// box fills a rectangle with corners rounded by r.
func box(dst draw.Image, x0, y0, x1, y1, r float64, c color.Color) {
	shape(dst, x0, y0, x1, y1, c, func(z *vector.Rasterizer, ox, oy float64) {
		k := r * 0.5523 // a quarter circle as a cubic curve
		p := func(x, y float64) (float32, float32) { return float32(x - ox), float32(y - oy) }
		cube := func(bx, by, cx, cy, dx, dy float64) {
			z.CubeTo(float32(bx-ox), float32(by-oy), float32(cx-ox), float32(cy-oy), float32(dx-ox), float32(dy-oy))
		}
		z.MoveTo(p(x0+r, y0))
		z.LineTo(p(x1-r, y0))
		cube(x1-r+k, y0, x1, y0+r-k, x1, y0+r)
		z.LineTo(p(x1, y1-r))
		cube(x1, y1-r+k, x1-r+k, y1, x1-r, y1)
		z.LineTo(p(x0+r, y1))
		cube(x0+r-k, y1, x0, y1-r+k, x0, y1-r)
		z.LineTo(p(x0, y0+r))
		cube(x0, y0+r-k, x0+r-k, y0, x0+r, y0)
		z.ClosePath()
	})
}

// petal is the mark's petal (web/public/favicon.svg: „M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12
// 0 4.5 4.8 1.5 14.8-6 20.3z“) as absolute points on the mark's 64 × 64: where it starts, then three cubic curves.
var petal = [10][2]float64{
	{32, 30.2},
	{24.5, 24.7}, {21.5, 14.7}, {26, 9.9},
	{29.2, 6.5}, {34.8, 6.5}, {38, 9.9},
	{42.5, 14.7}, {39.5, 24.7}, {32, 30.2},
}

// rosette draws the mark, size across from (x, y): four petals about its centre, three in ink and the gold one
// turned up to the left, as favicon.svg has them, without its tile. Its box is the part of the 64 × 64 the petals
// fill (5 to 59), as the edition's masthead sets it.
func rosette(dst draw.Image, x, y, size float64) {
	scale := size / 54
	for _, turn := range []float64{45, 135, 225, -45} {
		sin, cos := math.Sincos(turn * math.Pi / 180)
		c := ink
		if turn < 0 {
			c = gold
		}
		shape(dst, x, y, x+size, y+size, c, func(z *vector.Rasterizer, ox, oy float64) {
			at := func(i int) (float32, float32) {
				px, py := petal[i][0]-32, petal[i][1]-32
				rx, ry := px*cos-py*sin+32, px*sin+py*cos+32
				return float32(x + (rx-5)*scale - ox), float32(y + (ry-5)*scale - oy)
			}
			z.MoveTo(at(0))
			for i := 1; i < len(petal); i += 3 {
				bx, by := at(i)
				cx, cy := at(i + 1)
				dx, dy := at(i + 2)
				z.CubeTo(bx, by, cx, cy, dx, dy)
			}
			z.ClosePath()
		})
	}
}
