package server

import (
	"bytes"
	"fmt"
	"html/template"
	"net/http"
	"time"

	"github.com/almanac-bg/almanac/internal/assets"
)

// The server's own pages: plain HTML in the app's style, no script.
var plainPage = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}} · АЛМАНАХ</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
{{if .CSS}}<link rel="stylesheet" href="/{{.CSS}}">{{end}}
</head>
<body>
<div id="app">
<header class="top"><a class="name" href="/"><img class="mark" src="/favicon.svg" alt="" width="32" height="32">АЛМАНАХ</a><nav class="tabs" aria-label="Основно"><a href="/">Начало</a><a href="/friends">Приятели</a><a href="/ranks">Класации</a><a href="/me">Профил</a></nav></header>
<main class="screen prose">
<h1>{{.Title}}</h1>
{{.Body}}
</main>
</div>
</body>
</html>
`))

var privacyBody = template.Must(template.New("privacy").Parse(`
<p>АЛМАНАХ е безплатна игра с въпроси. Пазим само каквото ни трябва, за да работи, и нищо не продаваме: няма
реклами, няма проследяване, няма чужди скриптове.</p>

<h2>Кой</h2>
<p>Играта се поддържа от {{.Operator}}. За всичко, което засяга данните ти, пиши на <a href="mailto:{{.Contact}}">{{.Contact}}</a>.</p>

<h2>Какво пазим и защо</h2>
<ul>
<li><strong>Името и потребителското ти име в играта</strong> — името за класациите; потребителското име (@…) е само
твое и по него приятелите те намират.</li>
<li><strong>Имейлът ти</strong>, ако го добавиш — за кода за вход. И ако не получаваш известия на никое устройство, за едно
писмо, когато серия от 5 дни или повече прекъсне: най-много едно на 30 дни. Спираш го с връзката в самото писмо или от
Профил → Настройки → Известия. Друго не пращаме.</li>
<li><strong>Игрите ти</strong>: кои въпроси ти се паднаха, какво отговори и за колко време — за резултатите,
серията и класациите, и за да виждаме кои въпроси са лесни, трудни или сгрешени.</li>
<li><strong>Откъде дойде първия път</strong> — началната страница, покана, стая, споделен резултат или приложението:
за да виждаме какво води нови играчи. Другото, което броим (колко пъти е споделен денят, колко известия са отворени),
е само общ брой за деня, без да знаем кой.</li>
<li><strong>Приятелите ти</strong> — с кого сте приятели в играта, за списъка „Приятели“, класацията на приятелите и
дуелите помежду ви. Приятелите ти виждат името и потребителското ти име, резултата ти за деня и дуелите ви.</li>
<li><strong>Поканите за приятелство</strong> — всяка покана, която пращаш (по потребителско име или имейл), докато някой я приеме
или откаже. Покана по имейл чака този, който има адреса или влезе с него по-късно; на теб не казваме дали има такъв
играч, а на него показваме само името и потребителското ти име. Не пращаме писма на никого.</li>
<li><strong>Постиженията, аватарът и титлата ти</strong> — постигнатото в играта и видът ти в нея.
Аватарът, титлата и нивото ти се виждат до името ти в класациите, в стаите и при приятелите ти.</li>
<li><strong>Известията</strong>, ако ги включиш — адресът, на който браузърът ти ги получава. Пращаме ги шифровани през
услугата за известия на браузъра (на Google, Apple или Mozilla): тя не вижда какво пише в тях. В приложението за
телефон пазим адреса на телефона при Apple (на iPhone) или при Google (Firebase, на Android): те доставят известието
и виждат текста му. Спреш ли ги, адресът се изтрива.</li>
<li><strong>Една бисквитка</strong> — тази, с която оставаш в профила си. Друга няма.</li>
<li><strong>Технически записи</strong> (IP адрес, адрес на заявката, време) — до 14 дни, за да пазим играта от
злоупотреби и да оправяме грешки.</li>
</ul>
<p>Основанието е, че без тези данни играта не може да работи (чл. 6, ал. 1, б. „б“ от Общия регламент относно защитата на данните), а за
техническите записи и писмото при прекъсната серия — законният ни интерес да пазим играта от злоупотреби и да ти напомним за серията (б. „е“).</p>

<h2>Колко дълго</h2>
<p>Докато имаш профил. Профил на гост без имейл изчезва, щом сесията му изтече (400 дни без игра).
Резервните копия на базата данни се подменят до месец.</p>

<h2>Кой още ги вижда</h2>
<ul>
<li>Hetzner (Германия) — сървърът, на който работи играта.</li>
<li>Cloudflare — мрежата пред сървъра и резервните копия, в ЕС.</li>
<li>Scaleway (Франция) — изпраща имейлите.</li>
<li>Apple и Google — доставят известията в приложението на телефона, ако ги включиш там.</li>
</ul>

<h2 id="delete">Изтриване на профила</h2>
<p>В играта, на сайта или в приложението АЛМАНАХ: <a href="/settings">Профил → Настройки → Изтрий профила</a>, после
потвърди. Изчезват веднага името, имейлът, игрите, приятелствата, постиженията и известията ти; от резервните копия —
до месец. Ако не можеш да влезеш, пиши на <a href="mailto:{{.Contact}}">{{.Contact}}</a> от имейла на профила и ще го
изтрием ние.</p>

<h2>Правата ти</h2>
<p>Можеш да поискаш копие от данните си, да ги поправиш или изтриеш и да възразиш срещу обработването им.
За всичко пиши ни. Ако смяташ, че нещо не е наред, можеш да подадеш жалба до Комисията за защита на
личните данни (<a href="https://www.cpdp.bg">cpdp.bg</a>).</p>

<p class="muted">Последна промяна: 16 ноември 2026 г.</p>
`))

func (s *Server) privacy(w http.ResponseWriter, r *http.Request) {
	var body bytes.Buffer
	_ = privacyBody.Execute(&body, map[string]string{"Operator": s.cfg.Operator, "Contact": s.cfg.Contact})
	s.plain(w, "Какво пазим и защо", template.HTML(body.String()))
}

func (s *Server) plain(w http.ResponseWriter, title string, body template.HTML) {
	var out bytes.Buffer
	if err := plainPage.Execute(&out, map[string]any{
		"Title": title, "Body": body, "CSS": assets.Manifest(s.client)["app.css"],
	}); err != nil {
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(out.Bytes())
}

// securityTxt says where to report a vulnerability (RFC 9116). Its expiry moves with each day, so it never lapses.
func (s *Server) securityTxt(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	fmt.Fprintf(w, "Contact: https://github.com/almanac-bg/almanac/security/advisories/new\nContact: mailto:%s\n"+
		"Expires: %s\nPreferred-Languages: bg, en\nCanonical: %s/.well-known/security.txt\n",
		s.cfg.Contact, time.Now().AddDate(1, 0, 0).UTC().Format(time.RFC3339), s.cfg.PublicURL)
}
