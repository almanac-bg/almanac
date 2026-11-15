package qr

import (
	"errors"
	"slices"
	"strings"
	"testing"
)

// read decodes a code the way a reader does, without correcting anything: the format bits (checked), the mask taken
// off, the bits read back along the zigzag, the blocks taken apart (each one's error correction checked), and the
// text in byte mode.
func read(t *testing.T, c *Code) string {
	t.Helper()
	format := 0
	at := func(x, y int) int {
		if c.Dark(x, y) {
			return 1
		}
		return 0
	}
	for i := 0; i <= 5; i++ {
		format |= at(8, i) << i
	}
	format |= at(8, 7)<<6 | at(8, 8)<<7 | at(7, 8)<<8
	for i := 9; i < 15; i++ {
		format |= at(14-i, 8) << i
	}
	format ^= 0x5412
	if level, mask := format>>13, format>>10&7; level != 0 || mask != c.Mask {
		t.Fatalf("format: level %d, mask %d (the code's %d)", level, mask, c.Mask)
	}
	rem := format >> 10
	for range 10 {
		rem = rem<<1 ^ (rem>>9)*0x537
	}
	if rem&0x3FF != format&0x3FF {
		t.Fatal("format bits: their BCH doesn't check")
	}
	second := 0
	for i := range 8 {
		second |= at(c.Size-1-i, 8) << i
	}
	for i := 8; i < 15; i++ {
		second |= at(8, c.Size-15+i) << i
	}
	if second^0x5412 != format {
		t.Fatal("the two copies of the format bits differ")
	}

	c.applyMask(c.Mask)
	defer c.applyMask(c.Mask)
	var stream []byte
	var cur byte
	bits := 0
	n := c.Size
	for right := n - 1; right >= 1; right -= 2 {
		if right == 6 {
			right = 5
		}
		for vert := range n {
			for j := range 2 {
				x, y := right-j, vert
				if (right+1)&2 == 0 {
					y = n - 1 - vert
				}
				if c.fixed[y][x] {
					continue
				}
				cur = cur<<1 | byte(at(x, y))
				if bits++; bits%8 == 0 {
					stream = append(stream, cur)
					cur = 0
				}
			}
		}
	}
	// Taken apart: the data codewords round the blocks, then the error correction.
	var datas [][]byte
	for _, g := range blocks[c.Version] {
		for range g[0] {
			datas = append(datas, make([]byte, g[1]))
		}
	}
	k := 0
	for i := 0; i < len(datas[len(datas)-1]); i++ {
		for _, d := range datas {
			if i < len(d) {
				d[i] = stream[k]
				k++
			}
		}
	}
	ecc := eccPerBlock[c.Version]
	divisor := rsDivisor(ecc)
	for b, d := range datas {
		var got []byte
		for i := range ecc {
			got = append(got, stream[k+i*len(datas)+b])
		}
		if !slices.Equal(got, rsRemainder(d, divisor)) {
			t.Fatalf("block %d: its error correction doesn't check", b)
		}
	}
	all := slices.Concat(datas...)
	bit := func(i int) int { return int(all[i/8] >> (7 - i%8) & 1) }
	num := func(from, n int) int {
		v := 0
		for i := range n {
			v = v<<1 | bit(from+i)
		}
		return v
	}
	if mode := num(0, 4); mode != 0b0100 {
		t.Fatalf("mode %04b", mode)
	}
	length := num(4, 8)
	out := make([]byte, length)
	for i := range out {
		out[i] = byte(num(12+8*i, 8))
	}
	return string(out)
}

func TestCodesRead(t *testing.T) {
	for _, text := range []string{
		"https://almanac.bg/r/123456",
		"http://127.0.0.1:8080/r/654321",
		"a",
		strings.Repeat("x", 14),  // the most version 1 holds
		strings.Repeat("y", 15),  // version 2
		strings.Repeat("z", 100), // two kinds of block (version 6)
		strings.Repeat("w", 150), // version 8: blocks of two lengths, the version's bits
		strings.Repeat("v", 180), // the most there is
	} {
		c, err := Encode(text)
		if err != nil {
			t.Fatalf("%d bytes: %v", len(text), err)
		}
		if got := read(t, c); got != text {
			t.Fatalf("version %d read back %q, not %q", c.Version, got, text)
		}
	}
	if c, _ := Encode(strings.Repeat("x", 14)); c.Version != 1 || c.Size != 21 {
		t.Fatalf("14 bytes: version %d", c.Version)
	}
	if c, _ := Encode("https://almanac.bg/r/123456"); c.Version != 3 {
		t.Fatalf("a room's link: version %d", c.Version)
	}
	if _, err := Encode(strings.Repeat("u", 181)); !errors.Is(err, ErrTooLong) {
		t.Fatalf("181 bytes: %v", err)
	}
}

// The finders, the timing and the version bits are where a reader looks for them.
func TestPatterns(t *testing.T) {
	c, _ := Encode(strings.Repeat("w", 150))
	n := c.Size
	for _, at := range [][2]int{{0, 0}, {n - 7, 0}, {0, n - 7}} {
		for d := range 7 {
			if !c.Dark(at[0]+d, at[1]) || !c.Dark(at[0], at[1]+d) || !c.Dark(at[0]+3, at[1]+3) || c.Dark(at[0]+1, at[1]+1) {
				t.Fatalf("the finder at %v", at)
			}
		}
	}
	for i := 8; i < n-8; i++ {
		if c.Dark(i, 6) != (i%2 == 0) || c.Dark(6, i) != (i%2 == 0) {
			t.Fatalf("timing at %d", i)
		}
	}
	// Version 8's bits are 0x085BC (the standard's table D.1), read back from the block at the bottom left.
	v := 0
	for i := range 18 {
		if c.Dark(i/3, n-11+i%3) {
			v |= 1 << i
		}
	}
	if v>>12 != c.Version || v != 0x085BC {
		t.Fatalf("the version's bits: %05x", v)
	}
	if svg := c.SVG(); !strings.HasPrefix(svg, "<svg") || !strings.Contains(svg, `viewBox="0 0 57 57"`) {
		t.Fatalf("the picture: %.80s", svg)
	}
}
