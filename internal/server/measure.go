package server

import (
	"cmp"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// What the server counts for the admin page (play/measure.go): visits without a profile by where they landed, the
// guests made and where they came from, what the client tells (/api/tally: the day shared, the reminder's ask
// answered, a notification opened), and the versions served (releases). And how /admin reads it all (measures): one
// population, people (play.People), each share with its interval, so that a difference within the noise isn't taken
// for a change.

// landing is where a visit landed (one of play.Landings), by its path, or the game's app.
func landing(path string, app bool) string {
	switch {
	case app:
		return "app"
	case path == "/":
		return "home"
	case strings.HasPrefix(path, "/s/"):
		return "share"
	case strings.HasPrefix(path, "/f/"):
		return "invite"
	case strings.HasPrefix(path, "/r/"), path == "/room":
		return "room"
	case strings.HasPrefix(path, "/players/"):
		return "player"
	}
	return "other"
}

// inApp says whether a request comes from the game's app (mobile/capacitor.config.json adds this to its user agent).
func inApp(r *http.Request) bool { return strings.Contains(r.UserAgent(), "AlmanacApp") }

// robot matches the user agents of programs that fetch a page without a person: search engines, link previews
// (Viber, Messenger, WhatsApp, Telegram), headless browsers. A person's browser says "Mozilla/" first; these don't, or
// say what they are.
var robot = regexp.MustCompile(`(?i)bot|crawl|spider|slurp|preview|externalhit|externalagent|headless|lighthouse`)

// visitsHome is how many visits one home (clientHome) counts in visitEvery: a carrier's address many phones share
// counts each, and one site can't make a flood of keys.
const (
	visitsHome = 300
	visitEvery = 30 * time.Minute
)

// countVisit counts a page loaded by a person without a profile, by where it landed: once a visitEvery for each
// landing, from each browser (its user agent) at each home (clientHome), so that reloads and a page's own navigation
// don't count again, while the phones behind one carrier's address do, each. What tells them apart is kept in
// memory for the half hour, never stored.
func (s *Server) countVisit(r *http.Request) {
	if _, err := r.Cookie(s.cookie); err == nil || r.Method != http.MethodGet || r.Header.Get("Sec-Purpose") != "" {
		return
	}
	ua := r.UserAgent()
	if !strings.HasPrefix(ua, "Mozilla/") || robot.MatchString(ua) {
		return
	}
	where, home := landing(r.URL.Path, inApp(r)), s.clientHome(r)
	browser := sha256.Sum256([]byte(ua))
	if !s.limits.allow("visits:"+home, visitsHome, visitEvery) ||
		!s.limits.allow("visit:"+where+":"+home+":"+hex.EncodeToString(browser[:6]), 1, visitEvery) {
		return
	}
	_ = s.game.Tally(r.Context(), "visit:"+where, 1)
}

// cameFrom keeps where a new guest came in (users.came_from): the path the client was first opened at, or the app.
func (s *Server) cameFrom(ctx context.Context, userID int64, path string, app bool) error {
	if (path == "" || path[0] != '/' || len(path) > 200) && !app {
		return nil
	}
	where := landing(path, app)
	if _, err := s.db.Write.ExecContext(ctx, `UPDATE users SET came_from = ? WHERE id = ?`, where, userID); err != nil {
		return err
	}
	return s.game.Tally(ctx, "guest:"+where, 1)
}

// released keeps when this version first served (releases): the marks on /admin's charts.
func (s *Server) released(ctx context.Context) error {
	_, err := s.db.Write.ExecContext(ctx, `INSERT OR IGNORE INTO releases (version, at) VALUES (?, ?)`,
		s.game.Version, time.Now().UnixMilli())
	return err
}

// clientTallies are what the client counts (play/measure.go): the day shared, the reminder's ask on Начало (shown,
// yes, no; by notification, or by mail where none can come), a notification opened, by kind, a broken streak's repair
// offered (play/repair.go).
var clientTallies = map[string]bool{
	"share:day": true, "share:challenge": true, "pushask:shown": true, "pushask:yes": true, "pushask:no": true,
	"mailask:shown": true, "mailask:yes": true, "mailask:no": true,
	"repair:offered": true,
}

func init() {
	for k := range pushKinds {
		clientTallies["push:open:"+string(k)] = true
	}
	clientTallies["push:open:"+pushAsked.name()] = true
	clientTallies["push:open:stop"] = true // the day's last reminder (remind.go)
}

// tally counts one of what the client counts. Anyone may (a notification is opened before the page knows who's
// playing), a few times a minute. The day shared counts only from a player who finished it today, as /admin counts
// the days finished (play.People): its share of them is the game's growth number. The client counts it once a day a
// device; nothing here tells whose it was.
func (s *Server) tally(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Key string `json:"key"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !clientTallies[in.Key] {
		return errBadRequest
	}
	if !s.allowFrom(r, "tally", 30, 150, time.Hour) {
		return errTooMany
	}
	if in.Key == "share:day" {
		finished := false
		if u, err := s.user(r); err == nil && u != nil {
			_ = s.db.Read.QueryRowContext(r.Context(), `SELECT EXISTS (SELECT 1 FROM runs WHERE user_id = ? AND kind = 'day'
				AND day = ? AND finished_at IS NOT NULL AND `+play.People+`)`, u.ID, s.game.Today()).Scan(&finished)
		}
		if !finished {
			return ok(w, map[string]bool{"ok": true})
		}
	}
	if err := s.game.Tally(r.Context(), in.Key, 1); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// fewer is the count below which a share is told as little data: its interval is wider than most changes.
const fewer = 20

// rate is n of so many, told as a share with its 90 % interval (Wilson's): „42%“ over „12/30 · 31–54“; "—" while there
// are none to tell of. Under fewer, it's greyed: little data.
type rate struct{ N, Of int }

// share is the rate in percent, rounded.
func (r rate) share() int { return int(math.Round(100 * float64(r.N) / float64(r.Of))) }

// interval is the rate's 90 % interval, in whole percent.
func (r rate) interval() (lo, hi int) {
	const z = 1.645
	n, p := float64(r.Of), float64(r.N)/float64(r.Of)
	mid, half := p+z*z/(2*n), z*math.Sqrt(p*(1-p)/n+z*z/(4*n*n))
	d := 1 + z*z/n
	return max(0, int(math.Round(100*(mid-half)/d))), min(100, int(math.Round(100*(mid+half)/d)))
}

func (r rate) String() string {
	if r.Of == 0 {
		return "—"
	}
	lo, hi := r.interval()
	return fmt.Sprintf("%d%% (%d–%d)", r.share(), lo, hi)
}

// HTML is the rate as a cell of /admin shows it.
func (r rate) HTML() template.HTML {
	if r.Of == 0 {
		return `<span class="rate none">—</span>`
	}
	lo, hi := r.interval()
	class, title := "rate", fmt.Sprintf("%d от %d; 90%%: от %d до %d%%", r.N, r.Of, lo, hi)
	if r.Of < fewer {
		class, title = "rate few", title+"; малко данни"
	}
	return template.HTML(fmt.Sprintf(`<span class="%s" title="%s">%d%%<small>%d/%d · %d–%d</small></span>`,
		class, title, r.share(), r.N, r.Of, lo, hi))
}

// capped is the rate no more than all: a step of the funnel whose players came in earlier than its week's.
func (r rate) capped() rate {
	r.N = min(r.N, r.Of)
	return r
}

// add is two rates together.
func (r rate) add(o rate) rate { return rate{r.N + o.N, r.Of + o.Of} }

// ratio is a ratio with a decimal comma, as Bulgarian writes it: "0,4"; "—" for nothing to divide by.
func ratio(n, of int) string {
	if of == 0 {
		return "—"
	}
	return decimal(float64(n) / float64(of))
}

// decimal is a number with one decimal, with a comma.
func decimal(x float64) string { return strings.Replace(fmt.Sprintf("%.1f", x), ".", ",", 1) }

// landingNames are the landings as the admin page says them.
var landingNames = map[string]string{
	"home": "Началната страница", "share": "Споделен ден", "invite": "Покана", "room": "Стая",
	"player": "Профил на играч", "app": "Приложението", "other": "Друга страница", "": "Не се знае",
}

// kindNames are the kinds of games, as the admin page says them; kindOrder, the order it tells them in (a kind not
// here comes after, by its own name).
var (
	kindNames = map[string]string{
		"day": "Денят", "topic": "Тема", "duel": "Дуел", "challenge": "Предизвикателство", "royal": "Роял",
		"mistakes": "Грешки", "room": "Стая",
	}
	kindOrder = []string{"day", "topic", "duel", "challenge", "royal", "mistakes", "room"}
)

// kindName is a kind of game as the admin page says it.
func kindName(k string) string { return cmp.Or(kindNames[k], k) }

// kindsOf are the kinds a map has, in kindOrder, then the rest by name.
func kindsOf[V any](m map[string]V) []string {
	return slices.SortedFunc(func(yield func(string) bool) {
		for k := range m {
			if !yield(k) {
				return
			}
		}
	}, func(a, b string) int {
		i, j := slices.Index(kindOrder, a), slices.Index(kindOrder, b)
		if i < 0 {
			i = len(kindOrder)
		}
		if j < 0 {
			j = len(kindOrder)
		}
		return cmp.Or(cmp.Compare(i, j), strings.Compare(a, b))
	})
}

// deviceNames are the devices (play.Devices) as the admin page says them.
var deviceNames = map[string]string{
	"phone": "Телефон", "tablet": "Таблет", "desktop": "Компютър", "app-ios": "Приложение, iPhone",
	"app-android": "Приложение, Android", "": "Не се знае",
}

// pushNames are the kinds of notifications as they're counted (pushKind.name; "stop": the day's last reminder), and as
// the admin page says them.
var pushNames = []struct{ kind, name string }{
	{"day", "Въпросите на деня"}, {"stop", "Спираме напомнянията"}, {"friends", "Приятели и игри"}, {"royal", "Роял"},
	{"asked", "Роял, поискан"},
}

// FunnelWeeks and SplitWeeks are how many weeks of first days the admin page tells: the funnel's, week by week; the
// cohorts' and the splits' (enough for the 5th week). ChartDays is how many days its chart of players shows, and
// CurveWeeks how many weeks after the first its curve of coming back.
const (
	FunnelWeeks = 6
	SplitWeeks  = 12
	ChartDays   = 90
	CurveWeeks  = 10
	GrowthWeeks = 8
)

// cohortMeasure is a measure of a week's newcomers: whether each came back on the days from From to To after their
// first (or did what `hit` says), counted once day To is over; of those `of` says (all, when nil).
type cohortMeasure struct {
	key      string // as cohort_weeks keeps it
	from, to int
	hit      func(play.Newcomer) bool
	of       func(play.Newcomer) bool
}

// cohortMeasures are the columns of /admin's cohorts: the first day after, the first week, the 2nd and the 5th (a day
// missed in a week isn't a player gone), and of those who finished the day's ten on their first, who did again.
var cohortMeasures = []cohortMeasure{
	{key: "d1", from: 1, to: 1},
	{key: "w1", from: 1, to: 7},
	{key: "w2", from: 7, to: 13},
	{key: "w5", from: 28, to: 34},
	{key: "day", to: 7, hit: play.Newcomer.DayTenAgain, of: func(n play.Newcomer) bool { return n.DayTen[0] }},
}

// cohortHeads are the cohorts' columns as the admin page heads them.
var cohortHeads = []string{"След 1 ден", "1–7", "2-ра седмица", "5-а седмица", "Денят пак (1–7)"}

// weekCohort is a group of newcomers and its measures (cohortMeasures).
type weekCohort struct {
	Name   string
	Monday string // a week's (cohort_weeks), or "" for a group of another kind
	New    int
	Rates  []rate
	Frozen bool // a week's numbers kept as they were once over
}

// cohortOf measures a group of newcomers, live.
func cohortOf(name string, of []play.Newcomer) weekCohort {
	c := weekCohort{Name: name, New: len(of), Rates: make([]rate, len(cohortMeasures))}
	for _, n := range of {
		for i, m := range cohortMeasures {
			if !n.Due(m.to) || m.of != nil && !m.of(n) {
				continue
			}
			c.Rates[i].Of++
			if m.hit != nil && m.hit(n) || m.hit == nil && n.BackWithin(m.from, m.to) {
				c.Rates[i].N++
			}
		}
	}
	return c
}

// cohortWeeksDue are the measures of a week's newcomers that are over for all of them (its Sunday's day `to` is),
// as of today; "new" with the first.
func cohortWeeksDue(monday, today string) []string {
	var keys []string
	sunday := play.DayShift(monday, 6)
	for _, m := range cohortMeasures {
		if play.DayShift(sunday, m.to) < today {
			keys = append(keys, m.key)
		}
	}
	if len(keys) > 0 {
		keys = append(keys, "new")
	}
	return keys
}

// freezeWeeks keeps the weekly cohorts' numbers that are over and not kept yet (cohort_weeks), so that /admin's table
// doesn't change after the fact: every quarter of an hour, and as /admin is drawn.
func (s *Server) freezeWeeks(ctx context.Context) error {
	g := s.game
	today := g.Today()
	since := play.DayShift(play.WeekOf(today), -7*SplitWeeks)
	act, err := g.Activity(ctx, since)
	if err != nil {
		return err
	}
	news, err := g.Newcomers(ctx, act, since)
	if err != nil {
		return err
	}
	byWeek := map[string][]play.Newcomer{}
	for _, n := range news {
		if !n.RoomOnly {
			byWeek[play.WeekOf(n.First)] = append(byWeek[play.WeekOf(n.First)], n)
		}
	}
	return s.db.Tx(ctx, func(tx *sql.Tx) error {
		for w := 1; w <= SplitWeeks; w++ {
			monday := play.DayShift(play.WeekOf(today), -7*w)
			c := cohortOf("", byWeek[monday])
			for _, key := range cohortWeeksDue(monday, today) {
				r := rate{c.New, c.New}
				if i := slices.IndexFunc(cohortMeasures, func(m cohortMeasure) bool { return m.key == key }); i >= 0 {
					r = c.Rates[i]
				}
				if _, err := tx.Exec(`INSERT OR IGNORE INTO cohort_weeks (week, measure, n, total) VALUES (?, ?, ?, ?)`,
					monday, key, r.N, r.Of); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// frozenWeeks are the numbers of the weekly cohorts kept (freezeWeeks), by week and measure.
func (s *Server) frozenWeeks(ctx context.Context, since string) (map[string]map[string]rate, error) {
	rows, err := s.db.Read.QueryContext(ctx, `SELECT week, measure, n, total FROM cohort_weeks WHERE week >= ?`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[string]rate{}
	for rows.Next() {
		var week, key string
		var r rate
		if err := rows.Scan(&week, &key, &r.N, &r.Of); err != nil {
			return nil, err
		}
		if out[week] == nil {
			out[week] = map[string]rate{}
		}
		out[week][key] = r
	}
	return out, rows.Err()
}

// tile is one of the numbers at the top of /admin: what it is, its value now, and four weeks before.
type tile struct {
	Name, Value, Was, Note string
	Rate                   *rate
}

type funnelRow struct {
	Step  string
	Sub   bool
	Cells []template.HTML
}

type splitGroup struct {
	Name string
	Rows []weekCohort
}

type loopRow struct {
	Name        string
	Week, Month template.HTML
	Sub         bool // a row under the one before
}

type streakRow struct {
	Band         string
	Going, Ended int
}

type gamesRow struct {
	Day   string
	Kinds []int
	Only  rate
}

type growthRow struct {
	Week                          string
	Played, New, Kept, Back, Lost int
}

// featureRow is a part of the game over 28 days: who used it, how much, and whether the newcomers who did in their
// first week came back in the second more than those who didn't (a link, not a cause).
type featureRow struct {
	Name          string
	Players       rate
	PerPlayer     string
	Used, NotUsed rate
}

type deviceRow struct {
	Name           string
	Players, Games int
	DayFinished    rate // of the day's tens begun, finished
}

// holdoutRow is a measure of the reminders' experiment (play.HeldReminders): for those reminded (Sent) and those held
// out (Held).
type holdoutRow struct {
	Name       string
	Sent, Held rate
}

// measures is what the admin page tells of the players: the numbers at the top, the charts, the first weeks, the
// daily loop, the streaks, the games.
type measures struct {
	Tiles               []tile
	PlayersChart, Curve template.HTML
	CohortChart         template.HTML
	ChartRows           []chartRow // the players' chart as a table
	Weeks               []string   // the weeks of the funnel, newest first: their Mondays, as „10.11“
	Funnel              []funnelRow
	CohortHeads         []string
	Cohorts             []weekCohort
	Overall             weekCohort
	Splits              []splitGroup
	Growth              []growthRow
	Stick               string
	Loop, Notices       []loopRow
	Holdout             []holdoutRow
	HoldoutShare        int
	Repeats             rate
	Streaks             []streakRow
	Spent               int
	Repairs             rate
	Kinds               []string // the kinds of games played in the last 7 days, by name
	Games               []gamesRow
	Features            []featureRow
	Devices             []deviceRow
	Habit, HabitOf      int
}

// chartRow is a day of the players' chart.
type chartRow struct {
	Day                 string
	Played, DayFinished int
}

// short is a day as „10.11“.
func short(day string) string { return day[8:10] + "." + day[5:7] }

func (s *Server) measures(ctx context.Context) (measures, error) {
	f := measures{CohortHeads: cohortHeads, HoldoutShare: play.Holdout}
	g := s.game
	today := g.Today()
	yesterday := play.DayShift(today, -1)
	thisWeek := play.WeekOf(today)
	since := play.DayShift(thisWeek, -7*(SplitWeeks-1))
	from := play.DayShift(today, -max(ChartDays+28, 7*(GrowthWeeks+1)+7, dayGap(since, today)+28))
	act, err := g.Activity(ctx, from)
	if err != nil {
		return f, err
	}
	news, err := g.Newcomers(ctx, act, since)
	if err != nil {
		return f, err
	}
	var played []play.Newcomer // not only in a room on the first day: the headline's
	for _, n := range news {
		if !n.RoomOnly {
			played = append(played, n)
		}
	}
	weekOf := func(of []play.Newcomer, monday string) []play.Newcomer {
		var out []play.Newcomer
		for _, n := range of {
			if play.WeekOf(n.First) == monday {
				out = append(out, n)
			}
		}
		return out
	}
	dayTens := func(from, to string) (int, error) {
		var n int
		err := s.db.Read.QueryRowContext(ctx, `SELECT count(*) FROM runs WHERE kind = 'day' AND day BETWEEN ? AND ?
			AND finished_at IS NOT NULL AND `+play.People, from, to).Scan(&n)
		return n, err
	}

	// The cohorts, week by week of first days, kept as they were once over (freezeWeeks).
	if err := s.freezeWeeks(ctx); err != nil {
		return f, err
	}
	frozen, err := s.frozenWeeks(ctx, since)
	if err != nil {
		return f, err
	}
	f.Overall = weekCohort{Name: "Средно (различни седмици)", Rates: make([]rate, len(cohortMeasures))}
	for w := range SplitWeeks {
		monday := play.DayShift(thisWeek, -7*w)
		c := cohortOf(short(monday)+"–"+short(play.DayShift(monday, 6)), weekOf(played, monday))
		c.Monday = monday
		if kept := frozen[monday]; kept != nil {
			for i, m := range cohortMeasures {
				if r, ok := kept[m.key]; ok {
					c.Rates[i], c.Frozen = r, true
				}
			}
			if r, ok := kept["new"]; ok {
				c.New = r.N
			}
		}
		if c.New == 0 {
			continue
		}
		f.Cohorts = append(f.Cohorts, c)
		f.Overall.New += c.New
		for i := range c.Rates {
			f.Overall.Rates[i] = f.Overall.Rates[i].add(c.Rates[i])
		}
	}

	// The numbers at the top: each now, and four weeks before.
	ago := func(day string) string { return play.DayShift(day, -28) }
	var dau [2]int
	var wau [2]int
	var habit, tens [2]int
	var stick [2]string
	for i, day := range []string{today, ago(today)} {
		dau[i] = act.On(day)
		wau[i] = act.Within(play.DayShift(day, -6), day)
		end := play.DayShift(day, -1) // the habit and the days finished over the 7 days before, all over
		if habit[i], err = g.Habit(ctx, end); err != nil {
			return f, err
		}
		if tens[i], err = dayTens(play.DayShift(end, -6), end); err != nil {
			return f, err
		}
		daily, month := act.Stickiness(end)
		stick[i] = "—"
		if month > 0 {
			stick[i] = fmt.Sprintf("%d%%", int(math.Round(100*daily/float64(month))))
		}
	}
	f.Habit, f.HabitOf = habit[0], act.Within(play.DayShift(yesterday, -6), yesterday)
	f.Stick = stick[0]
	// Coming back in the first week: the last four weeks of first days whose week is over, and the four before.
	var back [2]rate
	byMonday := map[string]weekCohort{}
	for _, c := range f.Cohorts {
		byMonday[c.Monday] = c
	}
	for w, due := 0, 0; w < SplitWeeks; w++ {
		monday := play.DayShift(thisWeek, -7*w)
		if !slices.Contains(cohortWeeksDue(monday, today), "w1") {
			continue
		}
		due++
		if c, ok := byMonday[monday]; ok && due <= 8 {
			back[(due-1)/4] = back[(due-1)/4].add(c.Rates[1])
		}
	}
	num := func(n int) string { return fmt.Sprint(n) }
	f.Tiles = []tile{
		{Name: "Играли днес", Value: num(dau[0]), Was: num(dau[1]), Note: "същия ден от седмицата"},
		{Name: "Играли за 7 дни", Value: num(wau[0]), Was: num(wau[1])},
		{Name: "Навик", Value: num(habit[0]), Was: num(habit[1]), Note: "денят в поне 3 от последните 7 дни"},
		{Name: "Завършени дни за 7 дни", Value: num(tens[0]), Was: num(tens[1])},
		{Name: "Връщане в първата седмица", Value: back[0].String(), Was: back[1].String(), Rate: &back[0],
			Note: "новите от последните 4 седмици, чиято първа седмица е минала"},
		{Name: "Играят на ден от играещите за 28 дни", Value: stick[0], Was: stick[1]},
	}

	// The charts.
	tensByDay := map[string]int{}
	if rows, err := s.db.Read.QueryContext(ctx, `SELECT day, count(*) FROM runs WHERE kind = 'day' AND day >= ?
		AND finished_at IS NOT NULL AND `+play.People+` GROUP BY day`, play.DayShift(today, -ChartDays)); err == nil {
		for rows.Next() {
			var day string
			var n int
			if rows.Scan(&day, &n) == nil {
				tensByDay[day] = n
			}
		}
		rows.Close()
	}
	releases, err := s.releasesSince(ctx, play.DayShift(today, -ChartDays))
	if err != nil {
		return f, err
	}
	var days []string
	var playedSeries, tensSeries []float64
	for d := play.DayShift(today, -ChartDays+1); d <= today; d = play.DayShift(d, 1) {
		days = append(days, d)
		playedSeries = append(playedSeries, float64(act.On(d)))
		tensSeries = append(tensSeries, float64(tensByDay[d]))
		f.ChartRows = append(f.ChartRows, chartRow{Day: short(d), Played: act.On(d), DayFinished: tensByDay[d]})
	}
	slices.Reverse(f.ChartRows)
	f.PlayersChart = lineChart(chart{
		Label: "Играли на ден за 90 дни",
		X:     days,
		Series: []series{
			{Name: "Играли", Values: playedSeries},
			{Name: "Завършили деня", Values: tensSeries},
		},
		Marks: releaseMarks(releases, days),
	})
	// The curve: of the newcomers whose k-th week is over, the share who played in it.
	var curveX []string
	var curve []rate
	for k := 1; k <= CurveWeeks; k++ {
		var r rate
		for _, n := range played {
			if n.Due(7*k + 6) {
				r.Of++
				if n.BackWithin(7*k, 7*k+6) {
					r.N++
				}
			}
		}
		curveX = append(curveX, fmt.Sprintf("%d-а", k+1))
		curve = append(curve, r)
	}
	f.Curve = rateChart(rateChartSpec{Label: "Играли през седмицата след първата", X: curveX, Rates: curve,
		First: "2-ра седмица", Last: fmt.Sprintf("%d-а седмица", CurveWeeks+1)})
	// The cohorts' first weeks, oldest first.
	var cohortX, cohortDays []string
	var cohortRates []rate
	for i := len(f.Cohorts) - 1; i >= 0; i-- {
		c := f.Cohorts[i]
		cohortX = append(cohortX, short(c.Monday))
		cohortRates = append(cohortRates, c.Rates[1])
		for d := range 7 {
			cohortDays = append(cohortDays, play.DayShift(c.Monday, d))
		}
	}
	if len(cohortX) > 0 {
		f.CohortChart = rateChart(rateChartSpec{Label: "Върнали се в първата седмица, по седмицата на първия ден",
			X: cohortX, Rates: cohortRates, First: cohortX[0], Last: cohortX[len(cohortX)-1],
			Marks: releaseMarks(releases, cohortDays), MarkEvery: 7})
	}

	// The funnel, week by week of first days.
	steps := []struct {
		name    string
		day     int // the step can be told once this day after the first is over
		reached func(play.Newcomer) bool
	}{
		{"Завършили деня на 1-ия ден", 0, func(n play.Newcomer) bool { return n.DayTen[0] }},
		{"Втора игра на 1-ия ден", 0, func(n play.Newcomer) bool { return n.Games >= 2 }},
		{"Пак на 2-ия ден", 1, func(n play.Newcomer) bool { return n.Played[1] }},
		{"Денят в 3 от първите 7 дни", 6, func(n play.Newcomer) bool { return n.DayTens() >= 3 }},
		{"Пак през 2-ра седмица", 13, func(n play.Newcomer) bool { return n.BackWithin(7, 13) }},
		{"Пак през 5-а седмица", 34, func(n play.Newcomer) bool { return n.BackWithin(28, 34) }},
	}
	f.Funnel = []funnelRow{{Step: "Посещения без профил"}, {Step: "Започнали игра (дял от посещенията)"},
		{Step: "Отговорили на въпрос (дял от започналите)"}, {Step: "само в стая на 1-ия ден (не са в редовете долу)", Sub: true},
		{Step: "Завършили първата си игра"}}
	for _, st := range steps {
		f.Funnel = append(f.Funnel, funnelRow{Step: st.name})
	}
	for w := range FunnelWeeks {
		monday := play.DayShift(thisWeek, -7*w)
		f.Weeks = append(f.Weeks, short(monday))
		t, err := g.Tallies(ctx, monday, play.DayShift(monday, 6))
		if err != nil {
			return f, err
		}
		visits, guests := 0, 0
		for k, n := range t {
			switch {
			case strings.HasPrefix(k, "visit:"):
				visits += n
			case strings.HasPrefix(k, "guest:"):
				guests += n
			}
		}
		all, week := weekOf(news, monday), weekOf(played, monday)
		var finished rate
		for _, n := range all {
			if n.Due(0) {
				finished.Of++
				if n.FirstFinished {
					finished.N++
				}
			}
		}
		cells := []template.HTML{template.HTML(fmt.Sprint(visits)), rate{guests, visits}.capped().HTML(),
			rate{len(all), guests}.capped().HTML(), template.HTML(fmt.Sprint(len(all) - len(week))), finished.HTML()}
		for _, st := range steps {
			var r rate
			for _, n := range week {
				if n.Due(st.day) {
					r.Of++
					if st.reached(n) {
						r.N++
					}
				}
			}
			cells = append(cells, r.HTML())
		}
		for i := range f.Funnel {
			f.Funnel[i].Cells = append(f.Funnel[i].Cells, cells[i])
		}
	}

	// Who comes back, split by what the first day had.
	split := func(name string, keys []string, key func(play.Newcomer) string, label func(string) string, of []play.Newcomer) {
		group := splitGroup{Name: name}
		for _, k := range keys {
			var those []play.Newcomer
			for _, n := range of {
				if key(n) == k {
					those = append(those, n)
				}
			}
			if len(those) > 0 {
				group.Rows = append(group.Rows, cohortOf(label(k), those))
			}
		}
		f.Splits = append(f.Splits, group)
	}
	yesNo := func(b bool) string {
		if b {
			return "Да"
		}
		return "Не"
	}
	same := func(k string) string { return k }
	split("Откъде са дошли", append(slices.Clone(play.Landings), ""), func(n play.Newcomer) string { return n.CameFrom },
		func(k string) string { return landingNames[k] }, played)
	split("Устройство на първия ден", append(slices.Clone(play.Devices), ""), func(n play.Newcomer) string { return n.Device },
		func(k string) string { return deviceNames[k] }, played)
	// The versions met, newest first: the last ten by name, the rest together.
	versions := map[string]bool{}
	for _, n := range played {
		if n.Version != "" {
			versions[n.Version] = true
		}
	}
	vs := slices.SortedFunc(func(yield func(string) bool) {
		for v := range versions {
			if !yield(v) {
				return
			}
		}
	}, func(a, b string) int { return compareVersions(b, a) })
	newest := vs[:min(10, len(vs))]
	split("Версия на първия ден", append(slices.Clone(newest), "older", ""), func(n play.Newcomer) string {
		if n.Version == "" || slices.Contains(newest, n.Version) {
			return n.Version
		}
		return "older"
	}, func(k string) string {
		switch k {
		case "older":
			return "По-стари"
		case "":
			return "Не се знае"
		}
		return k
	}, played)
	split("Известия до края на 1-ия ден", []string{"Да", "Не"}, func(n play.Newcomer) string { return yesNo(n.Push) }, same, played)
	split("Приятел до края на 1-ия ден", []string{"Да", "Не"}, func(n play.Newcomer) string { return yesNo(n.Friend) }, same, played)
	split("Първата игра", append(slices.Clone(kindOrder), "other"), func(n play.Newcomer) string {
		if slices.Contains(kindOrder, n.FirstKind) {
			return n.FirstKind
		}
		return "other"
	}, func(k string) string { return cmp.Or(kindNames[k], "Друга") }, played)
	split("Само в стая на 1-ия ден", []string{"Да", "Не"}, func(n play.Newcomer) string { return yesNo(n.RoomOnly) }, same, news)

	// The weeks' players: new, kept, back, lost.
	for _, gw := range act.Growth(today, GrowthWeeks) {
		f.Growth = append(f.Growth, growthRow{Week: short(gw.Week) + "–" + short(play.DayShift(gw.Week, 6)),
			Played: gw.New + gw.Kept + gw.Back, New: gw.New, Kept: gw.Kept, Back: gw.Back, Lost: gw.Lost})
	}

	// The daily loop: the last 7 days and the last 28, today with them.
	type window struct {
		t       map[string]int
		dayTens int
		shares  int // newcomers who came in by a shared day
	}
	var win [2]window
	for i, days := range []int{7, 28} {
		from := play.DayShift(today, -days+1)
		t, err := g.Tallies(ctx, from, today)
		if err != nil {
			return f, err
		}
		win[i].t = t
		if win[i].dayTens, err = dayTens(from, today); err != nil {
			return f, err
		}
		for _, n := range news {
			if n.First >= from && n.CameFrom == "share" {
				win[i].shares++
			}
		}
	}
	text := func(s string) template.HTML { return template.HTML(template.HTMLEscapeString(s)) }
	into := &f.Loop
	row := func(name string, sub bool, cell func(w window) template.HTML) {
		*into = append(*into, loopRow{Name: name, Week: cell(win[0]), Month: cell(win[1]), Sub: sub})
	}
	count := func(key string) func(w window) template.HTML {
		return func(w window) template.HTML { return text(fmt.Sprint(w.t[key])) }
	}
	row("Завършени дни", false, func(w window) template.HTML { return text(fmt.Sprint(w.dayTens)) })
	row("Споделили (дял от завършилите деня)", true, func(w window) template.HTML {
		return rate{w.t["share:day"], w.dayTens}.capped().HTML()
	})
	row("Посещения от споделен ден на споделяне", true, func(w window) template.HTML {
		return text(ratio(w.t["visit:share"], w.t["share:day"]))
	})
	row("Нови играчи от споделен ден", true, func(w window) template.HTML { return text(fmt.Sprint(w.shares)) })
	into = &f.Notices
	row("Покана за напомняне, показана", false, count("pushask:shown"))
	row("„Напомняй ми“", true, func(w window) template.HTML { return rate{w.t["pushask:yes"], w.t["pushask:shown"]}.HTML() })
	row("„Не сега“", true, func(w window) template.HTML { return rate{w.t["pushask:no"], w.t["pushask:shown"]}.HTML() })
	// Where notifications can't come (an iPhone in a browser, one without them), the reminder by mail (daymail.go).
	row("Покана за напомняне по имейл, показана", false, count("mailask:shown"))
	row("„Напомняй ми по имейл“", true, func(w window) template.HTML { return rate{w.t["mailask:yes"], w.t["mailask:shown"]}.HTML() })
	row("„Не сега“", true, func(w window) template.HTML { return rate{w.t["mailask:no"], w.t["mailask:shown"]}.HTML() })
	row("Писма „Въпросите на деня те чакат“, изпратени", true, count("mail:day:sent"))
	for _, k := range pushNames {
		row("Известия „"+k.name+"“, изпратени", false, count("push:sent:"+k.kind))
		row("отворени", true, func(w window) template.HTML {
			return rate{w.t["push:open:"+k.kind], w.t["push:sent:"+k.kind]}.capped().HTML()
		})
		row("изчезнали абонаменти", true, count("push:gone:"+k.kind))
		row("не стигнали до никое устройство", true, count("push:failed:"+k.kind))
	}
	f.Repeats = rate{win[0].t["day:seen"], win[0].t["day:answers"]}
	f.Repairs = rate{win[0].t["repair:done"], win[0].t["repair:offered"]}

	// The reminders against the hold-out (play/experiment.go), since it began.
	if f.Holdout, err = s.holdout(ctx, today); err != nil {
		return f, err
	}

	// The streaks.
	h, err := g.StreakHealth(ctx, 7)
	if err != nil {
		return f, err
	}
	for i, from := range play.StreakBands {
		band := fmt.Sprintf("%d+ дни", from)
		if i+1 < len(play.StreakBands) {
			band = fmt.Sprintf("%d–%d", from, play.StreakBands[i+1]-1)
		}
		f.Streaks = append(f.Streaks, streakRow{Band: band, Going: h.Going[i], Ended: h.Ended[i]})
	}
	f.Spent = h.Spent

	// The games, by kind, day by day: the kinds there are, as the runs have them.
	days7, err := g.Games(ctx, 7)
	if err != nil {
		return f, err
	}
	seen := map[string]bool{}
	for _, d := range days7 {
		for k, n := range d.Kinds {
			if n > 0 {
				seen[k] = true
			}
		}
	}
	kinds := kindsOf(seen)
	for _, k := range kinds {
		f.Kinds = append(f.Kinds, kindName(k))
	}
	for _, d := range days7 {
		r := gamesRow{Day: short(d.Day), Only: rate{d.OnlyDayPlayer, d.DayPlayers}}
		for _, k := range kinds {
			r.Kinds = append(r.Kinds, d.Kinds[k])
		}
		f.Games = append(f.Games, r)
	}

	// The parts of the game, and the devices, over 28 days.
	month := play.DayShift(today, -27)
	uses, err := g.UsesSince(ctx, month)
	if err != nil {
		return f, err
	}
	actives := act.Within(month, today)
	for _, k := range kindsOf(uses.ByKind) {
		u := uses.ByKind[k]
		fr := featureRow{Name: kindName(k), Players: rate{u.Players, actives}.capped(), PerPlayer: ratio(u.Games, u.Players)}
		for _, n := range news {
			if !n.Due(13) {
				continue
			}
			if n.Kinds[k] {
				fr.Used.Of++
				if n.BackWithin(7, 13) {
					fr.Used.N++
				}
			} else {
				fr.NotUsed.Of++
				if n.BackWithin(7, 13) {
					fr.NotUsed.N++
				}
			}
		}
		f.Features = append(f.Features, fr)
	}
	for _, d := range append(slices.Clone(play.Devices), "") {
		u, day := uses.ByDevice[d], uses.DayByDevice[d]
		if u.Games == 0 {
			continue
		}
		f.Devices = append(f.Devices, deviceRow{Name: deviceNames[d], Players: u.Players, Games: u.Games,
			DayFinished: rate{day.Finished, day.Games}})
	}
	return f, nil
}

// holdout compares the players reminded with those held out of the reminders (play.HeldReminders), since it began
// (today, not over, not with it): of the day's reminders (not the last word that they stop) and of the day's mails,
// the days finished after one that day, and within two hours of the notification; of the streaks' mails whose three
// days are over, those back by then. All the claims, sent or not (reached a device or not): it's the sending that's
// tried.
func (s *Server) holdout(ctx context.Context, today string) ([]holdoutRow, error) {
	const people = ` AND d.user_id NOT IN (SELECT id FROM users WHERE admin)`
	finished := func(within string) string {
		return `coalesce(sum(EXISTS (SELECT 1 FROM runs r WHERE r.user_id = d.user_id AND r.kind = 'day' AND r.day = d.day
			AND r.finished_at ` + within + `)), 0)`
	}
	rows := []holdoutRow{
		{Name: "Напомняне за деня: денят изигран след него"}, {Name: "…до 2 часа след него"},
		{Name: "Писмо за деня: денят изигран след него"}, {Name: "Писмо за серия: пак до 3 дни"},
	}
	for _, q := range []struct {
		sql  string
		args []any
		into []int // the rows each measure after the count goes to
	}{
		{`SELECT d.held, count(*), ` + finished(">= d.at") + `, ` + finished("BETWEEN d.at AND d.at + 7200000") + `
			FROM push_reminded d WHERE NOT d.last AND d.day < ?` + people + ` GROUP BY d.held`, []any{today}, []int{0, 1}},
		{`SELECT d.held, count(*), ` + finished(">= d.at") + ` FROM day_mails d WHERE d.day < ?` + people + ` GROUP BY d.held`,
			[]any{today}, []int{2}},
		{`SELECT d.held, count(*), count(*) FILTER (WHERE EXISTS (SELECT 1 FROM runs r WHERE r.user_id = d.user_id
				AND r.kind = 'day' AND r.finished_at IS NOT NULL AND r.day BETWEEN d.day AND date(d.day, '+2 days')))
			FROM streak_mails d WHERE d.day <= ?` + people + ` GROUP BY d.held`, []any{play.DayShift(today, -3)}, []int{3}},
	} {
		res, err := s.db.Read.QueryContext(ctx, q.sql, q.args...)
		if err != nil {
			return nil, err
		}
		for res.Next() {
			var held bool
			n := 0
			hits := make([]int, len(q.into))
			dest := []any{&held, &n}
			for i := range hits {
				dest = append(dest, &hits[i])
			}
			if err := res.Scan(dest...); err != nil {
				res.Close()
				return nil, err
			}
			for i, row := range q.into {
				if held {
					rows[row].Held = rate{hits[i], n}
				} else {
					rows[row].Sent = rate{hits[i], n}
				}
			}
		}
		res.Close()
		if err := res.Err(); err != nil {
			return nil, err
		}
	}
	return rows, nil
}

// release is a version of the game and the day it first served.
type release struct{ Version, Day string }

// releasesSince are the versions first served on `from` or after, oldest first.
func (s *Server) releasesSince(ctx context.Context, from string) ([]release, error) {
	fromMs, _ := time.ParseInLocation(time.DateOnly, from, bulgaria())
	rows, err := s.db.Read.QueryContext(ctx, `SELECT version, at FROM releases WHERE at >= ? ORDER BY at`, fromMs.UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []release
	for rows.Next() {
		var r release
		var at int64
		if err := rows.Scan(&r.Version, &at); err != nil {
			return nil, err
		}
		r.Day = time.UnixMilli(at).In(bulgaria()).Format(time.DateOnly)
		out = append(out, r)
	}
	return out, rows.Err()
}

// compareVersions orders two versions (vX.Y.Z) by their numbers.
func compareVersions(a, b string) int {
	parts := func(v string) []int {
		var out []int
		for p := range strings.SplitSeq(strings.TrimPrefix(v, "v"), ".") {
			n := 0
			fmt.Sscan(p, &n)
			out = append(out, n)
		}
		return out
	}
	return slices.Compare(parts(a), parts(b))
}
