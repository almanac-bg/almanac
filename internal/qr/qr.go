// Package qr draws a QR code (ISO/IEC 18004) of a short text, as SVG: a room's link on a big screen, for the phones
// in the room to open with their camera. It's drawn here rather than by an outside service, which would learn every
// room's code.
//
// It does what a link needs and no more: byte mode, error correction level M (a code still reads with 15% of it
// smudged or cut off), versions 1 to 9 (up to 180 bytes), and of the eight masks the one the standard's penalty
// rules score lowest. The steps follow the standard's order: the function patterns (finders, timing, alignment, the
// format and version bits), the data in codewords with their Reed–Solomon error correction, interleaved by block and
// placed in the two-module zigzag from the bottom right, then the mask.
package qr

import (
	"errors"
	"fmt"
	"strings"
)

// ErrTooLong is a text longer than version 9 holds at level M.
var ErrTooLong = errors.New("qr: text too long")

// Level M, versions 1 to 9: the error correction codewords in each block, and the blocks (how many of how many data
// codewords) — the standard's table 9.
var (
	eccPerBlock = [10]int{0, 10, 16, 26, 18, 24, 16, 18, 22, 22}
	blocks      = [10][][2]int{
		nil, {{1, 16}}, {{1, 28}}, {{1, 44}}, {{2, 32}}, {{2, 43}}, {{4, 27}}, {{4, 31}}, {{2, 38}, {2, 39}},
		{{3, 36}, {2, 37}},
	}
	// alignment are the centres' rows and columns of each version's alignment patterns (annex E).
	alignment = [10][]int{
		nil, nil, {6, 18}, {6, 22}, {6, 26}, {6, 30}, {6, 34}, {6, 22, 38}, {6, 24, 42}, {6, 26, 46},
	}
)

// dataCodewords is how many data codewords a version holds at level M.
func dataCodewords(version int) int {
	n := 0
	for _, g := range blocks[version] {
		n += g[0] * g[1]
	}
	return n
}

// Code is a QR code: Size×Size modules, dark where true (without the quiet zone around it).
type Code struct {
	Size    int
	Version int
	Mask    int
	modules [][]bool
	fixed   [][]bool // function patterns: no data, no mask
}

// Dark says whether the module at column x, row y is dark.
func (c *Code) Dark(x, y int) bool { return c.modules[y][x] }

// Encode makes the code of a text.
func Encode(text string) (*Code, error) {
	data := []byte(text)
	version := 1
	for ; version <= 9; version++ {
		if 4+8+8*len(data) <= 8*dataCodewords(version) {
			break
		}
	}
	if version > 9 {
		return nil, ErrTooLong
	}
	c := &Code{Size: 17 + 4*version, Version: version}
	c.modules, c.fixed = grid(c.Size), grid(c.Size)
	c.functionPatterns()
	c.place(codewords(version, data))
	best := -1
	for mask := range 8 {
		c.applyMask(mask)
		c.formatBits(mask)
		if p := c.penalty(); best < 0 || p < best {
			best, c.Mask = p, mask
		}
		c.applyMask(mask) // undone: XOR again
	}
	c.applyMask(c.Mask)
	c.formatBits(c.Mask)
	return c, nil
}

func grid(n int) [][]bool {
	g := make([][]bool, n)
	for i := range g {
		g[i] = make([]bool, n)
	}
	return g
}

// set puts a function module at column x, row y.
func (c *Code) set(x, y int, dark bool) {
	c.modules[y][x] = dark
	c.fixed[y][x] = true
}

func (c *Code) functionPatterns() {
	n := c.Size
	for i := range n { // timing
		c.set(6, i, i%2 == 0)
		c.set(i, 6, i%2 == 0)
	}
	for _, at := range [][2]int{{3, 3}, {n - 4, 3}, {3, n - 4}} { // finders, with their light separators
		for dy := -4; dy <= 4; dy++ {
			for dx := -4; dx <= 4; dx++ {
				x, y := at[0]+dx, at[1]+dy
				if x >= 0 && x < n && y >= 0 && y < n {
					d := max(abs(dx), abs(dy))
					c.set(x, y, d != 2 && d != 4)
				}
			}
		}
	}
	pos := alignment[c.Version]
	for i, y := range pos {
		for j, x := range pos {
			last := len(pos) - 1
			if (i == 0 && j == 0) || (i == 0 && j == last) || (i == last && j == 0) {
				continue // where the finders are
			}
			for dy := -2; dy <= 2; dy++ {
				for dx := -2; dx <= 2; dx++ {
					c.set(x+dx, y+dy, max(abs(dx), abs(dy)) != 1)
				}
			}
		}
	}
	c.formatBits(0) // reserves their places; drawn for real with the mask chosen
	if c.Version >= 7 {
		rem := c.Version
		for range 12 {
			rem = rem<<1 ^ (rem>>11)*0x1F25
		}
		bits := c.Version<<12 | rem
		for i := range 18 {
			dark := bits>>i&1 == 1
			a, b := n-11+i%3, i/3
			c.set(a, b, dark)
			c.set(b, a, dark)
		}
	}
}

// formatBits draws the level (M) and the mask, twice, with their BCH bits; and the dark module beside them.
func (c *Code) formatBits(mask int) {
	data := 0<<3 | mask // level M is 00
	rem := data
	for range 10 {
		rem = rem<<1 ^ (rem>>9)*0x537
	}
	bits := (data<<10 | rem) ^ 0x5412
	bit := func(i int) bool { return bits>>i&1 == 1 }
	n := c.Size
	for i := 0; i <= 5; i++ {
		c.set(8, i, bit(i))
	}
	c.set(8, 7, bit(6))
	c.set(8, 8, bit(7))
	c.set(7, 8, bit(8))
	for i := 9; i < 15; i++ {
		c.set(14-i, 8, bit(i))
	}
	for i := range 8 {
		c.set(n-1-i, 8, bit(i))
	}
	for i := 8; i < 15; i++ {
		c.set(8, n-15+i, bit(i))
	}
	c.set(8, n-8, true)
}

// codewords are the text in byte mode, padded to the version's data codewords, split into blocks with each block's
// error correction, interleaved.
func codewords(version int, data []byte) []byte {
	var bits []bool
	put := func(v, n int) {
		for i := n - 1; i >= 0; i-- {
			bits = append(bits, v>>i&1 == 1)
		}
	}
	put(0b0100, 4)
	put(len(data), 8)
	for _, b := range data {
		put(int(b), 8)
	}
	capacity := 8 * dataCodewords(version)
	put(0, min(4, capacity-len(bits)))
	put(0, (8-len(bits)%8)%8)
	for pad := 0xEC; len(bits) < capacity; pad ^= 0xEC ^ 0x11 {
		put(pad, 8)
	}
	all := make([]byte, len(bits)/8)
	for i, b := range bits {
		if b {
			all[i/8] |= 0x80 >> (i % 8)
		}
	}
	divisor := rsDivisor(eccPerBlock[version])
	var datas, eccs [][]byte
	for _, g := range blocks[version] {
		for range g[0] {
			d := all[:g[1]]
			all = all[g[1]:]
			datas = append(datas, d)
			eccs = append(eccs, rsRemainder(d, divisor))
		}
	}
	var out []byte
	for i := 0; i < len(datas[len(datas)-1]); i++ {
		for _, d := range datas {
			if i < len(d) {
				out = append(out, d[i])
			}
		}
	}
	for i := range eccPerBlock[version] {
		for _, e := range eccs {
			out = append(out, e[i])
		}
	}
	return out
}

// place lays the codewords' bits in the zigzag: two columns at a time from the right, up then down, round the
// function patterns (and never in the timing column).
func (c *Code) place(data []byte) {
	n, i := c.Size, 0
	for right := n - 1; right >= 1; right -= 2 {
		if right == 6 {
			right = 5
		}
		for vert := range n {
			for j := range 2 {
				x := right - j
				y := vert
				if (right+1)&2 == 0 {
					y = n - 1 - vert
				}
				if !c.fixed[y][x] && i < len(data)*8 {
					c.modules[y][x] = data[i/8]>>(7-i%8)&1 == 1
					i++
				}
			}
		}
	}
}

// applyMask flips the data modules where the mask says (twice is undone).
func (c *Code) applyMask(mask int) {
	for y := range c.Size {
		for x := range c.Size {
			var flip bool
			switch mask {
			case 0:
				flip = (x+y)%2 == 0
			case 1:
				flip = y%2 == 0
			case 2:
				flip = x%3 == 0
			case 3:
				flip = (x+y)%3 == 0
			case 4:
				flip = (x/3+y/2)%2 == 0
			case 5:
				flip = x*y%2+x*y%3 == 0
			case 6:
				flip = (x*y%2+x*y%3)%2 == 0
			default:
				flip = ((x+y)%2+x*y%3)%2 == 0
			}
			if flip && !c.fixed[y][x] {
				c.modules[y][x] = !c.modules[y][x]
			}
		}
	}
}

// penalty scores the code as the standard does, to choose a mask: runs of five or more of a colour in a row or a
// column, 2×2 blocks of a colour, patterns that look like a finder's, and dark modules far from half.
func (c *Code) penalty() int {
	n, score, dark := c.Size, 0, 0
	at := func(x, y int, across bool) bool {
		if across {
			return c.modules[y][x]
		}
		return c.modules[x][y]
	}
	finder := []bool{true, false, true, true, true, false, true}
	for _, across := range []bool{true, false} {
		for y := range n {
			run := 1
			for x := 1; x <= n; x++ {
				if x < n && at(x, y, across) == at(x-1, y, across) {
					run++
					continue
				}
				if run >= 5 {
					score += 3 + run - 5
				}
				run = 1
			}
			// 1:1:3:1:1 with four light modules on a side (the edge counts as light).
			for x := 0; x+7 <= n; x++ {
				match := true
				for k, d := range finder {
					if at(x+k, y, across) != d {
						match = false
						break
					}
				}
				if match && (light(at, x-4, x, y, across, n) || light(at, x+7, x+11, y, across, n)) {
					score += 40
				}
			}
		}
	}
	for y := range n {
		for x := range n {
			if c.modules[y][x] {
				dark++
			}
			if x+1 < n && y+1 < n {
				v := c.modules[y][x]
				if c.modules[y][x+1] == v && c.modules[y+1][x] == v && c.modules[y+1][x+1] == v {
					score += 3
				}
			}
		}
	}
	percent := dark * 100 / (n * n)
	return score + 10*(abs(percent-50)/5)
}

// light is whether the modules from a to b (not b) of a line are light, past the edge too.
func light(at func(x, y int, across bool) bool, a, b, y int, across bool, n int) bool {
	for x := a; x < b; x++ {
		if x >= 0 && x < n && at(x, y, across) {
			return false
		}
	}
	return true
}

// SVG draws the code, with a quiet zone of four modules around it, dark on white whatever the page's colours.
func (c *Code) SVG() string {
	const quiet = 4
	w := c.Size + 2*quiet
	var path strings.Builder
	for y := range c.Size {
		for x := 0; x < c.Size; {
			if !c.modules[y][x] {
				x++
				continue
			}
			run := 0
			for x+run < c.Size && c.modules[y][x+run] {
				run++
			}
			fmt.Fprintf(&path, "M%d %dh%dv1h-%dz", x+quiet, y+quiet, run, run)
			x += run
		}
	}
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">`+
		`<rect width="%d" height="%d" fill="#fff"/><path d="%s" fill="#000"/></svg>`, w, w, w, w, path.String())
}

// rsDivisor is the Reed–Solomon generator polynomial of a degree, over GF(2⁸) (its leading 1 left out).
func rsDivisor(degree int) []byte {
	out := make([]byte, degree)
	out[degree-1] = 1
	root := byte(1)
	for range degree {
		for j := range out {
			out[j] = mul(out[j], root)
			if j+1 < len(out) {
				out[j] ^= out[j+1]
			}
		}
		root = mul(root, 2)
	}
	return out
}

// rsRemainder is a block's error correction: its data divided by the generator.
func rsRemainder(data, divisor []byte) []byte {
	out := make([]byte, len(divisor))
	for _, b := range data {
		factor := b ^ out[0]
		copy(out, out[1:])
		out[len(out)-1] = 0
		for i := range out {
			out[i] ^= mul(divisor[i], factor)
		}
	}
	return out
}

// mul multiplies in GF(2⁸), modulo x⁸ + x⁴ + x³ + x² + 1.
func mul(x, y byte) byte {
	z := 0
	for i := 7; i >= 0; i-- {
		z = z<<1 ^ (z>>7)*0x11D
		z ^= int(y>>i&1) * int(x)
	}
	return byte(z)
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
