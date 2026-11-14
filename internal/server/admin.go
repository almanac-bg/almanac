package server

import (
	"bytes"
	"html/template"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
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
	text := strings.Join(strings.Fields(in.Text), " ")
	if n := utf8.RuneCountInString(text); n < 3 || n > 500 {
		return &apiError{http.StatusBadRequest, "bad_report", "Напиши с няколко думи какво не е наред (до 500 знака)."}
	}
	if !s.limits.allow("report:"+u.Name, 20, time.Hour) {
		return errTooMany
	}
	_, err = s.db.Write.ExecContext(r.Context(), `INSERT INTO reports (question_id, user_id, text, at) VALUES (?, ?, ?, ?)`,
		id, u.ID, text, store.Now())
	if err != nil {
		return err
	}
	s.problems.add("a question was reported: " + id) // whoever runs the game hears of it (each question once)
	return ok(w, map[string]bool{"ok": true})
}

// admin is the page for whoever keeps the game: reports on questions, and how each question goes. Admins only; to
// anyone else it isn't there.
func (s *Server) admin(w http.ResponseWriter, r *http.Request) {
	u, err := s.user(r)
	if err != nil || u == nil || !u.Admin {
		http.NotFound(w, r)
		return
	}
	ctx := r.Context()
	b := s.bank.Load()
	db := s.db.Read
	type reported struct {
		ID, Category, Text, Answer string
		Reports                    []string
	}
	type stat struct {
		ID, Text, Answer, Lure string
		Answers, Right, Share  int
		Seconds                float64
	}
	// A day's new players and how many came back: a cell per day after (RetentionDays).
	type cell struct {
		Back, Share int
		Due         bool // the day hasn't come yet
	}
	type cohort struct {
		Day   string
		New   int
		Cells []cell
	}
	data := struct {
		Players, WithEmail, DayToday, Questions, Live int
		Active                                        play.Active
		After                                         []int
		Cohorts                                       []cohort
		Overall                                       []cell
		Reported                                      []reported
		Hardest, Easiest                              []stat
	}{Questions: len(b.Questions), Live: len(b.Live("", "")), After: play.RetentionDays}
	today := s.game.Today()
	if cohorts, active, err := s.game.Retention(ctx, 30); err == nil {
		data.Active = active
		// Overall: of the players whose day N has come, the share that came back on it.
		news, backs := make([]int, len(play.RetentionDays)), make([]int, len(play.RetentionDays))
		for _, c := range cohorts {
			row := cohort{Day: c.Day, New: c.New}
			for i, n := range c.Back {
				if n < 0 {
					row.Cells = append(row.Cells, cell{Due: true})
					continue
				}
				row.Cells = append(row.Cells, cell{Back: n, Share: 100 * n / c.New})
				news[i] += c.New
				backs[i] += n
			}
			data.Cohorts = append(data.Cohorts, row)
		}
		for i := range news {
			if news[i] == 0 {
				data.Overall = append(data.Overall, cell{Due: true})
				continue
			}
			data.Overall = append(data.Overall, cell{Back: backs[i], Share: 100 * backs[i] / news[i]})
		}
	}
	_ = db.QueryRowContext(ctx, `SELECT count(*), count(email) FROM users`).Scan(&data.Players, &data.WithEmail)
	_ = db.QueryRowContext(ctx, `SELECT count(*) FROM runs WHERE kind = 'day' AND day = ? AND finished_at IS NOT NULL`, today).Scan(&data.DayToday)

	rows, err := db.QueryContext(ctx, `SELECT r.question_id, r.text, coalesce(u.name, '—'), r.at FROM reports r
		LEFT JOIN users u ON u.id = r.user_id WHERE r.resolved_at IS NULL ORDER BY r.question_id, r.at`)
	if err == nil {
		byID := map[string]*reported{}
		var order []string
		for rows.Next() {
			var id, text, name string
			var at int64
			if rows.Scan(&id, &text, &name, &at) != nil {
				continue
			}
			rp := byID[id]
			if rp == nil {
				rp = &reported{ID: id}
				if q, ok := b.Get(id); ok {
					rp.Category, rp.Text, rp.Answer = q.Base().Category, q.Base().Text, bank.AnswerText(q)
				}
				byID[id] = rp
				order = append(order, id)
			}
			rp.Reports = append(rp.Reports, time.UnixMilli(at).In(bulgaria()).Format("02.01 15:04")+" · "+name+": "+text)
		}
		rows.Close()
		for _, id := range order {
			data.Reported = append(data.Reported, *byID[id])
		}
	}

	// How each question goes, once enough have answered it to tell.
	read := func(order string) []stat {
		var out []stat
		rows, err := db.QueryContext(ctx, `SELECT question_id, count(*), sum(is_right), avg(ms) FROM answers
			GROUP BY question_id HAVING count(*) >= 10 ORDER BY 1.0 * sum(is_right) / count(*) `+order+`, count(*) DESC LIMIT 30`)
		if err != nil {
			return nil
		}
		defer rows.Close()
		for rows.Next() {
			var st stat
			var ms float64
			if rows.Scan(&st.ID, &st.Answers, &st.Right, &ms) != nil {
				continue
			}
			st.Seconds = ms / 1000
			st.Share = 100 * st.Right / st.Answers
			if q, ok := b.Get(st.ID); ok {
				st.Text, st.Answer = q.Base().Text, bank.AnswerText(q)
			}
			out = append(out, st)
		}
		return out
	}
	data.Hardest, data.Easiest = read("ASC"), read("DESC")
	// The wrong option that draws most people, for the hardest choices.
	for i, st := range data.Hardest {
		q, ok := b.Get(st.ID)
		if !ok || q.Base().Type != "choice" {
			continue
		}
		var pick int
		if db.QueryRowContext(ctx, `SELECT json_extract(given, '$.pick') p FROM answers WHERE question_id = ? AND given IS NOT NULL
			AND json_extract(given, '$.pick') > 0 GROUP BY p ORDER BY count(*) DESC LIMIT 1`, st.ID).Scan(&pick) == nil {
			data.Hardest[i].Lure = bank.Option(q, pick)
		}
	}

	var body bytes.Buffer
	if err := adminBody.Execute(&body, data); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	s.plain(w, "Управление", template.HTML(body.String()))
}

// resolve marks a question's reports as seen to.
func (s *Server) resolve(w http.ResponseWriter, r *http.Request) {
	u, err := s.user(r)
	if err != nil || u == nil || !u.Admin {
		http.NotFound(w, r)
		return
	}
	_, err = s.db.Write.ExecContext(r.Context(), `UPDATE reports SET resolved_at = ? WHERE question_id = ? AND resolved_at IS NULL`,
		store.Now(), r.PathValue("id"))
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/admin", http.StatusSeeOther)
}

func bulgaria() *time.Location {
	if l, err := time.LoadLocation("Europe/Sofia"); err == nil {
		return l
	}
	return time.UTC
}

var adminBody = template.Must(template.New("admin").Parse(`
<p>{{.Players}} играчи ({{.WithEmail}} с имейл). Днес въпросите на деня са изиграли {{.DayToday}}.
В банката: {{.Questions}} въпроса, {{.Live}} в игра.</p>

<h2>Връщат ли се</h2>
<p>Играли днес: {{.Active.Today}} · за 7 дни: {{.Active.Week}} · за 30 дни: {{.Active.Month}}.</p>
<p class="muted">Новите играчи по деня на първата им игра и колко от тях са играли пак точно толкова дни по-късно.
„Играл“ е отговорил на въпрос или изиграл Арена.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Ден</th><th class="num">Нови</th>{{range .After}}<th class="num">След {{.}} {{if eq . 1}}ден{{else}}дни{{end}}</th>{{end}}</tr></thead><tbody>
{{if .Cohorts}}<tr><td><strong>Общо</strong></td><td></td>{{range .Overall}}<td class="num">{{if .Due}}—{{else}}<strong>{{.Share}}%</strong>{{end}}</td>{{end}}</tr>{{end}}
{{range .Cohorts}}<tr><td class="num">{{.Day}}</td><td class="num">{{.New}}</td>{{range .Cells}}<td class="num">{{if .Due}}—{{else}}{{.Back}} · {{.Share}}%{{end}}</td>{{end}}</tr>
{{else}}<tr><td colspan="6" class="muted">Още няма нови играчи.</td></tr>{{end}}
</tbody></table></div>

<h2>Доклади ({{len .Reported}})</h2>
{{range .Reported}}
<section class="reviewed">
<p class="muted">{{.ID}} · {{.Category}}</p>
<h3>{{.Text}}</h3>
<p>Отговор: <strong>{{.Answer}}</strong></p>
<ul>{{range .Reports}}<li>{{.}}</li>{{end}}</ul>
<form method="post" action="/admin/reports/{{.ID}}/resolve"><button class="link">Прегледано</button></form>
</section>
{{else}}<p class="muted">Няма нови.</p>{{end}}

<h2>Най-трудните</h2>
<p class="muted">Въпроси с поне 10 отговора, по дела на верните.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Въпрос</th><th class="num">Отговори</th><th class="num">Верни</th></tr></thead><tbody>
{{range .Hardest}}<tr><td>{{.ID}} · {{.Text}}<br><span class="muted">{{.Answer}}{{if .Lure}} · най-често грешат с „{{.Lure}}“{{end}}</span></td>
<td class="num">{{.Answers}}</td><td class="num">{{.Share}}%</td></tr>{{else}}<tr><td colspan="3" class="muted">Още няма достатъчно отговори.</td></tr>{{end}}
</tbody></table></div>

<h2>Най-лесните</h2>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Въпрос</th><th class="num">Отговори</th><th class="num">Верни</th></tr></thead><tbody>
{{range .Easiest}}<tr><td>{{.ID}} · {{.Text}}<br><span class="muted">{{.Answer}}</span></td><td class="num">{{.Answers}}</td><td class="num">{{.Share}}%</td></tr>
{{else}}<tr><td colspan="3" class="muted">Още няма достатъчно отговори.</td></tr>{{end}}
</tbody></table></div>
`))
