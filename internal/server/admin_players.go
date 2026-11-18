package server

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"html/template"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
)

// Players on /admin: whoever keeps the game finds a player by their tag, and puts a name that pretends or offends
// back to a drawn one (name and tag both: account.ResetName), or suspends the player (account.Suspend: signed out
// everywhere, and no sign-in after) and lifts it. The page lists the players suspended, and those whose name or tag
// reads as the game's own (account.Reserved), as names chosen before the check came in may still.

// adminPlayer is a player as /admin shows them.
type adminPlayer struct {
	ID              int64
	Name, Tag       string
	Since           string
	Email, Admin    bool
	Suspended       string // since when, if they are
	Reserved, Drawn bool
}

// adminPlayers is the players' part of /admin: the one asked for (?player=tag), and the lists.
type adminPlayers struct {
	Query     string
	Player    *adminPlayer
	Missing   bool
	Suspended []adminPlayer
	Reserved  []adminPlayer
}

// adminPlayersOf finds what the players' part of /admin shows.
func (s *Server) adminPlayersOf(ctx context.Context, query string) adminPlayers {
	out := adminPlayers{Query: query}
	db := s.db.Read
	day := func(ms int64) string { return time.UnixMilli(ms).In(bulgaria()).Format("02.01.2006") }
	one := func(row *sql.Row) (adminPlayer, error) {
		var p adminPlayer
		var since int64
		var suspended sql.NullInt64
		err := row.Scan(&p.ID, &p.Name, &p.Tag, &since, &p.Email, &p.Admin, &suspended)
		p.Since = day(since)
		if suspended.Valid {
			p.Suspended = day(suspended.Int64)
		}
		p.Reserved = account.Reserved(p.Name) || account.Reserved(p.Tag)
		p.Drawn = account.User{ID: p.ID, Name: p.Name}.Drawn()
		return p, err
	}
	const columns = `SELECT u.id, u.name, u.tag, u.created_at, u.email IS NOT NULL, u.admin, s.at FROM users u
		LEFT JOIN suspensions s ON s.user_id = u.id`
	if query != "" {
		if tag, err := account.NormalTag(query); err == nil {
			p, err := one(db.QueryRowContext(ctx, columns+` WHERE u.tag = ?`, tag))
			if err == nil {
				out.Player = &p
			} else if !errors.Is(err, sql.ErrNoRows) {
				slog.Error("admin: a player", "err", err)
			}
		}
		out.Missing = out.Player == nil
	}
	if rows, err := db.QueryContext(ctx, `SELECT user_id FROM suspensions ORDER BY at DESC LIMIT 100`); err == nil {
		var ids []int64
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
		for _, id := range ids {
			if p, err := one(db.QueryRowContext(ctx, columns+` WHERE u.id = ?`, id)); err == nil {
				out.Suspended = append(out.Suspended, p)
			}
		}
	}
	// Every name and tag looked at here, not in SQL: the skeletons are Go's. Admins may take such names.
	if rows, err := db.QueryContext(ctx, `SELECT id, name, tag FROM users WHERE NOT admin`); err == nil {
		var ids []int64
		for rows.Next() {
			var id int64
			var name, tag string
			if rows.Scan(&id, &name, &tag) == nil && (account.Reserved(name) || account.Reserved(tag)) && len(ids) < 100 {
				ids = append(ids, id)
			}
		}
		rows.Close()
		for _, id := range ids {
			if p, err := one(db.QueryRowContext(ctx, columns+` WHERE u.id = ?`, id)); err == nil {
				out.Reserved = append(out.Reserved, p)
			}
		}
	}
	return out
}

// adminPlayerAct is what whoever keeps the game does to a player (/admin/players/{id}/{act}): a drawn name, suspend,
// unsuspend. Then back to the player on /admin.
func (s *Server) adminPlayerAct(w http.ResponseWriter, r *http.Request) {
	u, err := s.user(r)
	if err != nil || u == nil || !u.Admin {
		http.NotFound(w, r)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ctx := r.Context()
	var admin bool
	if err := s.db.Read.QueryRowContext(ctx, `SELECT admin FROM users WHERE id = ?`, id).Scan(&admin); err != nil {
		http.NotFound(w, r)
		return
	}
	switch r.PathValue("act") {
	case "name":
		_, _, err = s.accounts.ResetName(ctx, id)
	case "suspend":
		if admin { // nobody locks out whoever keeps the game, by a slip either
			http.Error(w, "Профил на администратор не се спира.", http.StatusConflict)
			return
		}
		err = s.accounts.Suspend(ctx, id)
	case "unsuspend":
		err = s.accounts.Unsuspend(ctx, id)
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		slog.Error("admin: a player", "id", id, "act", r.PathValue("act"), "err", err)
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	slog.Info("admin: a player", "id", id, "act", r.PathValue("act"), "by", u.ID)
	var tag string
	_ = s.db.Read.QueryRowContext(ctx, `SELECT tag FROM users WHERE id = ?`, id).Scan(&tag)
	http.Redirect(w, r, "/admin?player="+url.QueryEscape(tag)+"#players", http.StatusSeeOther)
}

// adminPlayersHTML is the players' part of /admin, drawn.
func adminPlayersHTML(p adminPlayers) template.HTML {
	var b bytes.Buffer
	if err := adminPlayersBody.Execute(&b, p); err != nil {
		slog.Error("admin: players", "err", err)
	}
	return template.HTML(b.String())
}

var adminPlayersBody = template.Must(template.New("players").Parse(`
<h2 id="players">Играчи</h2>
<p class="muted">Име, което се представя за играта, за някого от нея или обижда: смени го с изтеглено (името и
потребителското име). Играч, който злоупотребява: спри профила (излиза навсякъде и не може да влезе).</p>
<form method="get" action="/admin#players" class="admin-find"><label class="field"><span>Потребителско име</span>
<input name="player" value="{{.Query}}" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
<button class="btn inline">Намери</button></form>
{{define "player"}}<strong>{{.Name}}</strong> <span class="muted">@{{.Tag}} · от {{.Since}} · {{if .Email}}с имейл{{else}}гост{{end}}{{if .Admin}} · администратор{{end}}{{if .Suspended}} · спрян от {{.Suspended}}{{end}}</span>{{end}}
{{with .Player}}
<section class="reviewed">
<p>{{template "player" .}}</p>
{{if .Reserved}}<p class="bad">Името или потребителското име прилича на името на играта.</p>{{end}}
{{if not .Drawn}}<form method="post" action="/admin/players/{{.ID}}/name"><button class="link">Смени името с изтеглено</button></form>{{end}}
{{if .Suspended}}<form method="post" action="/admin/players/{{.ID}}/unsuspend"><button class="link">Възстанови профила</button></form>
{{else if not .Admin}}<form method="post" action="/admin/players/{{.ID}}/suspend"><button class="link">Спри профила</button></form>{{end}}
</section>
{{end}}
{{if .Missing}}<p class="muted">Няма играч с такова потребителско име.</p>{{end}}
<h3>Имена като на играта ({{len .Reserved}})</h3>
{{range .Reserved}}<p>{{template "player" .}} <a href="/admin?player={{.Tag}}#players">Отвори</a></p>
{{else}}<p class="muted">Няма.</p>{{end}}
<h3>Спрени профили ({{len .Suspended}})</h3>
{{range .Suspended}}<p>{{template "player" .}} <a href="/admin?player={{.Tag}}#players">Отвори</a></p>
{{else}}<p class="muted">Няма.</p>{{end}}
`))
