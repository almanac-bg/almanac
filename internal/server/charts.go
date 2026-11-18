package server

import (
	"fmt"
	"html/template"
	"math"
	"strings"
)

// /admin's charts: drawn here as SVG, with no script (the page has none). The plot stretches to its box
// (preserveAspectRatio none) while its lines keep their width (non-scaling-stroke) and a point stays round (a line of
// no length, round at its ends); the words around it (the legend, the scale, the first and last day) are HTML, so they
// never stretch. Each column has a hover target whose title tells its numbers; the same numbers are in a table beside.
// The colours are admin.css's (--series-1, --series-2: checked for colour blindness on both themes' surfaces); the
// second series is dashed too, so that colour is never the only difference.

// The plot's own coordinates: plotW wide, plotH high.
const plotW, plotH = 1000.0, 100.0

// series is a line of a chart: its name and a value for each of the chart's X.
type series struct {
	Name   string
	Values []float64
}

// mark is a moment marked on a chart's X: a version released.
type mark struct {
	At    int // the index of X it falls on
	Label string
}

// chart is a chart of lines over days.
type chart struct {
	Label  string
	X      []string // the days, YYYY-MM-DD
	Series []series
	Marks  []mark
}

// releaseMarks are the releases that fall on the days (YYYY-MM-DD) of a chart's X.
func releaseMarks(rs []release, days []string) []mark {
	var out []mark
	for _, r := range rs {
		for i, d := range days {
			if d == r.Day {
				out = append(out, mark{At: i, Label: r.Version + " · " + short(r.Day)})
				break
			}
		}
	}
	return out
}

// niceCeil is the round number at or above x a scale ends at: 1, 2 or 5 of a power of ten.
func niceCeil(x float64) float64 {
	if x <= 0 {
		return 1
	}
	p := math.Pow(10, math.Floor(math.Log10(x)))
	for _, m := range []float64{1, 2, 5, 10} {
		if m*p >= x {
			return m * p
		}
	}
	return 10 * p
}

// xAt is where the i-th of n points falls on the plot.
func xAt(i, n int) float64 {
	if n <= 1 {
		return plotW / 2
	}
	return float64(i) * plotW / float64(n-1)
}

// yAt is where a value falls on the plot, the scale ending at top.
func yAt(v, top float64) float64 { return plotH - v/top*plotH }

// frame draws a chart around its plot: the legend (for more than one series), the scale, the plot, and its first and
// last X. plot is what's drawn over the grid.
func frame(label string, legend []string, top float64, unit string, first, last string, plot string) template.HTML {
	var b strings.Builder
	esc := template.HTMLEscapeString
	fmt.Fprintf(&b, `<figure class="chart"><figcaption>%s</figcaption>`, esc(label))
	if len(legend) > 1 {
		b.WriteString(`<p class="legend">`)
		for i, name := range legend {
			fmt.Fprintf(&b, `<span><i class="swatch s%d"></i>%s</span>`, i+1, esc(name))
		}
		b.WriteString(`</p>`)
	}
	num := func(v float64) string {
		if v == math.Trunc(v) {
			return fmt.Sprintf("%.0f%s", v, unit)
		}
		return decimal(v) + unit
	}
	fmt.Fprintf(&b, `<div class="plot"><div class="scale" aria-hidden="true"><span>%s</span><span>%s</span><span>0</span></div>`,
		num(top), num(top/2))
	fmt.Fprintf(&b, `<svg viewBox="0 0 %.0f %.0f" preserveAspectRatio="none" role="img" aria-label="%s">`, plotW, plotH, esc(label))
	for _, y := range []float64{0, plotH / 2, plotH} {
		fmt.Fprintf(&b, `<line class="grid" x1="0" x2="%.0f" y1="%.1f" y2="%.1f" vector-effect="non-scaling-stroke"/>`, plotW, y, y)
	}
	b.WriteString(plot)
	fmt.Fprintf(&b, `</svg><p class="ends" aria-hidden="true"><span>%s</span><span>%s</span></p></div></figure>`, esc(first), esc(last))
	return template.HTML(b.String())
}

// hovers are the plot's hover targets, a column for each of n points, each titled.
func hovers(n int, title func(i int) string) string {
	var b strings.Builder
	w := plotW / float64(max(n, 1))
	if n > 1 {
		w = plotW / float64(n-1)
	}
	for i := range n {
		x := xAt(i, n) - w/2
		fmt.Fprintf(&b, `<rect class="hover" x="%.1f" y="0" width="%.1f" height="%.0f"><title>%s</title></rect>`,
			x, w, plotH, template.HTMLEscapeString(title(i)))
	}
	return b.String()
}

// marksOf draws the marks as ticks up from the plot's foot, each titled.
func marksOf(ms []mark, n, every int) string {
	var b strings.Builder
	for _, m := range ms {
		x := xAt(m.At, n)
		if every > 1 { // a mark on one of `every` days a point stands for
			x = xAt(m.At/every, n/every)
		}
		fmt.Fprintf(&b, `<line class="release" x1="%.1f" x2="%.1f" y1="%.0f" y2="%.0f" vector-effect="non-scaling-stroke"><title>%s</title></line>`,
			x, x, plotH, plotH-12, template.HTMLEscapeString(m.Label))
	}
	return b.String()
}

// lineChart draws lines over days.
func lineChart(c chart) template.HTML {
	n := len(c.X)
	top := 0.0
	for _, s := range c.Series {
		for _, v := range s.Values {
			top = max(top, v)
		}
	}
	top = niceCeil(top)
	var plot strings.Builder
	plot.WriteString(marksOf(c.Marks, n, 1))
	var legend []string
	for k, s := range c.Series {
		legend = append(legend, s.Name)
		var d strings.Builder
		for i, v := range s.Values {
			fmt.Fprintf(&d, "%s%.1f %.2f", map[bool]string{true: "M", false: " L"}[i == 0], xAt(i, n), yAt(v, top))
		}
		fmt.Fprintf(&plot, `<path class="line s%d" d="%s" vector-effect="non-scaling-stroke"/>`, k+1, d.String())
	}
	plot.WriteString(hovers(n, func(i int) string {
		parts := []string{short(c.X[i])}
		for _, s := range c.Series {
			parts = append(parts, fmt.Sprintf("%s: %.0f", s.Name, s.Values[i]))
		}
		return strings.Join(parts, " · ")
	}))
	first, last := "", ""
	if n > 0 {
		first, last = short(c.X[0]), short(c.X[n-1])
	}
	return frame(c.Label, legend, top, "", first, last, plot.String())
}

// rateChartSpec is a chart of shares, each with its interval: a line through the points, the band of their
// intervals behind it. Marks fall on X's days, `MarkEvery` of them to a point (a week's, say).
type rateChartSpec struct {
	Label       string
	X           []string
	Rates       []rate
	First, Last string
	Marks       []mark
	MarkEvery   int
}

// rateChart draws shares with their intervals. A point with too little data to tell (fewer) is drawn hollow-faint.
func rateChart(c rateChartSpec) template.HTML {
	n := len(c.X)
	top := 10.0
	for _, r := range c.Rates {
		if r.Of > 0 {
			_, hi := r.interval()
			top = max(top, float64(hi))
		}
	}
	top = min(niceCeil(top), 100)
	var plot strings.Builder
	plot.WriteString(marksOf(c.Marks, n*max(c.MarkEvery, 1), max(c.MarkEvery, 1)))
	// The band of the intervals: up along the highs, back along the lows.
	var up, down []string
	for i, r := range c.Rates {
		if r.Of == 0 {
			continue
		}
		lo, hi := r.interval()
		up = append(up, fmt.Sprintf("%.1f %.2f", xAt(i, n), yAt(float64(hi), top)))
		down = append([]string{fmt.Sprintf("%.1f %.2f", xAt(i, n), yAt(float64(lo), top))}, down...)
	}
	if len(up) > 1 {
		fmt.Fprintf(&plot, `<path class="band" d="M%s L%sZ"/>`, strings.Join(up, " L"), strings.Join(down, " L"))
	}
	var d []string
	for i, r := range c.Rates {
		if r.Of > 0 {
			d = append(d, fmt.Sprintf("%.1f %.2f", xAt(i, n), yAt(float64(r.share()), top)))
		}
	}
	if len(d) > 1 {
		fmt.Fprintf(&plot, `<path class="line s1" d="M%s" vector-effect="non-scaling-stroke"/>`, strings.Join(d, " L"))
	}
	for i, r := range c.Rates {
		if r.Of == 0 {
			continue
		}
		class := "point s1"
		if r.Of < fewer {
			class += " few"
		}
		x, y := xAt(i, n), yAt(float64(r.share()), top)
		fmt.Fprintf(&plot, `<path class="%s" d="M%.1f %.2fh0" vector-effect="non-scaling-stroke"/>`, class, x, y)
	}
	plot.WriteString(hovers(n, func(i int) string {
		r := c.Rates[i]
		if r.Of == 0 {
			return c.X[i] + ": няма данни"
		}
		lo, hi := r.interval()
		return fmt.Sprintf("%s: %d%% (%d–%d), %d от %d", c.X[i], r.share(), lo, hi, r.N, r.Of)
	}))
	return frame(c.Label, nil, top, "%", c.First, c.Last, plot.String())
}
