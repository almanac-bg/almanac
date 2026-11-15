package server

import (
	"bytes"
	"cmp"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"slices"
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
		Players, WithEmail, DayToday, DayScripted, Questions, Live int
		Active                                                     play.Active
		After                                                      []int
		Cohorts                                                    []cohort
		Overall                                                    []cell
		Reported                                                   []reported
		Hardest, Easiest                                           []stat
		Daily                                                      string
		First                                                      firstWeek
		Royal                                                      play.RoyalPace
		RoyalMedian                                                string
		RoyalTurnout, RoyalEvenings                                int
	}{Questions: len(b.Questions), Live: len(b.Live("", "")), After: play.RetentionDays,
		RoyalTurnout: play.RoyalTurnout, RoyalEvenings: play.RoyalEvenings}
	today := s.game.Today()
	// How often Роял plays, and the turnout that decides it.
	data.Royal, _ = s.game.RoyalPaceOf(ctx)
	data.RoyalMedian = strings.TrimSuffix(strings.Replace(fmt.Sprintf("%.1f", data.Royal.Median), ".", ",", 1), ",0")
	if cohorts, active, err := s.game.Retention(ctx, play.RetentionDays[len(play.RetentionDays)-1]+10); err == nil {
		data.Active = active
		data.Daily = strings.Replace(fmt.Sprintf("%.1f", active.Daily), ".", ",", 1)
		if data.First, err = s.firstWeek(ctx, active); err != nil {
			slog.Error("admin: the first week", "err", err)
		}
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
	// The day's games by people, and apart those played at a script's speed, which nobody else sees (play/fair.go).
	_ = db.QueryRowContext(ctx, `SELECT count(*) FILTER (WHERE NOT scripted), count(*) FILTER (WHERE scripted) FROM runs
		WHERE kind = 'day' AND day = ? AND finished_at IS NOT NULL`, today).Scan(&data.DayToday, &data.DayScripted)

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
					rp.Category, rp.Text, rp.Answer = q.Base().Category, q.Base().Text, bank.KeeperText(q)
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

	// How each question goes, once enough have answered it to tell: the answers tallied here as they lie, in one
	// pass (a GROUP BY would have SQLite sort them all, twice, many times slower).
	type tally struct{ n, right, ms int }
	tallies := map[string]*tally{}
	if rows, err := db.QueryContext(ctx, `SELECT question_id, is_right, ms FROM answers WHERE `+play.FairAnswers); err == nil {
		var id []byte
		var right bool
		var ms int
		for rows.Next() {
			if rows.Scan(&id, &right, &ms) != nil {
				continue
			}
			t := tallies[string(id)] // no copy of the id for a lookup
			if t == nil {
				t = &tally{}
				tallies[string(id)] = t
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
		if db.QueryRowContext(ctx, `SELECT json_extract(given, '$.pick') p FROM answers WHERE question_id = ? AND given IS NOT NULL
			AND json_extract(given, '$.pick') > 0 AND `+play.FairAnswers+` GROUP BY p ORDER BY count(*) DESC LIMIT 1`, st.ID).Scan(&pick) == nil {
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
<p>{{.Players}} играчи ({{.WithEmail}} с имейл). Днес въпросите на деня са изиграли {{.DayToday}}.{{if .DayScripted}}
По-бързо, отколкото играе човек: {{.DayScripted}} (другите не ги виждат).{{end}}
В банката: {{.Questions}} въпроса, {{.Live}} в игра.</p>
<p>Роял: {{if .Royal.Nightly}}всяка вечер{{else}}петък, събота и неделя{{end}}. Медиана на играчите за последните
{{.Royal.Evenings}} вечери: {{.RoyalMedian}} (всяка вечер, щом е поне {{.RoyalTurnout}} за {{.RoyalEvenings}} вечери).</p>

<h2>Връщат ли се</h2>
<p>Играли днес: {{.Active.Today}} · за 7 дни: {{.Active.Week}} · за 30 дни: {{.Active.Month}}.
На ден, средно за последните 7: {{.Daily}} ({{.First.Stick}} от играещите за 30 дни).</p>
<p class="muted">Новите играчи по седмицата на първата им игра и колко от тях са играли пак точно толкова дни по-късно;
„1–7“: в който и да е от дните от 1-вия до 7-мия. „Играл“ е отговорил на въпрос. Делът е от тези, за които денят е минал.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Седмица</th><th class="num">Нови</th><th class="num">След 1 ден</th><th class="num">След 7 дни</th><th class="num">1–7</th><th class="num">След 30 дни</th></tr></thead><tbody>
{{with .First.Overall}}{{if .New}}<tr><td><strong>{{.Week}}</strong></td><td class="num">{{.New}}</td><td class="num">{{.D1}}</td><td class="num">{{.D7}}</td><td class="num">{{.Within}}</td><td class="num">{{.D30}}</td></tr>{{end}}{{end}}
{{range .First.Cohorts}}<tr><td class="num">{{.Week}}</td><td class="num">{{.New}}</td><td class="num">{{.D1}}</td><td class="num">{{.D7}}</td><td class="num">{{.Within}}</td><td class="num">{{.D30}}</td></tr>
{{else}}<tr><td colspan="6" class="muted">Още няма нови играчи.</td></tr>{{end}}
</tbody></table></div>
<details><summary>По дни</summary>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Ден</th><th class="num">Нови</th>{{range .After}}<th class="num">След {{.}} {{if eq . 1}}ден{{else}}дни{{end}}</th>{{end}}</tr></thead><tbody>
{{if .Cohorts}}<tr><td><strong>Общо</strong></td><td></td>{{range .Overall}}<td class="num">{{if .Due}}—{{else}}<strong>{{.Share}}%</strong>{{end}}</td>{{end}}</tr>{{end}}
{{range .Cohorts}}<tr><td class="num">{{.Day}}</td><td class="num">{{.New}}</td>{{range .Cells}}<td class="num">{{if .Due}}—{{else}}{{.Back}} · {{.Share}}%{{end}}</td>{{end}}</tr>
{{else}}<tr><td colspan="6" class="muted">Още няма нови играчи.</td></tr>{{end}}
</tbody></table></div>
</details>

{{with .First}}
<h2>Първата седмица</h2>
<p class="muted">Пътят на новия играч, по седмицата (от понеделник) на първия му ден. Посещенията и гостите са от
същата седмица; оттам нататък делът е от изигралите въпрос, за които денят вече е минал.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th>{{range .Weeks}}<th class="num">{{.}}</th>{{end}}</tr></thead><tbody>
{{range .Funnel}}<tr><td>{{.Step}}</td>{{range .Cells}}<td class="num">{{.}}</td>{{end}}</tr>{{end}}
</tbody></table></div>

<h2>Кои се връщат</h2>
<p class="muted">Новите от последните 12 седмици, според първия им ден.</p>
{{range .Splits}}{{if .Rows}}
<h3>{{.Name}}</h3>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th><th class="num">Нови</th><th class="num">След 1 ден</th><th class="num">След 7 дни</th><th class="num">1–7</th><th class="num">След 30 дни</th></tr></thead><tbody>
{{range .Rows}}<tr><td>{{.Week}}</td><td class="num">{{.New}}</td><td class="num">{{.D1}}</td><td class="num">{{.D7}}</td><td class="num">{{.Within}}</td><td class="num">{{.D30}}</td></tr>{{end}}
</tbody></table></div>
{{end}}{{end}}

<h2>Всеки ден</h2>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th><th class="num">7 дни</th><th class="num">28 дни</th></tr></thead><tbody>
{{range .Loop}}<tr><td>{{if .Sub}}<span class="muted">·</span> {{end}}{{.Name}}</td><td class="num">{{.Week}}</td><td class="num">{{.Month}}</td></tr>{{end}}
</tbody></table></div>
<p>Отговори в деня на въпрос, на който играчът е отговарял преди, за 7 дни: {{.Repeats}} (трябва да е 0).</p>

<h2>Серии</h2>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Дължина</th><th class="num">Вървят сега</th><th class="num">Прекъснати за 7 дни</th></tr></thead><tbody>
{{range .Streaks}}<tr><td>{{.Band}}</td><td class="num">{{.Going}}</td><td class="num">{{.Ended}}</td></tr>{{end}}
</tbody></table></div>
<p>Резервни дни, похарчени за 7 дни: {{.Spent}}.</p>

<h2>Игри</h2>
<p class="muted">Игрите по вид, без изиграните по-бързо, отколкото играе човек. „Само денят“: от завършилите деня, които не
са играли нищо друго. Стаите не се пазят и не са тук.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Ден</th>{{range .Kinds}}<th class="num">{{.}}</th>{{end}}<th class="num">Само денят</th></tr></thead><tbody>
{{range .Games}}<tr><td class="num">{{.Day}}</td>{{range .Kinds}}<td class="num">{{.}}</td>{{end}}<td class="num">{{.Only}}</td></tr>{{end}}
</tbody></table></div>
{{end}}

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
