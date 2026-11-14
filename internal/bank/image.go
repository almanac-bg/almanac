package bank

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Image is a picture over the question (a flag, a landmark, a painting), with its licence: free licences only. The file
// is in images/ next to the questions, its longer side up to ImageSide, with a half-size copy beside it (<name>-600.webp).
// Its name is a hash of its content, so it says nothing about the answer.
type Image struct {
	File string `json:"file"`
	W    int    `json:"w"`
	H    int    `json:"h"`
	// Alt is what's in it, for screen readers, without giving the answer away.
	Alt string `json:"alt"`
	// Credit is whose it is (an author's name, or „неизвестен автор“).
	Credit string `json:"credit"`
	// License is PD, CC0, CC BY or CC BY-SA, with its version for the CC ones.
	License        string `json:"license"`
	LicenseVersion string `json:"licenseVersion,omitempty"`
	// Source is the page the picture comes from.
	Source string `json:"source"`
}

const (
	// ImageSide is a picture's longer side at most (a smaller original keeps its size); the small copy has half of it.
	ImageSide    = 1200
	ImageMinSide = 600
	// ImageMaxBytes is the most one file may weigh.
	ImageMaxBytes = 150_000
	// ImagePath is the URL path the pictures are served under (cached for good: a file's name changes with its content).
	ImagePath = "/qimg/"
)

var (
	imageFile      = regexp.MustCompile(`^[0-9a-f]{16}\.webp$`)
	licenseVersion = regexp.MustCompile(`^[1-4]\.[05]$`)
	licenses       = map[string]bool{"PD": true, "CC0": true, "CC BY": true, "CC BY-SA": true}
)

func (im *Image) file() string {
	if im == nil {
		return ""
	}
	return im.File
}

// Small is the half-size copy's file name.
func (im *Image) Small() string { return strings.TrimSuffix(im.File, ".webp") + "-600.webp" }

// ImageView is a picture as a player gets it: both sizes to pick from, its shape, and what it shows.
type ImageView struct {
	Src    string `json:"src"`
	SrcSet string `json:"srcset"`
	W      int    `json:"w"`
	H      int    `json:"h"`
	Alt    string `json:"alt"`
}

func (im *Image) view() *ImageView {
	if im == nil {
		return nil
	}
	small := ImagePath + im.Small()
	return &ImageView{
		Src:    small,
		SrcSet: fmt.Sprintf("%s %dw, %s%s %dw", small, im.W/2, ImagePath, im.File, im.W),
		W:      im.W,
		H:      im.H,
		Alt:    im.Alt,
	}
}

// ImageCredit is whose a picture is and on what licence, shown with the answer (a painter's name before it would give
// a painting away).
type ImageCredit struct {
	Credit     string `json:"credit"`
	License    string `json:"license"`
	LicenseURL string `json:"licenseUrl,omitempty"`
	Source     string `json:"source"`
}

func (im *Image) credit() *ImageCredit {
	if im == nil {
		return nil
	}
	c := &ImageCredit{Credit: im.Credit, License: im.License, Source: im.Source}
	if im.LicenseVersion != "" {
		c.License += " " + im.LicenseVersion
	}
	// The deed in Bulgarian (Creative Commons falls back to English where it has none).
	switch im.License {
	case "CC0":
		c.LicenseURL = "https://creativecommons.org/publicdomain/zero/" + im.LicenseVersion + "/deed.bg"
	case "CC BY":
		c.LicenseURL = "https://creativecommons.org/licenses/by/" + im.LicenseVersion + "/deed.bg"
	case "CC BY-SA":
		c.LicenseURL = "https://creativecommons.org/licenses/by-sa/" + im.LicenseVersion + "/deed.bg"
	}
	return c
}

func (im *Image) check() []string {
	var p []string
	if !imageFile.MatchString(im.File) {
		p = append(p, "image.file must be a 16-hex-digit name ending in .webp")
	}
	if im.W <= 0 || im.H <= 0 {
		p = append(p, "image.w and image.h must be above 0")
	} else if side := max(im.W, im.H); side < ImageMinSide || side > ImageSide {
		p = append(p, fmt.Sprintf("the picture's longer side must be %d–%d", ImageMinSide, ImageSide))
	}
	p = append(p, checkLength("image.alt", im.Alt, 3, 150)...)
	p = append(p, checkLetters("image.alt", im.Alt)...)
	p = append(p, checkLength("image.credit", im.Credit, 1, 120)...)
	if !licenses[im.License] {
		p = append(p, "image.license must be PD, CC0, CC BY or CC BY-SA")
	}
	switch {
	case im.License == "PD" && im.LicenseVersion != "":
		p = append(p, "a public-domain picture has no licence version")
	case im.License != "PD" && !licenseVersion.MatchString(im.LicenseVersion):
		p = append(p, "image.licenseVersion must be like 4.0")
	}
	p = append(p, checkURL("image.source", im.Source)...)
	return p
}

// checkFiles finds what's wrong with the picture's files in dir: both sizes there, light enough, and the shape the
// question says.
func (im *Image) checkFiles(dir string) []string {
	var p []string
	for _, f := range []struct {
		name string
		w, h int
	}{{im.File, im.W, im.H}, {im.Small(), im.W / 2, im.H / 2}} {
		path := filepath.Join(dir, f.name)
		info, err := os.Stat(path)
		if err != nil {
			p = append(p, "missing picture "+f.name)
			continue
		}
		if info.Size() > ImageMaxBytes {
			p = append(p, fmt.Sprintf("%s weighs %d bytes, over %d", f.name, info.Size(), ImageMaxBytes))
		}
		w, h, err := webpSize(path)
		switch {
		case err != nil:
			p = append(p, fmt.Sprintf("%s: %v", f.name, err))
		case abs(w-f.w) > 1 || abs(h-f.h) > 1:
			p = append(p, fmt.Sprintf("%s is %d×%d, not %d×%d", f.name, w, h, f.w, f.h))
		}
	}
	return p
}

func abs(n int) int { return max(n, -n) }

// webpSize reads a WebP file's width and height from its header (lossy VP8, lossless VP8L or extended VP8X).
func webpSize(path string) (w, h int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	var b [30]byte
	if _, err := io.ReadFull(f, b[:]); err != nil {
		return 0, 0, errors.New("not a WebP file")
	}
	if string(b[0:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		return 0, 0, errors.New("not a WebP file")
	}
	switch string(b[12:16]) {
	case "VP8 ":
		if b[23] != 0x9d || b[24] != 0x01 || b[25] != 0x2a {
			return 0, 0, errors.New("a broken VP8 header")
		}
		return int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff), int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff), nil
	case "VP8L":
		if b[20] != 0x2f {
			return 0, 0, errors.New("a broken VP8L header")
		}
		bits := binary.LittleEndian.Uint32(b[21:25])
		return int(bits&0x3fff) + 1, int(bits>>14&0x3fff) + 1, nil
	case "VP8X":
		w := int(b[24]) | int(b[25])<<8 | int(b[26])<<16
		h := int(b[27]) | int(b[28])<<8 | int(b[29])<<16
		return w + 1, h + 1, nil
	}
	return 0, 0, errors.New("an unknown WebP format")
}

// picturesOf is every picture a question shows: the one over it, and its options' (a choice of pictures).
func picturesOf(q Question) []*Image {
	var out []*Image
	if im := q.Extra().Image; im != nil {
		out = append(out, im)
	}
	if c, ok := q.(*Choice); ok {
		out = append(out, c.pictures()...)
	}
	return out
}

// HasPictures says whether a question shows a picture: over it, or as its options.
func HasPictures(q Question) bool { return len(picturesOf(q)) > 0 }
