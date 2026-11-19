package server

import (
	"bytes"
	"html/template"
	"net/http"

	"github.com/almanac-bg/almanac/internal/assets"
)

// /admin's pages, as they look: wide on a desktop (a grid of the numbers at the top, the charts side by side), one
// column on a phone (the numbers first, the long tables folded, and those that scroll sideways fading at the edge they
// go on to). Its style is admin.css, loaded only here.

// adminSections are /admin's parts, as its menu names them: on /admin, but the questions, on a page of their own.
var adminSections = []struct{ ID, Name string }{
	{"reminders", "Напомняния"}, {"back", "Връщане"}, {"path", "Път"}, {"habit", "Навик"}, {"streaks", "Серии"},
	{"fair", "Честна игра"}, {"notices", "Известия"}, {"games", "Игри"}, {"divisions", "Дивизии"}, {"players", "Играчи"},
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
<header class="top"><a class="name" href="/"><img class="mark" src="/favicon.svg" alt="" width="32" height="32">АЛМАНАХ</a><nav class="tabs" aria-label="Основно"><a href="/">Начало</a><a href="/friends">Приятели</a><a href="/ranks">Класации</a><a href="/me">Профил</a></nav></header>
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

var adminBody = template.Must(template.New("admin").Parse(`
{{with .M}}<div class="tiles">{{range .Tiles}}<div class="tile"><p class="tile-name">{{.Name}}</p>
<p class="tile-value">{{if .Rate}}{{.Rate.HTML}}{{else}}{{.Value}}{{end}}</p>
<p class="tile-was">Преди 4 седмици: {{.Was}}</p>{{if .Note}}<p class="tile-note">{{.Note}}</p>{{end}}</div>{{end}}</div>{{end}}

<p>{{.Players}} играчи ({{.WithEmail}} с имейл). Днес въпросите на деня са изиграли {{.DayToday}}.{{if .DayScripted}}
По-бързо, отколкото играе човек: {{.DayScripted}} (другите не ги виждат).{{end}}
В банката: {{.Questions}} въпроса, {{.Live}} в игра. Роял: {{if .Royal.Nightly}}всяка вечер{{else}}петък, събота и
неделя{{end}}; медиана на играчите за последните {{.Royal.Evenings}} вечери: {{.RoyalMedian}} (всяка вечер, щом е поне
{{.RoyalTurnout}} за {{.RoyalEvenings}} вечери).</p>
<p class="muted">Играч тук е човек: отговорил на въпрос с човешка скорост, без администраторите. Гостите, изиграли деня
за проба преди своя, са вътре: иначе новите изглеждат по-верни, отколкото са. Под всеки дял: колко от колко и между
какви стойности е с 90 % сигурност. Разлика в рамките на тези стойности може да е случайна. В сиво: под 20 души, малко
данни.</p>

{{with .M}}
<section class="admin-section" id="reminders">
<h2>Помагат ли напомнянията</h2>
<p class="muted">{{.HoldoutShare}} % от играчите, избрани по жребий, не получават известието за деня и писмото за
прекъсната серия: пазим само кога щяха да ги получат. Напомнянето по имейл не е в опита: идва при всеки, който го
поиска. Ако интервалите на двете групи не се застъпват, разликата е от напомнянията. Броим по играч, затова интервалът
е толкова тесен, колкото позволяват играчите, а не напомнянията: при малко играчи ще е широк месеци наред.
{{if .HoldoutFrom}}От {{.HoldoutFrom}}{{else}}От началото на опита{{end}}, без днешния ден.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th><th class="num">Получили</th><th class="num">Без напомняне</th></tr></thead><tbody>
{{range .Holdout}}<tr><td>{{.Name}}</td><td class="num">{{.Sent.HTML}}</td><td class="num">{{.Held.HTML}}</td></tr>{{end}}
</tbody></table></div>
</section>

<section class="admin-section" id="back">
<h2>Връщане</h2>
<div class="charts">{{.PlayersChart}}{{.CohortChart}}{{.Curve}}</div>
<details><summary>Играли на ден, като таблица</summary>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Ден</th><th class="num">Играли</th><th class="num">Завършили деня</th></tr></thead><tbody>
{{range .ChartRows}}<tr><td class="num">{{.Day}}</td><td class="num">{{.Played}}</td><td class="num">{{.DayFinished}}</td></tr>{{end}}
</tbody></table></div></details>

<h3>По седмицата на първия ден</h3>
<p class="muted">Новите и делът от тях, играли пак в прозореца след първия си ден (ден 0); „Денят пак“: от завършилите
деня на първия си ден, които са го завършили пак до 7-ия. Делът е от тези, за които прозорецът е минал. Без играчите,
изиграли на първия си ден само стая: те са отделно, в „Кои се връщат“. Седмица с ✓ е замразена: числата ѝ не се
променят вече. „Средно“: всяка колона е от седмиците, за които е минала, затова не са от едни и същи играчи.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Седмица</th><th class="num">Нови</th>{{range .CohortHeads}}<th class="num">{{.}}</th>{{end}}</tr></thead><tbody>
{{with .Overall}}{{if .New}}<tr class="total"><td>{{.Name}}</td><td class="num">{{.New}}</td>{{range .Rates}}<td class="num">{{.HTML}}</td>{{end}}</tr>{{end}}{{end}}
{{range .Cohorts}}<tr><td class="num">{{.Name}}{{if .Frozen}} <span class="frozen" title="Замразени: не се променят вече">✓</span>{{end}}</td><td class="num">{{.New}}</td>{{range .Rates}}<td class="num">{{.HTML}}</td>{{end}}</tr>
{{else}}<tr><td colspan="7" class="muted">Още няма нови играчи.</td></tr>{{end}}
</tbody></table></div>

<h3>Седмица по седмица</h3>
<p class="muted">Играчите на всяка седмица: нови (първият им ден е в нея), останали (играли и предната), върнали се (след
седмица или повече без игра); и загубени: играли предната седмица, а в тази не. Играят на ден средно {{.Stick}} от
играещите за последните 28 дни.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Седмица</th><th class="num">Играли</th><th class="num">Нови</th><th class="num">Останали</th><th class="num">Върнали се</th><th class="num">Загубени</th></tr></thead><tbody>
{{range .Growth}}<tr><td class="num">{{.Week}}</td><td class="num">{{.Played}}</td><td class="num">{{.New}}</td><td class="num">{{.Kept}}</td><td class="num">{{.Back}}</td><td class="num">{{.Lost}}</td></tr>{{end}}
</tbody></table></div>

<h3>Кои се връщат</h3>
<p class="muted">Новите от последните 12 седмици, според първия им ден.</p>
{{range .Splits}}{{if .Rows}}
<details><summary>{{.Name}}</summary>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th><th class="num">Нови</th>{{range $.M.CohortHeads}}<th class="num">{{.}}</th>{{end}}</tr></thead><tbody>
{{range .Rows}}<tr><td>{{.Name}}</td><td class="num">{{.New}}</td>{{range .Rates}}<td class="num">{{.HTML}}</td>{{end}}</tr>{{end}}
</tbody></table></div></details>
{{end}}{{end}}
</section>

<section class="admin-section" id="path">
<h2>Път на новия играч</h2>
<p class="muted">По седмицата (от понеделник) на първия ден. Посещенията и започналите игра са от същата седмица; гост от
предишна може да изиграе въпрос в тази, затова дял над 100 % се показва като 100 %. Оттам нататък делът е от изигралите
въпрос (без тези само в стая), за които денят вече е минал.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th>{{range .Weeks}}<th class="num">{{.}}</th>{{end}}</tr></thead><tbody>
{{range .Funnel}}<tr><td>{{if .Sub}}<span class="muted">·</span> {{end}}{{.Step}}</td>{{range .Cells}}<td class="num">{{.}}</td>{{end}}</tr>{{end}}
</tbody></table></div>
</section>

{{end}}

<div class="admin-side">
{{with .M}}
<section class="admin-section" id="habit">
<h2>Навик</h2>
<p>Завършили деня в поне 3 от последните 7 дни: <strong>{{.Habit}}</strong> от {{.HabitOf}} играли в тези дни.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th><th class="num">7 дни</th><th class="num">28 дни</th></tr></thead><tbody>
{{range .Loop}}<tr><td>{{if .Sub}}<span class="muted">·</span> {{end}}{{.Name}}</td><td class="num">{{.Week}}</td><td class="num">{{.Month}}</td></tr>{{end}}
</tbody></table></div>
<p class="muted">Споделянето се брои веднъж на ден от устройство и само от завършил деня.</p>
<p>Отговори в деня на въпрос, на който играчът е отговарял преди, за 7 дни: {{.Repeats.HTML}} (трябва да е 0).</p>
</section>

<section class="admin-section" id="streaks">
<h2>Серии</h2>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Дължина</th><th class="num">Вървят сега</th><th class="num">Прекъснати за 7 дни</th></tr></thead><tbody>
{{range .Streaks}}<tr><td>{{.Band}}</td><td class="num">{{.Going}}</td><td class="num">{{.Ended}}</td></tr>{{end}}
</tbody></table></div>
<p>Резервни дни, похарчени за 7 дни: {{.Spent}}.</p>
</section>
{{end}}

<section class="admin-section" id="fair">
<h2>Честна игра</h2>
<p class="muted">Въпросите на деня, изиграни след поне двама гости от същата мрежа, създадени същия ден и изиграли само
деня: може да са пробвали отговорите. Дните на гостите вече не се виждат на другите (докато не се върнат); денят на
играча остава, щом не е скрит.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Ден</th><th>Играч</th><th class="num">Верни</th><th class="num">Гости</th><th class="num">Най-добрият гост</th><th>Скрит</th></tr></thead><tbody>
{{range .Fair}}<tr><td class="num">{{.Day}}</td><td><a href="/admin?player={{.Tag}}#players">{{.Name}}</a></td><td class="num">{{.Rights}}</td><td class="num">{{.Guests}}</td><td class="num">{{.Best}}</td><td>{{if .Shadow}}да{{else}}не{{end}}</td></tr>
{{else}}<tr><td colspan="6" class="muted">Няма.</td></tr>{{end}}
</tbody></table></div>
</section>
</div>

{{with .M}}
<section class="admin-section" id="notices">
<h2>Известия</h2>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th><th class="num">7 дни</th><th class="num">28 дни</th></tr></thead><tbody>
{{range .Notices}}<tr><td>{{if .Sub}}<span class="muted">·</span> {{end}}{{.Name}}</td><td class="num">{{.Week}}</td><td class="num">{{.Month}}</td></tr>{{end}}
</tbody></table></div>
</section>

<section class="admin-section" id="games">
<h2>Игри</h2>
<p class="muted">Игрите по вид, ден по ден. „Само денят“: от завършилите деня, които не са играли нищо друго.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Ден</th>{{range .Kinds}}<th class="num">{{.}}</th>{{end}}<th class="num">Само денят</th></tr></thead><tbody>
{{range .Games}}<tr><td class="num">{{.Day}}</td>{{range .Kinds}}<td class="num">{{.}}</td>{{end}}<td class="num">{{.Only.HTML}}</td></tr>{{end}}
</tbody></table></div>
<h3>Части на играта, 28 дни</h3>
<p class="muted">Колко от играещите за 28 дни са играли всяка, колко игри на играч, и дали новите, които са я играли през
първата си седмица, се връщат през втората повече от другите: връзка, не причина (който играе повече, пробва и повече).</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th><th class="num">Играли</th><th class="num">Игри на играч</th><th class="num">2-ра седмица: играли я</th><th class="num">не са я играли</th></tr></thead><tbody>
{{range .Features}}<tr><td>{{.Name}}</td><td class="num">{{.Players.HTML}}</td><td class="num">{{.PerPlayer}}</td><td class="num">{{.Used.HTML}}</td><td class="num">{{.NotUsed.HTML}}</td></tr>
{{else}}<tr><td colspan="5" class="muted">Няма игри.</td></tr>{{end}}
</tbody></table></div>
<h3>Устройства, 28 дни</h3>
<p class="muted">На какво е започната всяка игра. Роял и стаите не казват.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th></th><th class="num">Играчи</th><th class="num">Игри</th><th class="num">Започнат ден, завършен</th></tr></thead><tbody>
{{range .Devices}}<tr><td>{{.Name}}</td><td class="num">{{.Players}}</td><td class="num">{{.Games}}</td><td class="num">{{.DayFinished.HTML}}</td></tr>
{{else}}<tr><td colspan="4" class="muted">Няма игри.</td></tr>{{end}}
</tbody></table></div>
</section>
{{end}}

<section class="admin-section" id="divisions">
<h2>Дивизии</h2>
<p class="muted">Играчите с определен рейтинг (поне 10 игри с рейтинг) по дивизии. Границите са сложени така, че около
една трета да е в Бронз, а средният играч в Сребро; ако делът се отмести много, границите се местят. Още се определя
рейтингът на {{.Placing}}.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Дивизия</th><th class="num">От рейтинг</th><th class="num">Играчи</th><th class="num">Дял</th></tr></thead><tbody>
{{range .Divisions}}<tr><td>{{.Name}}</td><td class="num">{{.From}}</td><td class="num">{{.Players}}</td><td class="num">{{.Share}}</td></tr>{{end}}
</tbody></table></div>
</section>

`))

var adminQuestionsBody = template.Must(template.New("admin-questions").Parse(`
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

<div class="admin-pair">
<section class="admin-section" id="hardest">
<h2>Най-трудните</h2>
<p class="muted">Въпроси с поне 10 отговора, по дела на верните.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Въпрос</th><th class="num">Отговори</th><th class="num">Верни</th></tr></thead><tbody>
{{range .Hardest}}<tr><td>{{.ID}} · {{.Text}}<br><span class="muted">{{.Answer}}{{if .Lure}} · най-често грешат с „{{.Lure}}“{{end}}</span></td>
<td class="num">{{.Answers}}</td><td class="num">{{.Share}}%</td></tr>{{else}}<tr><td colspan="3" class="muted">Още няма достатъчно отговори.</td></tr>{{end}}
</tbody></table></div>
</section>

<section class="admin-section" id="easiest">
<h2>Най-лесните</h2>
<p class="muted">Въпроси с поне 10 отговора, по дела на верните.</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th>Въпрос</th><th class="num">Отговори</th><th class="num">Верни</th></tr></thead><tbody>
{{range .Easiest}}<tr><td>{{.ID}} · {{.Text}}<br><span class="muted">{{.Answer}}</span></td><td class="num">{{.Answers}}</td><td class="num">{{.Share}}%</td></tr>
{{else}}<tr><td colspan="3" class="muted">Още няма достатъчно отговори.</td></tr>{{end}}
</tbody></table></div>
</section>
</div>
`))
