package card

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/image/vector"
)

// The chapters' glyphs, as the client draws them (web/src/art/pictures.ts): each a list of SVG paths on a 64 × 64
// grid, its ink a class (k0–k5 and kw, ks, kh, kt filled; l0–l5 the same inks as strokes), now and then a transform
// and a stroke's width. glyphs.json is pictures.ts's, written by the client's tests and held equal there
// (web/src/art/pictures.test.ts), so the art is drawn in one place. Here they're read once into polygons, and painted
// with x/image/vector: curves and arcs flattened to lines, a stroke as a band of quads with round ends and joins.

//go:embed glyphs.json
var glyphsJSON []byte

// layer is one path of a glyph, flattened: its outlines (each closed for a fill), its ink, and a stroke's width
// (0: a fill).
type layer struct {
	ink    string
	width  float64
	lines  [][]pt
	closed []bool
}

type pt struct{ x, y float64 }

var glyphs = sync.OnceValues(func() (map[string][]layer, error) { return readGlyphs(glyphsJSON) })

// readGlyphs reads glyphs.json: each glyph's paths by its chapter.
func readGlyphs(b []byte) (map[string][]layer, error) {
	var raw map[string]string
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	out := map[string][]layer{}
	for id, svg := range raw {
		for _, m := range pathTag.FindAllStringSubmatch(svg, -1) {
			attrs := map[string]string{}
			for _, a := range attr.FindAllStringSubmatch(m[1], -1) {
				attrs[a[1]] = a[2]
			}
			l := layer{ink: attrs["class"]}
			if strings.HasPrefix(l.ink, "l") {
				l.width = 2
				if w, err := strconv.ParseFloat(attrs["stroke-width"], 64); err == nil {
					l.width = w
				}
			}
			at, err := transform(attrs["transform"])
			if err != nil {
				return nil, fmt.Errorf("card: glyph %s: %w", id, err)
			}
			if l.lines, l.closed, err = flatten(attrs["d"], at); err != nil {
				return nil, fmt.Errorf("card: glyph %s: %w", id, err)
			}
			if l.width > 0 {
				l.width *= math.Sqrt(math.Abs(at[0]*at[3] - at[1]*at[2]))
			}
			out[id] = append(out[id], l)
		}
	}
	return out, nil
}

var (
	pathTag = regexp.MustCompile(`<path\s([^>]*?)/>`)
	attr    = regexp.MustCompile(`([a-z-]+)="([^"]*)"`)
)

// inks are a glyph's colours from its chapter's tone, as app.css's .pic sets them by day.
func inks(tone color.RGBA) map[string]color.Color {
	night := color.RGBA{0x14, 0x0f, 0x26, 0xff}
	white := color.RGBA{0xff, 0xff, 0xff, 0xff}
	k := map[string]color.Color{
		"k0": night,
		"k1": mix(tone, night, 0.42),
		"k2": mix(tone, night, 0.7),
		"k3": tone,
		"k4": mix(tone, white, 0.72),
		"k5": mix(tone, white, 0.32),
		"kw": white,
		"ks": alpha(night, 0.2),
		"kh": alpha(white, 0.32),
		"kt": alpha(tone, 0.26),
	}
	for i := range 6 {
		k[fmt.Sprintf("l%d", i)] = k[fmt.Sprintf("k%d", i)]
	}
	return k
}

// mix is p of a and the rest of b, as color-mix in srgb mixes them.
func mix(a, b color.RGBA, p float64) color.RGBA {
	m := func(x, y uint8) uint8 { return uint8(math.Round(float64(x)*p + float64(y)*(1-p))) }
	return color.RGBA{m(a.R, b.R), m(a.G, b.G), m(a.B, b.B), 0xff}
}

// alpha is c at opacity a (premultiplied, as image/color has it).
func alpha(c color.RGBA, a float64) color.RGBA {
	m := func(x uint8) uint8 { return uint8(math.Round(float64(x) * a)) }
	return color.RGBA{m(c.R), m(c.G), m(c.B), m(0xff)}
}

// glyph paints a chapter's glyph size across at (x, y), at opacity a (the whole glyph, as the canvas's globalAlpha).
func glyph(dst draw.Image, topic string, tone color.RGBA, x, y, size, a float64) error {
	all, err := glyphs()
	if err != nil {
		return err
	}
	paint(dst, all[topic], tone, x, y, size, a)
	return nil
}

// paint paints a glyph's layers size across at (x, y), at opacity a.
func paint(dst draw.Image, layers []layer, tone color.RGBA, x, y, size, a float64) {
	if layers == nil {
		return
	}
	r := image.Rect(int(math.Floor(x)), int(math.Floor(y)), int(math.Ceil(x+size)), int(math.Ceil(y+size)))
	own := image.NewRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
	ox, oy, k := x-float64(r.Min.X), y-float64(r.Min.Y), size/64
	place := func(p pt) (float32, float32) { return float32(ox + p.x*k), float32(oy + p.y*k) }
	ink := inks(tone)
	for _, l := range layers {
		z := vector.NewRasterizer(r.Dx(), r.Dy())
		if l.width == 0 {
			for _, line := range l.lines {
				z.MoveTo(place(line[0]))
				for _, p := range line[1:] {
					z.LineTo(place(p))
				}
				z.ClosePath()
			}
		} else {
			for i, line := range l.lines {
				scaled := make([]pt, len(line))
				for j, p := range line {
					sx, sy := place(p)
					scaled[j] = pt{float64(sx), float64(sy)}
				}
				band(z, scaled, l.closed[i], l.width*k, true)
			}
		}
		z.Draw(own, own.Bounds(), image.NewUniform(ink[l.ink]), image.Point{})
	}
	draw.DrawMask(dst, r, own, image.Point{}, image.NewUniform(color.Alpha{uint8(math.Round(a * 255))}),
		image.Point{}, draw.Over)
}

// band adds a stroke of width w along a line to z: a quad for each of its pieces and, with round, a disc at each of
// its points (round ends and joins). All of one turning, so that where they overlap they add, never cancel.
func band(z *vector.Rasterizer, line []pt, closed bool, w float64, round bool) {
	h := w / 2
	n := len(line)
	pieces := n - 1
	if closed {
		pieces = n
	}
	for i := range pieces {
		a, b := line[i], line[(i+1)%n]
		dx, dy := b.x-a.x, b.y-a.y
		l := math.Hypot(dx, dy)
		if l == 0 {
			continue
		}
		nx, ny := -dy/l*h, dx/l*h
		z.MoveTo(float32(a.x+nx), float32(a.y+ny))
		z.LineTo(float32(b.x+nx), float32(b.y+ny))
		z.LineTo(float32(b.x-nx), float32(b.y-ny))
		z.LineTo(float32(a.x-nx), float32(a.y-ny))
		z.ClosePath()
	}
	if !round {
		return
	}
	for _, p := range line {
		disc(z, p, h)
	}
}

// disc adds a circle to z, turning the way band's quads do.
func disc(z *vector.Rasterizer, c pt, r float64) {
	const steps = 20
	for i := 0; i <= steps; i++ {
		s, co := math.Sincos(-2 * math.Pi * float64(i) / steps)
		x, y := float32(c.x+r*co), float32(c.y+r*s)
		if i == 0 {
			z.MoveTo(x, y)
		} else {
			z.LineTo(x, y)
		}
	}
	z.ClosePath()
}

// matrix is an affine transform (a b c d e f, as SVG has it): x' = a x + c y + e, y' = b x + d y + f.
type matrix [6]float64

var identity = matrix{1, 0, 0, 1, 0, 0}

func (m matrix) then(n matrix) matrix { // m applied after n
	return matrix{
		m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1],
		m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3],
		m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5],
	}
}

func (m matrix) apply(p pt) pt {
	return pt{m[0]*p.x + m[2]*p.y + m[4], m[1]*p.x + m[3]*p.y + m[5]}
}

var transformPart = regexp.MustCompile(`(translate|rotate|scale)\(([^)]*)\)`)

// transform reads an SVG transform list (translate, rotate, scale: what the glyphs use).
func transform(s string) (matrix, error) {
	m := identity
	for _, part := range transformPart.FindAllStringSubmatch(s, -1) {
		var v []float64
		for _, f := range strings.FieldsFunc(part[2], func(r rune) bool { return r == ' ' || r == ',' }) {
			x, err := strconv.ParseFloat(f, 64)
			if err != nil {
				return m, err
			}
			v = append(v, x)
		}
		var t matrix
		switch {
		case part[1] == "translate" && len(v) >= 1:
			t = matrix{1, 0, 0, 1, v[0], 0}
			if len(v) > 1 {
				t[5] = v[1]
			}
		case part[1] == "scale" && len(v) >= 1:
			t = matrix{v[0], 0, 0, v[0], 0, 0}
			if len(v) > 1 {
				t[3] = v[1]
			}
		case part[1] == "rotate" && len(v) >= 1:
			s, c := math.Sincos(v[0] * math.Pi / 180)
			t = matrix{c, s, -s, c, 0, 0}
			if len(v) == 3 {
				t = matrix{1, 0, 0, 1, v[1], v[2]}.then(t).then(matrix{1, 0, 0, 1, -v[1], -v[2]})
			}
		default:
			return m, fmt.Errorf("transform %q", part[0])
		}
		m = m.then(t)
	}
	return m, nil
}

var pathToken = regexp.MustCompile(`[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:[0-9]*\.[0-9]+|[0-9]+\.?)(?:[eE][-+]?[0-9]+)?`)

// flatten reads an SVG path's data into lines of points (curves and arcs as short straight pieces), transformed by m,
// with whether each is closed.
func flatten(d string, m matrix) ([][]pt, []bool, error) {
	tokens := pathToken.FindAllString(d, -1)
	var (
		lines  [][]pt
		closed []bool
		cur    []pt
		at     pt   // where the pen is
		start  pt   // where the line began
		ctrl   pt   // the last curve's second control point, for S and T
		cmd    byte // the command its numbers are for
		prev   byte
	)
	i := 0
	num := func() (float64, error) {
		if i >= len(tokens) {
			return 0, fmt.Errorf("path %q ends early", d)
		}
		v, err := strconv.ParseFloat(tokens[i], 64)
		i++
		return v, err
	}
	nums := func(n int) ([]float64, error) {
		v := make([]float64, n)
		for k := range v {
			var err error
			if v[k], err = num(); err != nil {
				return nil, err
			}
		}
		return v, nil
	}
	end := func(isClosed bool) {
		if len(cur) > 1 {
			lines = append(lines, cur)
			closed = append(closed, isClosed)
		}
		cur = nil
	}
	add := func(p pt) { cur = append(cur, m.apply(p)) }
	for i < len(tokens) {
		t := tokens[i]
		if c := t[0]; strings.IndexByte("MmLlHhVvCcSsQqTtAaZz", c) >= 0 {
			cmd = c
			i++
			if c == 'Z' || c == 'z' {
				end(true)
				at = start
				cur = []pt{m.apply(start)} // a line drawn on from here starts where the last began
				prev = c
				continue
			}
		} else if cmd == 0 {
			return nil, nil, fmt.Errorf("path %q starts with a number", d)
		}
		rel := cmd >= 'a'
		base := pt{}
		if rel {
			base = at
		}
		switch cmd | 0x20 { // lower case
		case 'm':
			v, err := nums(2)
			if err != nil {
				return nil, nil, err
			}
			end(false)
			at = pt{base.x + v[0], base.y + v[1]}
			start = at
			add(at)
			// Numbers after a moveto are linetos.
			if rel {
				cmd = 'l'
			} else {
				cmd = 'L'
			}
		case 'l':
			v, err := nums(2)
			if err != nil {
				return nil, nil, err
			}
			at = pt{base.x + v[0], base.y + v[1]}
			add(at)
		case 'h':
			v, err := num()
			if err != nil {
				return nil, nil, err
			}
			at = pt{base.x + v, at.y}
			if !rel {
				at.x = v
			}
			add(at)
		case 'v':
			v, err := num()
			if err != nil {
				return nil, nil, err
			}
			at = pt{at.x, base.y + v}
			if !rel {
				at.y = v
			}
			add(at)
		case 'c', 's':
			var p1 pt
			var v []float64
			var err error
			if cmd|0x20 == 'c' {
				if v, err = nums(6); err != nil {
					return nil, nil, err
				}
				p1 = pt{base.x + v[0], base.y + v[1]}
				v = v[2:]
			} else {
				if v, err = nums(4); err != nil {
					return nil, nil, err
				}
				p1 = at
				if p := prev | 0x20; p == 'c' || p == 's' {
					p1 = pt{2*at.x - ctrl.x, 2*at.y - ctrl.y}
				}
			}
			p2 := pt{base.x + v[0], base.y + v[1]}
			p3 := pt{base.x + v[2], base.y + v[3]}
			for k := 1; k <= 16; k++ {
				s := float64(k) / 16
				u := 1 - s
				add(pt{
					u*u*u*at.x + 3*u*u*s*p1.x + 3*u*s*s*p2.x + s*s*s*p3.x,
					u*u*u*at.y + 3*u*u*s*p1.y + 3*u*s*s*p2.y + s*s*s*p3.y,
				})
			}
			ctrl, at = p2, p3
		case 'q', 't':
			var p1 pt
			var v []float64
			var err error
			if cmd|0x20 == 'q' {
				if v, err = nums(4); err != nil {
					return nil, nil, err
				}
				p1 = pt{base.x + v[0], base.y + v[1]}
				v = v[2:]
			} else {
				if v, err = nums(2); err != nil {
					return nil, nil, err
				}
				p1 = at
				if p := prev | 0x20; p == 'q' || p == 't' {
					p1 = pt{2*at.x - ctrl.x, 2*at.y - ctrl.y}
				}
			}
			p2 := pt{base.x + v[0], base.y + v[1]}
			for k := 1; k <= 12; k++ {
				s := float64(k) / 12
				u := 1 - s
				add(pt{u*u*at.x + 2*u*s*p1.x + s*s*p2.x, u*u*at.y + 2*u*s*p1.y + s*s*p2.y})
			}
			ctrl, at = p1, p2
		case 'a':
			v, err := nums(7)
			if err != nil {
				return nil, nil, err
			}
			to := pt{base.x + v[5], base.y + v[6]}
			for _, p := range arc(at, to, v[0], v[1], v[2], v[3] != 0, v[4] != 0) {
				add(p)
			}
			at = to
		default:
			return nil, nil, fmt.Errorf("path %q: %c", d, cmd)
		}
		prev = cmd
	}
	end(false)
	return lines, closed, nil
}

// arc is an SVG elliptical arc from a to b as points after a (the SVG spec's appendix F.6: its centre from its ends).
func arc(a, b pt, rx, ry, deg float64, large, sweep bool) []pt {
	rx, ry = math.Abs(rx), math.Abs(ry)
	if rx == 0 || ry == 0 || a == b {
		return []pt{b}
	}
	sin, cos := math.Sincos(deg * math.Pi / 180)
	dx, dy := (a.x-b.x)/2, (a.y-b.y)/2
	x1 := cos*dx + sin*dy
	y1 := -sin*dx + cos*dy
	if l := x1*x1/(rx*rx) + y1*y1/(ry*ry); l > 1 {
		rx, ry = rx*math.Sqrt(l), ry*math.Sqrt(l)
	}
	num := rx*rx*ry*ry - rx*rx*y1*y1 - ry*ry*x1*x1
	den := rx*rx*y1*y1 + ry*ry*x1*x1
	k := math.Sqrt(math.Max(0, num/den))
	if large == sweep {
		k = -k
	}
	cx1, cy1 := k*rx*y1/ry, -k*ry*x1/rx
	cx := cos*cx1 - sin*cy1 + (a.x+b.x)/2
	cy := sin*cx1 + cos*cy1 + (a.y+b.y)/2
	angle := func(ux, uy, vx, vy float64) float64 { return math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy) }
	t1 := angle(1, 0, (x1-cx1)/rx, (y1-cy1)/ry)
	dt := angle((x1-cx1)/rx, (y1-cy1)/ry, (-x1-cx1)/rx, (-y1-cy1)/ry)
	if !sweep && dt > 0 {
		dt -= 2 * math.Pi
	} else if sweep && dt < 0 {
		dt += 2 * math.Pi
	}
	steps := max(4, int(math.Ceil(math.Abs(dt)/(math.Pi/16))))
	out := make([]pt, 0, steps)
	for i := 1; i <= steps; i++ {
		t := t1 + dt*float64(i)/float64(steps)
		s, c := math.Sincos(t)
		out = append(out, pt{cx + rx*c*cos - ry*s*sin, cy + rx*c*sin + ry*s*cos})
	}
	out[len(out)-1] = b
	return out
}
