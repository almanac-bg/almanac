package card

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
)

// light is the mark's petals on the ink tile: the night's ink (app.css, --petal by night).
var light = color.RGBA{0xf5, 0xf3, 0xff, 0xff}

// An Icon is one of the game's icons in web/public (the browser's, the phone's, the installed app's): one version of
// the mark, the rosette light on an ink tile with its one gold petal, as favicon.svg draws it and the bar by night.
// The files are drawn from here (`go test ./internal/card -run TestIcons -update`), and TestIcons holds them equal.
type Icon struct {
	File string
	Size int
	// Round gives the tile rounded corners on a clear ground (an icon shown as it is); without it, the ink fills
	// the square edge to edge, for a system that cuts its own shape (iOS, a maskable icon).
	Round bool
	// Span is how much of the side the rosette's petals take: less for a maskable icon, whose safe zone is the
	// middle circle of 80 %.
	Span float64
}

// Icons are the icons the game serves (server/pages.go lists the files; badge-96.png, a notification's white
// silhouette, has no colour and isn't drawn here).
var Icons = []Icon{
	{File: "icon-192.png", Size: 192, Round: true, Span: 0.625},
	{File: "icon-512.png", Size: 512, Round: true, Span: 0.625},
	{File: "icon-maskable-512.png", Size: 512, Span: 0.47},
	{File: "apple-touch-icon.png", Size: 180, Span: 0.625},
}

// Draw draws the icon as a PNG.
func (ic Icon) Draw() ([]byte, error) {
	s := float64(ic.Size)
	img := image.NewRGBA(image.Rect(0, 0, ic.Size, ic.Size))
	if ic.Round {
		box(img, 0, 0, s, s, s*15/64, ink) // favicon.svg's tile: rx 15 of 64
	} else {
		draw.Draw(img, img.Bounds(), image.NewUniform(ink), image.Point{}, draw.Src)
	}
	span := s * ic.Span
	rosette(img, (s-span)/2, (s-span)/2, span, light)
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}
