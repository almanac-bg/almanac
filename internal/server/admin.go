package server

import (
	"bytes"
	"cmp"
	"database/sql"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

// How many questions may be reported in an hour: by a player (a careful one finds a few in a game), from a network (a
// class, playing the same day's ten, may all report the same slip), and from a site (a few such networks). No report
// is refused for what others sent: past reportsAll from everyone in an hour, whoever runs the game hears of a flood
// (review 2026-11-18, S10), and /admin/questions shows the reports of reportsShown questions at most, a player's all resolved
// at once.
const (
	reportsPlayer = 20
	reportsNet    = 60
	reportsSite   = 5 * reportsNet
	reportsAll    = 600
	reportsShown  = 100
	reportsEach   = 20 // reports shown of one question
)

// report takes what a player says is wrong with a question.
func (s *Server) report(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if _, ok := s.bank.Load().Get(id); !ok {
		return errNotFound
	}
	var in struct {
		Text string `json:"text"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	text := PlayerText(in.Text)
	if n := utf8.RuneCountInString(text); n < 3 || n > 500 {
		return &apiError{http.StatusBadRequest, "bad_report", "Напиши с няколко думи какво не е наред (до 500 знака)."}
	}
	if !s.guard.allow("report:"+strconv.FormatInt(u.ID, 10), reportsPlayer, time.Hour) ||
		!s.guardFrom(r, "report", reportsNet, reportsSite, time.Hour) {
		return errTooMany
	}
	if !s.guard.allow("report", reportsAll, time.Hour) {
		s.problems.add(fmt.Sprintf("reports: over %d questions reported in an hour; a flood? (/admin/questions)", reportsAll))
	}
	_, err = s.db.Write.ExecContext(r.Context(), `INSERT INTO reports (question_id, user_id, text, at) VALUES (?, ?, ?, ?)`,
		id, u.ID, text, store.Now())
	if err != nil {
		return err
	}
	// Whoever runs the game hears that there are reports, once a day; which, and what they say, is on /admin/questions.
	s.problems.add("a question was reported (the reports are on /admin/questions)")
	return ok(w, map[string]bool{"ok": true})
}

// PlayerText is what a player wrote, as the game keeps it: on one line, its spaces one, and without control or format
// characters (a terminal's escapes, a bell, the bidi overrides that make text read backwards, zero-width letters).
// A report goes on to whoever runs `bank reports` in a terminal and to the agents that fix questions: what reaches
// them is plain words, however it was sent (review 2026-11-18, S17). What's written is still only words of anyone's:
// those who read it treat it as such.
func PlayerText(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return ' '
		}
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || unicode.Is(unicode.Co, r) || r == utf8.RuneError {
			return -1
		}
		return r
	}, s)
	return strings.Join(strings.Fields(s), " ")
}

// admin is the page for whoever keeps the game: whether players come back and what they do (measures), fair play,
// and players (a name to put right, a player to suspend: admin_players.go). The questions are on a page of their own
// (adminQuestions). Admins only; to anyone else they aren't there.
func (s *Server) admin(w http.ResponseWriter, r *http.Request) {
	if !s.isAdmin(r) {
		s.page(w, r) // to anyone else, the game's own page that isn't there
		return
	}
	ctx := r.Context()
	b := s.bank.Load()
	db := s.db.Read
	data := struct {
		Players, WithEmail, DayToday, DayScripted, Questions, Live int
		M                                                          measures
		Fair                                                       []play.FairSignal
	}{Questions: len(b.Questions), Live: len(b.Live("", ""))}
	today := s.game.Today()
	var err error
	if data.M, err = s.measures(ctx); err != nil {
		slog.Error("admin: the measures", "err", err)
	}
	_ = db.QueryRowContext(ctx, `SELECT count(*), count(email) FROM users`).Scan(&data.Players, &data.WithEmail)
	// The days played after several throwaway guests from the same network (play.JudgeNets).
	if data.Fair, err = s.game.FairSignals(ctx, 50); err != nil {
		slog.Error("admin: fair play", "err", err)
	}
	// The day's games by people, and apart those played at a script's speed, which nobody else sees (play/fair.go).
	_ = db.QueryRowContext(ctx, `SELECT count(*) FILTER (WHERE `+play.People+`), count(*) FILTER (WHERE shadow = ?) FROM runs
		WHERE kind = 'day' AND day = ? AND finished_at IS NOT NULL`, play.ShadowScript, today).Scan(&data.DayToday, &data.DayScripted)

	var body bytes.Buffer
	if err := adminBody.Execute(&body, data); err != nil {
		slog.Error("admin", "err", err)
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	body.WriteString(`<section class="admin-section admin-players">`)
	body.WriteString(string(adminPlayersHTML(s.adminPlayersOf(ctx, r.URL.Query().Get("player")))))
	body.WriteString(`</section>`)
	s.adminPage(w, "Управление", template.HTML(body.String()))
}

// isAdmin says whether the request is an admin's.
func (s *Server) isAdmin(r *http.Request) bool {
	u, err := s.user(r)
	return err == nil && u != nil && u.Admin
}

// adminQuestions is /admin's page of the questions: reports on them, and how each goes.
func (s *Server) adminQuestions(w http.ResponseWriter, r *http.Request) {
	if !s.isAdmin(r) {
		s.page(w, r) // to anyone else, the game's own page that isn't there
		return
	}
	ctx := r.Context()
	b := s.bank.Load()
	db := s.db.Read
	type report struct {
		Line   string
		Player int64 // 0: the player is gone
	}
	type reported struct {
		ID, Category, Text, Answer string
		Reports                    []report
		More                       int // reports of it not shown (reportsEach)
	}
	type stat struct {
		ID, Text, Answer, Lure string
		Answers, Right, Share  int
		Seconds                float64
	}
	data := struct {
		Reported                       []reported
		ReportsOpen, QuestionsReported int
		Hardest, Easiest               []stat
	}{}

	// The questions reported most lately first, reportsShown of them, and of each its first reportsEach reports: a
	// flood of reports can't make the page too long to load.
	_ = db.QueryRowContext(ctx, `SELECT count(*), count(DISTINCT question_id) FROM reports WHERE resolved_at IS NULL`).
		Scan(&data.ReportsOpen, &data.QuestionsReported)
	rows, err := db.QueryContext(ctx, `WITH shown AS (
			SELECT question_id, max(at) AS last, count(*) AS n FROM reports WHERE resolved_at IS NULL
			GROUP BY question_id ORDER BY last DESC LIMIT ?1),
		open AS (
			SELECT r.question_id, r.text, r.user_id, r.at,
				row_number() OVER (PARTITION BY r.question_id ORDER BY r.at) AS i
			FROM reports r JOIN shown USING (question_id) WHERE r.resolved_at IS NULL)
		SELECT o.question_id, o.text, coalesce(u.name, '—'), coalesce(o.user_id, 0), o.at, s.n FROM open o
		JOIN shown s USING (question_id) LEFT JOIN users u ON u.id = o.user_id
		WHERE o.i <= ?2 ORDER BY s.last DESC, o.question_id, o.at`, reportsShown, reportsEach)
	if err == nil {
		byID := map[string]*reported{}
		var order []string
		for rows.Next() {
			var id, text, name string
			var player, at int64
			var n int
			if rows.Scan(&id, &text, &name, &player, &at, &n) != nil {
				continue
			}
			rp := byID[id]
			if rp == nil {
				rp = &reported{ID: id, More: n}
				if q, ok := b.Get(id); ok {
					rp.Category, rp.Text, rp.Answer = q.Base().Category, q.Base().Text, bank.KeeperText(q)
				}
				byID[id] = rp
				order = append(order, id)
			}
			rp.More--
			line := time.UnixMilli(at).In(bulgaria()).Format("02.01 15:04") + " · " + name + ": " + text
			rp.Reports = append(rp.Reports, report{Line: line, Player: player})
		}
		rows.Close()
		for _, id := range order {
			data.Reported = append(data.Reported, *byID[id])
		}
	}

	// How each question goes, once enough have answered it to tell: the answers tallied here as they lie, in one
	// pass (a GROUP BY would have SQLite sort them all, twice, many times slower); those to it as it is now
	// (play.Counted), if it's in the bank.
	type tally struct {
		n, right, ms int
		counted      *play.Counted
	}
	tallies := map[string]*tally{}
	if rows, err := db.QueryContext(ctx, `SELECT question_id, version, at, is_right, ms FROM answers WHERE `+play.FairAnswers); err == nil {
		var id []byte
		var version sql.NullInt64
		var at int64
		var right bool
		var ms int
		for rows.Next() {
			if rows.Scan(&id, &version, &at, &right, &ms) != nil {
				continue
			}
			t := tallies[string(id)] // no copy of the id for a lookup
			if t == nil {
				t = &tally{}
				if q, ok := b.Get(string(id)); ok {
					c := s.game.CountedOf(q)
					t.counted = &c
				}
				tallies[string(id)] = t
			}
			if t.counted != nil && !t.counted.Counts(version, at) {
				continue
			}
			t.n++
			t.ms += ms
			if right {
				t.right++
			}
		}
		rows.Close()
	}
	var told []stat
	for id, t := range tallies {
		if t.n < 10 {
			continue
		}
		st := stat{ID: id, Answers: t.n, Right: t.right, Seconds: float64(t.ms) / float64(t.n) / 1000, Share: 100 * t.right / t.n}
		if q, ok := b.Get(id); ok {
			st.Text, st.Answer = q.Base().Text, bank.KeeperText(q)
		}
		told = append(told, st)
	}
	// The hardest first: the smallest share right (compared exactly), then the most answered.
	slices.SortFunc(told, func(x, y stat) int {
		if c := cmp.Compare(x.Right*y.Answers, y.Right*x.Answers); c != 0 {
			return c
		}
		return cmp.Or(cmp.Compare(y.Answers, x.Answers), strings.Compare(x.ID, y.ID))
	})
	data.Hardest = slices.Clone(told[:min(30, len(told))])
	slices.SortStableFunc(told, func(x, y stat) int {
		if c := cmp.Compare(y.Right*x.Answers, x.Right*y.Answers); c != 0 {
			return c
		}
		return cmp.Compare(y.Answers, x.Answers)
	})
	data.Easiest = told[:min(30, len(told))]
	// The wrong option that draws most people, for the hardest choices.
	for i, st := range data.Hardest {
		q, ok := b.Get(st.ID)
		if !ok || q.Base().Type != "choice" {
			continue
		}
		var pick int
		c := s.game.CountedOf(q)
		if db.QueryRowContext(ctx, `SELECT json_extract(given, '$.pick') p FROM answers WHERE question_id = ? AND given IS NOT NULL
			AND json_extract(given, '$.pick') > 0 AND (version = ? OR version IS NULL AND at >= ?) AND `+play.FairAnswers+`
			GROUP BY p ORDER BY count(*) DESC LIMIT 1`, st.ID, c.Version, c.From).Scan(&pick) == nil {
			data.Hardest[i].Lure = bank.Option(q, pick)
		}
	}

	var body bytes.Buffer
	if err := adminQuestionsBody.Execute(&body, data); err != nil {
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	s.adminPage(w, "Въпроси", template.HTML(body.String()))
}

// resolve marks a question's reports as seen to; resolvePlayer, every report of one player's (one who floods them).
func (s *Server) resolve(w http.ResponseWriter, r *http.Request) {
	s.resolveWhere(w, r, `question_id = ?`, r.PathValue("id"))
}

func (s *Server) resolvePlayer(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	s.resolveWhere(w, r, `user_id = ?`, id)
}

// resolveWhere marks the open reports that match as seen to, for an admin; to anyone else it isn't there.
func (s *Server) resolveWhere(w http.ResponseWriter, r *http.Request, where string, arg any) {
	u, err := s.user(r)
	if err != nil || u == nil || !u.Admin {
		http.NotFound(w, r)
		return
	}
	_, err = s.db.Write.ExecContext(r.Context(), `UPDATE reports SET resolved_at = ? WHERE `+where+` AND resolved_at IS NULL`,
		store.Now(), arg)
	if err != nil {
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/admin/questions", http.StatusSeeOther)
}

func bulgaria() *time.Location {
	if l, err := time.LoadLocation("Europe/Sofia"); err == nil {
		return l
	}
	return time.UTC
}
