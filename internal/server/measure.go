package server

import (
	"cmp"
	"context"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// What the server counts for the admin page (play/measure.go): visits without a profile by where they landed, the
// guests made and where they came from, and what the client tells (/api/tally): the day shared, the reminder's ask
// answered, a notification opened.

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

// countVisit counts a page loaded by a person without a profile, by where it landed: once an address an half hour
// for each landing, so that reloads and a page's own navigation don't count again.
func (s *Server) countVisit(r *http.Request) {
	if _, err := r.Cookie(s.cookie); err == nil || r.Method != http.MethodGet || r.Header.Get("Sec-Purpose") != "" {
		return
	}
	ua := r.UserAgent()
	if !strings.HasPrefix(ua, "Mozilla/") || robot.MatchString(ua) {
		return
	}
	where := landing(r.URL.Path, inApp(r))
	if !s.limits.allow("visit:"+where+":"+s.clientIP(r), 1, 30*time.Minute) {
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

// clientTallies are what the client counts (play/measure.go): the day shared, the reminder's ask on Начало (shown,
// yes, no; and on an iPhone in a browser, the way to the home screen shown), a notification opened, by kind.
var clientTallies = map[string]bool{
	"share:day": true, "pushask:shown": true, "pushask:yes": true, "pushask:no": true, "pushask:home": true,
}

func init() {
	for k := range pushKinds {
		clientTallies["push:open:"+string(k)] = true
	}
	clientTallies["push:open:"+pushAsked.name()] = true
	clientTallies["push:open:stop"] = true // the day's last reminder (remind.go)
}

// tally counts one of what the client counts. Anyone may (a notification is opened before the page knows who's
// playing), a few times a minute.
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
	if !s.limits.allow("tally:"+s.clientIP(r), 30, time.Hour) {
		return errTooMany
	}
	if err := s.game.Tally(r.Context(), in.Key, 1); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// rate is n of so many: "12 · 40%", or "—" while there are none to tell of.
type rate struct{ N, Of int }

func (r rate) String() string {
	if r.Of == 0 {
		return "—"
	}
	return fmt.Sprintf("%d · %d%%", r.N, 100*r.N/r.Of)
}

// ratio is a ratio with a decimal comma, as Bulgarian writes it: "0,4"; "—" for nothing to divide by.
func ratio(n, of int) string {
	if of == 0 {
		return "—"
	}
	return strings.Replace(fmt.Sprintf("%.1f", float64(n)/float64(of)), ".", ",", 1)
}

// landingNames are the landings as the admin page says them.
var landingNames = map[string]string{
	"home": "Началната страница", "share": "Споделен ден", "invite": "Покана", "room": "Стая",
	"player": "Профил на играч", "app": "Приложението", "other": "Друга страница", "": "Не се знае",
}

// kindNames are the kinds of games, as the admin page says them.
var kindNames = map[string]string{
	"day": "Денят", "topic": "Тема", "duel": "Дуел", "royal": "Роял", "mistakes": "Грешки", "challenge": "Предизвикателство",
}

// pushNames are the kinds of notifications as they're counted (pushKind.name; "stop": the day's last reminder), and as
// the admin page says them.
var pushNames = []struct{ kind, name string }{
	{"day", "Въпросите на деня"}, {"stop", "Спираме напомнянията"}, {"friends", "Приятели и игри"}, {"royal", "Роял"},
	{"asked", "Роял, поискан"},
}

// firstWeek is what the admin page tells of players' first weeks and the daily loop.
type firstWeek struct {
	Weeks   []string // the weeks of the funnel, newest first: their Mondays, as „10.11“
	Funnel  []funnelRow
	Cohorts []weekCohort
	Overall weekCohort
	Splits  []splitGroup
	Loop    []loopRow
	Repeats rate
	Streaks []streakRow
	Spent   int
	Kinds   []string // the kinds of games played in the last 7 days, by name
	Games   []gamesRow
	Stick   string // DAU ÷ MAU
}

type funnelRow struct {
	Step  string
	Cells []string
}

type weekCohort struct {
	Week                string
	New                 int
	D1, D7, Within, D30 rate
}

type splitGroup struct {
	Name string
	Rows []weekCohort // Week is the row's name
}

type loopRow struct {
	Name        string
	Week, Month string
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

// FunnelWeeks and SplitWeeks are how many weeks of first days the admin page tells: the funnel's, week by week; the
// splits', together (enough for D30).
const (
	FunnelWeeks = 6
	SplitWeeks  = 12
)

func (s *Server) firstWeek(ctx context.Context, active play.Active) (firstWeek, error) {
	var f firstWeek
	g := s.game
	today := g.Today()
	thisWeek := play.WeekOf(today)
	since := play.DayShift(thisWeek, -7*(SplitWeeks-1))
	news, err := g.Newcomers(ctx, since)
	if err != nil {
		return f, err
	}

	// The funnel, week by week of first days.
	short := func(day string) string { return day[8:10] + "." + day[5:7] }
	steps := []struct {
		name    string
		day     int // the step can be told once this day after the first is over
		reached func(play.Newcomer) bool
	}{
		{"Завършили деня на 1-ия ден", 0, func(n play.Newcomer) bool { return n.DayTen[0] }},
		{"Втора игра на 1-ия ден", 0, func(n play.Newcomer) bool { return n.Games >= 2 }},
		{"Пак на 2-ия ден", 1, func(n play.Newcomer) bool { return n.Played[1] }},
		{"Денят в 3 от първите 7 дни", 6, func(n play.Newcomer) bool { return n.DayTens() >= 3 }},
		{"На 7-ия ден след първия", 7, func(n play.Newcomer) bool { return n.Played[7] }},
		{"На 30-ия ден след първия", 30, func(n play.Newcomer) bool { return n.Played[30] }},
	}
	f.Funnel = []funnelRow{{Step: "Посещения без профил"}, {Step: "Нови гости (дял от посещенията)"},
		{Step: "Изиграли въпрос (дял от гостите)"}}
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
		var week []play.Newcomer
		for _, n := range news {
			if play.WeekOf(n.First) == monday {
				week = append(week, n)
			}
		}
		f.Funnel[0].Cells = append(f.Funnel[0].Cells, fmt.Sprint(visits))
		f.Funnel[1].Cells = append(f.Funnel[1].Cells, rate{guests, visits}.String())
		f.Funnel[2].Cells = append(f.Funnel[2].Cells, rate{len(week), guests}.String())
		for i, st := range steps {
			var r rate
			for _, n := range week {
				if n.Due(st.day) {
					r.Of++
					if st.reached(n) {
						r.N++
					}
				}
			}
			f.Funnel[3+i].Cells = append(f.Funnel[3+i].Cells, r.String())
		}
	}

	// Coming back, by week of first days, and split by what the first day had.
	cohort := func(name string, of []play.Newcomer) weekCohort {
		c := weekCohort{Week: name, New: len(of)}
		for _, n := range of {
			for _, x := range []struct {
				r    *rate
				day  int
				back bool
			}{{&c.D1, 1, n.Played[1]}, {&c.D7, 7, n.Played[7]}, {&c.Within, 7, n.BackWithin(1, 7)}, {&c.D30, 30, n.Played[30]}} {
				if n.Due(x.day) {
					x.r.Of++
					if x.back {
						x.r.N++
					}
				}
			}
		}
		return c
	}
	for w := range SplitWeeks {
		monday := play.DayShift(thisWeek, -7*w)
		var week []play.Newcomer
		for _, n := range news {
			if play.WeekOf(n.First) == monday {
				week = append(week, n)
			}
		}
		if len(week) > 0 {
			f.Cohorts = append(f.Cohorts, cohort(short(monday)+"–"+short(play.DayShift(monday, 6)), week))
		}
	}
	f.Overall = cohort("Общо", news)
	split := func(name string, keys []string, key func(play.Newcomer) string, label func(string) string) {
		group := splitGroup{Name: name}
		for _, k := range keys {
			var of []play.Newcomer
			for _, n := range news {
				if key(n) == k {
					of = append(of, n)
				}
			}
			if len(of) > 0 {
				group.Rows = append(group.Rows, cohort(label(k), of))
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
		func(k string) string { return landingNames[k] })
	split("Известия до края на 1-ия ден", []string{"Да", "Не"}, func(n play.Newcomer) string { return yesNo(n.Push) }, same)
	split("Приятел до края на 1-ия ден", []string{"Да", "Не"}, func(n play.Newcomer) string { return yesNo(n.Friend) }, same)
	split("Приложение или сайт", []string{"Приложението", "Сайтът"}, func(n play.Newcomer) string {
		if n.CameFrom == "app" {
			return "Приложението"
		}
		return "Сайтът"
	}, same)
	split("Първата игра", []string{"day", "topic", "other"}, func(n play.Newcomer) string {
		if n.FirstKind == "day" || n.FirstKind == "topic" {
			return n.FirstKind
		}
		return "other"
	}, func(k string) string { return cmp.Or(kindNames[k], "Друга") })

	// The daily loop: the last 7 days and the last 28, today with them.
	type window struct {
		t       map[string]int
		dayTens int
		within  rate // the day's reminders, and those followed by the day within two hours
	}
	var win [2]window
	for i, days := range []int{7, 28} {
		from := play.DayShift(today, -days+1)
		t, err := g.Tallies(ctx, from, today)
		if err != nil {
			return f, err
		}
		win[i].t = t
		if err := s.db.Read.QueryRowContext(ctx, `SELECT count(*) FROM runs WHERE kind = 'day' AND day BETWEEN ? AND ?
			AND finished_at IS NOT NULL AND NOT scripted`, from, today).Scan(&win[i].dayTens); err != nil {
			return f, err
		}
		// The day's reminders (remind.go), and the days finished within two hours of one.
		if err := s.db.Read.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(EXISTS (SELECT 1 FROM runs r
			WHERE r.user_id = d.user_id AND r.kind = 'day' AND r.day = d.day AND r.finished_at BETWEEN d.at AND d.at + 7200000)), 0)
			FROM push_reminded d WHERE d.day BETWEEN ? AND ? AND NOT d.last`, from, today).Scan(&win[i].within.Of, &win[i].within.N); err != nil {
			return f, err
		}
	}
	row := func(name string, sub bool, cell func(w window) string) {
		f.Loop = append(f.Loop, loopRow{Name: name, Week: cell(win[0]), Month: cell(win[1]), Sub: sub})
	}
	row("Завършени дни", false, func(w window) string { return fmt.Sprint(w.dayTens) })
	row("Споделени (дял от завършените)", true, func(w window) string { return rate{w.t["share:day"], w.dayTens}.String() })
	row("Посещения от споделен ден на споделяне", true, func(w window) string { return ratio(w.t["visit:share"], w.t["share:day"]) })
	row("Покана за напомняне, показана", false, func(w window) string { return fmt.Sprint(w.t["pushask:shown"]) })
	row("„Напомняй ми“", true, func(w window) string { return rate{w.t["pushask:yes"], w.t["pushask:shown"]}.String() })
	row("„Не сега“", true, func(w window) string { return rate{w.t["pushask:no"], w.t["pushask:shown"]}.String() })
	row("На iPhone: пътят към началния екран", true, func(w window) string { return fmt.Sprint(w.t["pushask:home"]) })
	for _, k := range pushNames {
		row("Известия „"+k.name+"“, изпратени", false, func(w window) string { return fmt.Sprint(w.t["push:sent:"+k.kind]) })
		row("отворени", true, func(w window) string { return rate{w.t["push:open:"+k.kind], w.t["push:sent:"+k.kind]}.String() })
		row("изчезнали абонаменти", true, func(w window) string { return fmt.Sprint(w.t["push:gone:"+k.kind]) })
		if k.kind == "day" {
			row("денят изигран до 2 часа след напомнянето", true, func(w window) string { return w.within.String() })
		}
	}
	f.Repeats = rate{win[0].t["day:seen"], win[0].t["day:answers"]}

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

	// The games, by kind, day by day.
	days, err := g.Games(ctx, 7)
	if err != nil {
		return f, err
	}
	var kinds []string
	for _, k := range []string{"day", "topic", "duel", "royal", "mistakes", "challenge"} {
		for _, d := range days {
			if d.Kinds[k] > 0 {
				kinds = append(kinds, k)
				f.Kinds = append(f.Kinds, kindNames[k])
				break
			}
		}
	}
	for _, d := range days {
		r := gamesRow{Day: short(d.Day), Only: rate{d.OnlyDayPlayer, d.DayPlayers}}
		for _, k := range kinds {
			r.Kinds = append(r.Kinds, d.Kinds[k])
		}
		f.Games = append(f.Games, r)
	}
	f.Stick = "—"
	if active.Month > 0 {
		f.Stick = fmt.Sprintf("%d%%", int(100*active.Daily/float64(active.Month)+0.5))
	}
	return f, nil
}
