package server

import (
	"bytes"
	"html/template"
	"net/http"

	"github.com/almanac-bg/almanac/internal/assets"
)

// /admin's pages, as they look: as wide as the game's pages, one column on a phone, the tables that scroll sideways
// fading at the edge they go on to. Its style is admin.css, loaded only here.

// adminSections are /admin's parts, as its menu names them: on /admin, but the questions, on a page of their own.
var adminSections = []struct{ ID, Name string }{
	{"days", "По дни"}, {"players", "Играчи"},
}

var adminFrame = template.Must(template.New("admin-page").Parse(`<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}} · АЛМАНАХ</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
{{if .CSS}}<link rel="stylesheet" href="/{{.CSS}}">{{end}}
{{if .AdminCSS}}<link rel="stylesheet" href="/{{.AdminCSS}}">{{end}}
</head>
<body>
<div id="app" class="admin-app">
<header class="frame"><div class="bar"><a class="brand" href="/"><svg class="rosette" viewBox="5 5 54 54" aria-hidden="true"><path class="petal gold" d="M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z" transform="rotate(-45 32 32)"/><path class="petal" d="M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z" transform="rotate(45 32 32)"/><path class="petal" d="M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z" transform="rotate(135 32 32)"/><path class="petal" d="M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z" transform="rotate(225 32 32)"/></svg>АЛМАНАХ</a><nav class="places" aria-label="Основно"><a href="/">Днес</a><a href="/almanac">Алманах</a><a href="/friends">Приятели</a></nav></div></header>
<main class="admin">
<h1>{{.Title}}</h1>
<nav class="admin-nav" aria-label="Части">{{range .Sections}}<a href="/admin#{{.ID}}">{{.Name}}</a>{{end}}<a href="/admin/questions"{{if eq $.Title "Въпроси"}} aria-current="page"{{end}}>Въпроси</a></nav>
{{.Body}}
</main>
</div>
</body>
</html>
`))

// adminPage sends one of /admin's pages.
func (s *Server) adminPage(w http.ResponseWriter, title string, body template.HTML) {
	var out bytes.Buffer
	m := assets.Manifest(s.client)
	if err := adminFrame.Execute(&out, map[string]any{
		"Title": title, "Body": body, "CSS": m["app.css"], "AdminCSS": m["admin.css"], "Sections": adminSections,
	}); err != nil {
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", private)
	w.Header().Set("Vary", "Cookie")
	_, _ = w.Write(out.Bytes())
}

var adminBody = template.Must(template.New("admin").Funcs(template.FuncMap{"n": sayInt}).Parse(`
<p>{{n .Players}} {{if eq .Players 1}}играч{{else}}играча{{end}} ({{n .WithEmail}} с имейл). Днес броя на деня са изиграли докрай {{n .DayToday}}.{{if .DayScripted}}
По-бързо, отколкото играе човек: {{n .DayScripted}} (другите не ги виждат).{{end}}
В банката: {{n .Questions}} въпроса, {{n .Live}} в игра.</p>

<section class="admin-section" id="days">
<h2>По дни</h2>
<p class="muted">Играч тук е човек: отговорил на въпрос с човешка скорост, без тези, които водят играта. Нови: играли
за първи път този ден. Играли: отговорили на поне един въпрос в коя да е игра, не само в броя. След 1, 7 и 30 дни:
колко от новите са играли пак точно тогава. Споделени: колко резултата от броя на този ден са споделени с връзка.
Нови по връзка: колко нови са изиграли първата си игра, броя на деня, по споделена връзка (пазим само
числото за деня, не кои са).</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Ден</th><th class="num">Играли</th><th class="num">Нови</th><th class="num">Споделени</th><th class="num">Нови по връзка</th><th class="num">След 1 ден</th><th class="num">След 7 дни</th><th class="num">След 30 дни</th></tr></thead><tbody>
{{range .Days}}<tr><td>{{.Day}}</td><td class="num">{{n .Played}}</td><td class="num">{{n .New}}</td><td class="num">{{n .Shared}}</td><td class="num">{{n .ByLink}}</td>{{range .Back}}<td class="num">{{.}}</td>{{end}}</tr>{{end}}
</tbody></table></div>
</section>
`))

var adminQuestionsBody = template.Must(template.New("admin-questions").Funcs(template.FuncMap{"withWord": withWord, "n": sayInt}).Parse(`
<section class="admin-section" id="reports">
<h2>Доклади ({{.ReportsOpen}} за {{.QuestionsReported}} {{if eq .QuestionsReported 1}}въпрос{{else}}въпроса{{end}})</h2>
{{if gt .QuestionsReported (len .Reported)}}<p class="muted">Тук са последно докладваните {{len .Reported}}. Другите се
показват, щом тези бъдат прегледани.</p>{{end}}
<div class="reports">
{{range .Reported}}
<section class="reviewed">
<p class="muted">{{.ID}} · {{.Category}}</p>
<h3>{{.Text}}</h3>
<p>Отговор: <strong>{{.Answer}}</strong></p>
<ul>{{range .Reports}}<li>{{.Line}}{{if .Player}} <form method="post"
action="/admin/players/{{.Player}}/reports/resolve"><button class="link">Всички от този играч: прегледани</button></form>{{end}}</li>{{end}}</ul>
{{if gt .More 0}}<p class="muted">И още {{.More}}.</p>{{end}}
<form method="post" action="/admin/reports/{{.ID}}/resolve"><button class="link">Прегледано</button></form>
</section>
{{else}}<p class="muted">Няма нови.</p>{{end}}
</div>
</section>

<section class="admin-section" id="suspects">
<h2>Под съмнение ({{n .SuspectsAll}})</h2>
<p class="muted">Въпроси, при които отговорите на играчите говорят срещу верния отговор: грешен избор, който събира
повече от верния; твърдение, за което повечето казват обратното; число, което повечето пишат далеч на една страна.
Провери ги по източник.{{if gt .SuspectsAll (len .Suspects)}} Тук са {{len .Suspects}} с най-много отговори.{{end}}</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Въпрос</th><th class="num">Отговори</th></tr></thead><tbody>
{{range .Suspects}}<tr><td>{{.ID}} · {{.Text}}<br><span class="muted">{{.Answer}} · {{.Says}}</span></td><td class="num">{{n .Answers}}</td></tr>
{{else}}<tr><td colspan="2" class="muted">Няма.</td></tr>{{end}}
</tbody></table></div>
</section>

<div class="admin-pair">
<section class="admin-section" id="hardest">
<h2>Най-трудните</h2>
<p class="muted">Въпроси с поне 10 отговора, по дела на верните.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Въпрос</th><th class="num">Отговори</th><th class="num">Верни</th></tr></thead><tbody>
{{range .Hardest}}<tr><td>{{.ID}} · {{.Text}}<br><span class="muted">{{.Answer}}{{if .Lure}} · грешат най-често {{withWord .Lure}}{{end}}</span></td>
<td class="num">{{n .Answers}}</td><td class="num">{{.Share}}&nbsp;%</td></tr>{{else}}<tr><td colspan="3" class="muted">Още няма достатъчно отговори.</td></tr>{{end}}
</tbody></table></div>
</section>

<section class="admin-section" id="easiest">
<h2>Най-лесните</h2>
<p class="muted">Въпроси с поне 10 отговора, по дела на верните.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Въпрос</th><th class="num">Отговори</th><th class="num">Верни</th></tr></thead><tbody>
{{range .Easiest}}<tr><td>{{.ID}} · {{.Text}}<br><span class="muted">{{.Answer}}</span></td><td class="num">{{n .Answers}}</td><td class="num">{{.Share}}&nbsp;%</td></tr>
{{else}}<tr><td colspan="3" class="muted">Още няма достатъчно отговори.</td></tr>{{end}}
</tbody></table></div>
</section>
</div>

{{if .TimedOut}}<section class="admin-section" id="clock">
<h2>Изтекло време</h2>
<p class="muted">Отговори, за които времето е изтекло, по вид въпрос, за 28 дни: трябва да са под 2 %.</p>
<div class="table-scroll"><table class="admin-table"><tbody>
{{range .TimedOut}}<tr><td>{{.Name}}</td><td class="num">{{.Share}}</td></tr>{{end}}
</tbody></table></div>
</section>{{end}}
`))
