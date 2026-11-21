// Package card draws the pictures a link to the game shows where it's sent (Viber, Messenger, WhatsApp: its Open Graph
// image, 1200 × 630), in the game's look, „a bright almanac“ (DECISIONS.md), always by day, whatever the theme of whoever
// opens it:
//
//   - a shared day's card (Draw), the picture a shared day's link shows and the browser shares as the day is shared
//     (web/src/game/share.ts, cardFile): the mark and the name, „Брой“ and the issue's number big with its date,
//     almanac.bg, and the ten tiles two rows of five, each its chapter's colour with its glyph, filled right, the left
//     half filled близо, dashed and hollow wrong (so that they part in grey too), dashed and empty one that counts for
//     nobody. Never an answer, never a name, never the score in figures (the link's title says it: server/pages.go);
//   - the site's own picture (Site, /og.png): the mark and the name, „Десет въпроса на ден, едни и същи за цяла
//     България.“, a day's ten tiles and almanac.bg.
//
// It's drawn here, in Go, with the game's own faces (fonts: static TrueType cuts of the client's families, made by
// web/src/fonts/subset.sh; the SIL Open Font License, fonts/OFL.txt), the mark drawn from web/public/favicon.svg's
// petal as shapes, and the chapters' glyphs from the client's art (glyph.go). Drawing one takes some milliseconds of
// CPU: the server keeps what it drew (server/share.go), and a card is the same for every result of one shape on one
// day, so there are only so many to draw.
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

// Card is what a shared day's card shows.
type Card struct {
	// Issue is the day's issue, and Date its day in words („21 ноември“).
	Issue int
	Date  string
	// Topics are the issue's ten chapters in the order they're asked (play.Game.IssueTopics).
	Topics []string
	// Shape is how each of the issue's ten went, in its order (play.Share.Shape): '1' right, '2' близо, '3' one that
	// counts for nobody, anything else wrong.
	Shape string
}

// The day's colours (web/DESIGN.md).
var (
	page = color.RGBA{0xf3, 0xf4, 0xfa, 0xff}
	ink  = color.RGBA{0x16, 0x13, 0x2b, 0xff}
	ink3 = color.RGBA{0x5d, 0x5a, 0x77, 0xff}
	gold = color.RGBA{0xe0, 0xa8, 0x1e, 0xff}
	surf = color.RGBA{0xff, 0xff, 0xff, 0xff}
)

// vivid and deep are the chapters' colours by day (app.css's --t- and --d-; card_test.go holds them equal).
var (
	vivid = map[string]color.RGBA{
		"general": hex(0xffc21a), "science": hex(0x22ccc4), "history": hex(0xff6b4a), "geography": hex(0x4b90ff),
		"movies": hex(0xe863e6), "music": hex(0x9a82ff), "sports": hex(0xff9a2e), "technology": hex(0xa3db2e),
		"literature": hex(0xff77ae), "nature": hex(0x33cf7a), "mix": hex(0xc9c4de), "bulgaria": hex(0x2ec4a0),
	}
	deep = map[string]color.RGBA{
		"general": hex(0x8a5d00), "science": hex(0x00777a), "history": hex(0xc33a1c), "geography": hex(0x1f5fd6),
		"movies": hex(0xa52ba6), "music": hex(0x5a43e0), "sports": hex(0xad5300), "technology": hex(0x4c7700),
		"literature": hex(0xc42d6c), "nature": hex(0x0f8148), "mix": hex(0x4a4766), "bulgaria": hex(0x0b7a60),
	}
)

func hex(v uint32) color.RGBA { return color.RGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 0xff} }

//go:embed fonts/*.ttf
var faces embed.FS

// fonts are the faces the pictures are set in, read once.
var fonts = sync.OnceValues(func() (map[string]*opentype.Font, error) {
	out := map[string]*opentype.Font{}
	for _, name := range []string{"sofia-sans-800", "sofia-sans-900", "sofia-sans-extra-condensed-900"} {
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

// Words are what the pictures say besides a day's issue.
const (
	Name    = "АЛМАНАХ"
	Address = "almanac.bg"
	Line    = "Десет въпроса на ден, едни и същи за цяла България."
)

// Draw draws a shared day's card as a PNG.
func Draw(c Card) ([]byte, error) {
	p, err := newPicture()
	if err != nil {
		return nil, err
	}
	// The issue: „Брой“, its number set big (smaller, should it ever run into the tiles), and the date.
	p.write(p.face("sofia-sans-900", 56), ink, 64, 238, "Брой", 0)
	n := fmt.Sprint(c.Issue)
	size := 250.0
	if w := p.measure(p.face("sofia-sans-extra-condensed-900", size), n, 0); w > 370 {
		size *= 370 / w
	}
	p.write(p.face("sofia-sans-extra-condensed-900", size), ink, 56, 456, n, 0)
	p.write(p.face("sofia-sans-800", 44), ink, 64, 530, c.Date, 0)
	if err := p.tiles(c.Topics, c.Shape); err != nil {
		return nil, err
	}
	return p.png()
}

// The site's picture: the ten chapters of the game as a day's tiles, mostly right, one близо, two not.
var (
	siteTopics = []string{"general", "science", "history", "geography", "movies", "music", "sports", "technology",
		"literature", "nature"}
	siteShape = "1120111101"
)

// Site draws the site's own picture as a PNG: the mark and the name, the game in a line, a day's tiles.
func Site() ([]byte, error) {
	p, err := newPicture()
	if err != nil {
		return nil, err
	}
	line := p.face("sofia-sans-900", 50)
	y := 240.0 // its four lines about the tiles' middle
	for _, l := range wrap(p, line, Line, 372) {
		p.write(line, ink, 64, y, l, 0)
		y += 58
	}
	if err := p.tiles(siteTopics, siteShape); err != nil {
		return nil, err
	}
	return p.png()
}

// wrap breaks s into lines no wider than w.
func wrap(p *picture, face font.Face, s string, w float64) []string {
	var lines []string
	line := ""
	for _, word := range strings.Fields(s) {
		if line != "" && p.measure(face, line+" "+word, 0) > w {
			lines = append(lines, line)
			line = word
			continue
		}
		line = strings.TrimSpace(line + " " + word)
	}
	return append(lines, line)
}

// picture is one being drawn: its page with the mark, the name and the address on it.
type picture struct {
	img   *image.RGBA
	fonts map[string]*opentype.Font
}

func newPicture() (*picture, error) {
	all, err := fonts()
	if err != nil {
		return nil, err
	}
	p := &picture{img: image.NewRGBA(image.Rect(0, 0, Width, Height)), fonts: all}
	draw.Draw(p.img, p.img.Bounds(), image.NewUniform(page), image.Point{}, draw.Src)
	rosette(p.img, 64, 58, 52)
	name := p.face("sofia-sans-900", 34)
	m := name.Metrics()
	// Set on its middle at 86, as the canvas's textBaseline "middle" sets it: half-way between the face's ascent and
	// its descent.
	p.write(name, ink, 134, 86+float64(m.Ascent-m.Descent)/64/2, Name, 7)
	p.write(p.face("sofia-sans-800", 34), ink3, 64, 590, Address, 0)
	return p, nil
}

// face is one of the faces at a size. A face keeps buffers of its own: one for each drawing, never shared between
// two at once.
func (p *picture) face(name string, size float64) font.Face {
	f, _ := opentype.NewFace(p.fonts[name], &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingNone})
	return f
}

func (p *picture) png() ([]byte, error) {
	var out bytes.Buffer
	if err := png.Encode(&out, p.img); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// tiles draws the ten tiles, two rows of five at the right, as the screen's are: topics are their chapters, shape how
// each went (Card.Shape).
func (p *picture) tiles(topics []string, shape string) error {
	const size, gap = 120.0, 18.0
	const x0, y0 = Width - 64 - 5*size - 4*gap, (Height - 2*size - gap) / 2
	const r = size * 0.24
	for i := range 10 {
		topic := "mix"
		if i < len(topics) {
			topic = topics[i]
		}
		mark := byte('0')
		if i < len(shape) {
			mark = shape[i]
		}
		tone, ok := vivid[topic]
		if !ok {
			tone = vivid["mix"]
		}
		edge, ok := deep[topic]
		if !ok {
			edge = ink
		}
		x := x0 + float64(i%5)*(size+gap)
		y := y0 + float64(i/5)*(size+gap)
		right, near, void := mark == '1', mark == '2', mark == '3'
		box(p.img, x, y, x+size, y+size, r, surf)
		switch {
		case right:
			box(p.img, x, y, x+size, y+size, r, tone)
			circle(p.img, x+size/2, y+size/2, size*0.37, surf)
		case near:
			// The left half in the chapter's colour: the tile's shape, cut at its middle.
			half := image.NewRGBA(image.Rect(0, 0, int(size), int(size)))
			box(half, 0, 0, size, size, r, tone)
			draw.Draw(p.img, image.Rect(int(x), int(y), int(x+size/2), int(y+size)), half, image.Point{}, draw.Over)
		}
		if !right {
			// A void one's dashes in the page's grey: it counts for nobody, nothing of its chapter.
			c := edge
			if void {
				c = ink3
			}
			outline(p.img, x+3, y+3, x+size-3, y+size-3, r-3, 6, c, !near)
		}
		if void {
			continue
		}
		g, a := size*0.6, 0.45
		if right {
			g = size * 0.64
		}
		if right || near {
			a = 1
		}
		if err := glyph(p.img, topic, tone, x+(size-g)/2, y+(size-g)/2, g, a); err != nil {
			return err
		}
	}
	return nil
}

// write sets s in face from x on the baseline y, with track more between the letters, and says where it ended.
func (p *picture) write(face font.Face, c color.Color, x, y float64, s string, track float64) float64 {
	src := image.NewUniform(c)
	dot := fixed.Point26_6{X: fixed.Int26_6(math.Round(x * 64)), Y: fixed.Int26_6(math.Round(y * 64))}
	prev := rune(-1)
	for _, r := range s {
		if prev >= 0 {
			dot.X += face.Kern(prev, r)
		}
		dr, mask, maskp, advance, ok := face.Glyph(dot, r)
		if ok {
			draw.DrawMask(p.img, dr, src, image.Point{}, mask, maskp, draw.Over)
		}
		dot.X += advance + fixed.Int26_6(math.Round(track*64))
		prev = r
	}
	return float64(dot.X)/64 - track
}

// measure is how wide write sets s.
func (p *picture) measure(face font.Face, s string, track float64) float64 {
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

// shape fills a path drawn within the box (x0, y0)–(x1, y1): a rasterizer only that big, the path drawn on it
// (trace) with the box's corner at its origin.
func shape(dst draw.Image, x0, y0, x1, y1 float64, c color.Color, trace func(z *vector.Rasterizer, x, y float64)) {
	r := image.Rect(int(math.Floor(x0)), int(math.Floor(y0)), int(math.Ceil(x1)), int(math.Ceil(y1)))
	z := vector.NewRasterizer(r.Dx(), r.Dy())
	trace(z, float64(r.Min.X), float64(r.Min.Y))
	z.Draw(dst, r, image.NewUniform(c), image.Point{})
}

// rounded is a rectangle with corners rounded by r as points, clockwise from the top edge's left end (where the
// canvas's roundRect starts, so that dashes begin where a browser's do).
func rounded(x0, y0, x1, y1, r float64) []pt {
	out := []pt{{x0 + r, y0}}
	corner := func(cx, cy, from float64) {
		for i := 0; i <= 8; i++ {
			s, c := math.Sincos((from + 90*float64(i)/8) * math.Pi / 180)
			out = append(out, pt{cx + r*c, cy + r*s})
		}
	}
	corner(x1-r, y0+r, -90)
	corner(x1-r, y1-r, 0)
	corner(x0+r, y1-r, 90)
	corner(x0+r, y0+r, 180) // which ends where it began
	return out
}

// box fills a rectangle with corners rounded by r.
func box(dst draw.Image, x0, y0, x1, y1, r float64, c color.Color) {
	shape(dst, x0, y0, x1, y1, c, func(z *vector.Rasterizer, ox, oy float64) {
		line := rounded(x0, y0, x1, y1, r)
		z.MoveTo(float32(line[0].x-ox), float32(line[0].y-oy))
		for _, p := range line[1:] {
			z.LineTo(float32(p.x-ox), float32(p.y-oy))
		}
		z.ClosePath()
	})
}

// circle fills a circle.
func circle(dst draw.Image, cx, cy, r float64, c color.Color) {
	shape(dst, cx-r, cy-r, cx+r, cy+r, c, func(z *vector.Rasterizer, ox, oy float64) {
		disc(z, pt{cx - ox, cy - oy}, r)
	})
}

// outline strokes a rounded rectangle's edge, w wide on its line, dashed (14 on, 9 off) or whole.
func outline(dst draw.Image, x0, y0, x1, y1, r, w float64, c color.Color, dashed bool) {
	shape(dst, x0-w, y0-w, x1+w, y1+w, c, func(z *vector.Rasterizer, ox, oy float64) {
		line := rounded(x0-ox, y0-oy, x1-ox, y1-oy, r)
		if !dashed {
			band(z, line[:len(line)-1], true, w, true)
			return
		}
		const on, off = 14.0, 9.0
		var dash []pt
		drawing, left := true, on // whether it's a dash now, and how much of it (or of the gap) is left
		flush := func() {
			if len(dash) > 1 {
				band(z, dash, false, w, false)
				for _, p := range dash[1 : len(dash)-1] { // round joins inside a dash; its ends butt
					disc(z, p, w/2)
				}
			}
			dash = nil
		}
		for i := 0; i+1 < len(line); i++ {
			a, b := line[i], line[i+1]
			l := math.Hypot(b.x-a.x, b.y-a.y)
			at := 0.0
			for at < l {
				step := math.Min(left, l-at)
				from := pt{a.x + (b.x-a.x)*at/l, a.y + (b.y-a.y)*at/l}
				to := pt{a.x + (b.x-a.x)*(at+step)/l, a.y + (b.y-a.y)*(at+step)/l}
				if drawing {
					if len(dash) == 0 {
						dash = append(dash, from)
					}
					dash = append(dash, to)
				}
				at += step
				left -= step
				if left <= 1e-9 {
					if drawing {
						flush()
						left = off
					} else {
						left = on
					}
					drawing = !drawing
				}
			}
		}
		flush()
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
// fill (5 to 59).
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
