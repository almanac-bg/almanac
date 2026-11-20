package seed

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

// player is one of the history's players: who they are, and how they play.
type player struct {
	id               int64
	name, tag, email string
	kind             string // devoted, regular, casual, tried, lapsed, newcomer; or a persona's key
	persona          string // the persona they are, if one

	joined int // the day they come (from 0)
	until  int // the last day they play (-1: to the end)
	rate   float64

	skill  float64       // the chance of a right answer to a medium question
	pace   time.Duration // how long an answer takes them, about
	hour   int           // when in the day they usually play
	topics float64       // topic games on a day they play, on average
	duels  float64       // live duels
	royal  float64       // the chance they come to an evening's Роял
	social float64       // how readily they make friends

	profile int // the day they give an email (-1: a guest throughout)
	named   bool
	from    string // where they first came in (play.Landings)
	device  string
	net     []byte
	circle  int // the group of people they know

	played map[int]bool // the days they played the day's ten
	last   int64        // their last game finished, its news not told yet
}

// The persona kinds, in the order they're printed.
const (
	keyGuest   = "guest"
	keyDay2    = "day2"
	keyRegular = "regular"
	keyLapsed  = "lapsed"
	keyLegend  = "legend"
	keyHost    = "host"
	keyAdmin   = "admin"

	// lapsing are those who might be the lapsed persona (cast).
	lapsing = "lapsing"
)

var personaKinds = []string{keyGuest, keyDay2, keyRegular, keyLapsed, keyLegend, keyHost, keyAdmin}

// cast draws the players: their kinds in a game's shares, then the personas (those of them played in the history).
func (w *world) cast(n int) {
	last := w.today()
	add := func(p *player) {
		p.played = map[int]bool{}
		w.nets++
		p.net = []byte(fmt.Sprintf("seed-net-%04d", w.nets))
		if p.device == "" {
			p.device = w.pickDevice()
		}
		if p.from == "" {
			p.from = w.pickLanding()
		}
		if p.pace == 0 { // the stronger the quicker, mostly
			p.pace = time.Duration(float64(12*time.Second)*(1.1-p.skill)) + w.between(0, 3*time.Second)
		}
		if p.hour == 0 {
			p.hour = []int{7, 8, 9, 12, 13, 17, 18, 19, 20, 21, 22}[w.r.IntN(11)]
		}
		p.circle = w.r.IntN(max(4, n/8))
		w.players = append(w.players, p)
	}
	// The personas played in the history (the new guest comes at the end: personas).
	add(&player{kind: keyDay2, persona: keyDay2, joined: last - 1, until: -1, rate: 1, skill: 0.6, topics: 0.6,
		profile: -1, from: "home", hour: 19})
	add(&player{kind: keyRegular, persona: keyRegular, joined: last - 29, until: -1, rate: 1, skill: 0.78, topics: 1.2,
		duels: 1.6, royal: 0.5, social: 1, profile: last - 26, named: true, hour: 8, pace: 6 * time.Second})
	add(&player{kind: keyLegend, persona: keyLegend, joined: 0, until: -1, rate: 1, skill: 0.95, topics: 1.5,
		duels: 6, royal: 0.9, social: 0.6, profile: 1, named: true, hour: 20, pace: 4 * time.Second})
	add(&player{kind: keyHost, persona: keyHost, joined: 3, until: -1, rate: 0.7, skill: 0.7, topics: 0.5, duels: 0.3,
		royal: 0.2, social: 1, profile: 4, named: true, hour: 18, from: "room"})
	add(&player{kind: keyAdmin, persona: keyAdmin, joined: 0, until: -1, rate: 0.9, skill: 0.7, topics: 0.8,
		duels: 0.5, royal: 0.3, social: 0.5, profile: 0, named: true, hour: 9})
	// Those who might be the lapsed one: streaks that end yesterday, by whichever reserve days they hold then; the
	// first whose streak did is the persona.
	for i := range 4 {
		add(&player{kind: lapsing, joined: last - 12 - 4*i, until: -1, rate: 1, skill: 0.62, topics: 0.4,
			duels: 0.3, social: 0.5, profile: last - 10, named: true, hour: 21})
	}
	// A few who never miss a day: the long streaks.
	for i := range 4 {
		add(&player{kind: "devoted", joined: i, until: -1, rate: 1, skill: 0.6 + 0.1*float64(i), topics: 0.8,
			duels: 1 + float64(i), royal: 0.7, social: 0.7, profile: i + 2, named: true})
	}
	for len(w.players) < n {
		p := &player{until: -1, profile: -1}
		switch x := w.r.Float64(); {
		case x < 0.06:
			p.kind, p.rate, p.topics, p.duels, p.royal = "devoted", 0.96, 1, 1.5, 0.6
			p.joined = w.r.IntN(12)
		case x < 0.28:
			p.kind, p.rate, p.topics, p.duels, p.royal = "regular", 0.8, 0.6, 0.6, 0.35
			p.joined = w.r.IntN(max(1, last-10))
		case x < 0.58:
			p.kind, p.rate, p.topics, p.duels, p.royal = "casual", 0.4, 0.4, 0.25, 0.1
			p.joined = w.r.IntN(last)
		case x < 0.80:
			p.kind, p.rate, p.topics, p.duels = "tried", 1, 0.4, 0.2
			p.joined = w.r.IntN(last)
			p.until = p.joined + w.r.IntN(3)
		case x < 0.92:
			p.kind, p.rate, p.topics, p.duels, p.royal = "lapsed", 0.85, 0.6, 0.5, 0.2
			p.joined = w.r.IntN(max(1, last-25))
			p.until = p.joined + 7 + w.r.IntN(max(1, last-p.joined-9))
		default:
			p.kind, p.rate, p.topics, p.duels = "newcomer", 0.9, 0.6, 0.3
			p.joined = last - w.r.IntN(5)
		}
		// Strength: most about the middle, a few strong, a few weak.
		p.skill = min(0.97, max(0.25, 0.6+0.17*w.r.NormFloat64()))
		p.social = w.r.Float64()
		if w.chance(map[string]float64{"devoted": 0.9, "regular": 0.7, "casual": 0.35, "tried": 0.05,
			"lapsed": 0.5, "newcomer": 0.2}[p.kind]) {
			p.profile = p.joined + w.r.IntN(4)
		}
		p.named = p.profile >= 0 || w.chance(0.3)
		add(p)
	}
}

func (w *world) pickDevice() string {
	switch x := w.r.Float64(); {
	case x < 0.72:
		return "phone"
	case x < 0.95:
		return "desktop"
	}
	return "tablet"
}

func (w *world) pickLanding() string {
	switch x := w.r.Float64(); {
	case x < 0.75:
		return "home"
	case x < 0.87:
		return "room"
	case x < 0.93:
		return "player"
	}
	return "other"
}

// arrive makes a player, as the game makes a guest the moment they first come (account.Accounts.Guest), on the clock's
// day; then the name they choose, if they do.
func (w *world) arrive(p *player) error {
	u, _, err := w.accounts.Guest(w.ctx)
	if err != nil {
		return err
	}
	p.id, p.name, p.tag = u.ID, u.Name, u.Tag
	w.byID[p.id] = p
	now := store.Ms(w.clock())
	if err := w.exec(`DELETE FROM sessions WHERE user_id = ?`, p.id); err != nil { // the persona's is made at the end
		return err
	}
	if err := w.exec(`UPDATE users SET created_at = ?, seen_at = ?, came_from = ? WHERE id = ?`,
		now, now, p.from, p.id); err != nil {
		return err
	}
	if err := w.g.Tally(w.ctx, "guest:"+p.from, 1); err != nil {
		return err
	}
	if p.named {
		w.name(p)
	}
	return nil
}

// name gives a player a name of their own and a tag to go with it, as they choose them (Rename, Retag).
func (w *world) name(p *player) {
	for range 20 {
		full, tag := w.drawName(p)
		name, err := w.accounts.Rename(w.ctx, p.id, full)
		if err != nil {
			continue
		}
		p.name = name
		for i := range 10 {
			t := tag
			if i > 0 {
				t = fmt.Sprintf("%s%d", tag, w.r.IntN(990)+10)
			}
			if got, err := w.accounts.Retag(w.ctx, p.id, t); err == nil {
				p.tag = got
				return
			}
		}
		return
	}
}

// email gives a player an email (their profile), on the clock's day: a guest who signs in, as the game keeps it.
func (w *world) email(p *player) error {
	p.email = fmt.Sprintf("%s@example.invalid", p.tag)
	return w.exec(`UPDATE users SET email = ? WHERE id = ?`, p.email, p.id)
}

var (
	firstNames = []string{"Иван", "Мария", "Георги", "Елена", "Димитър", "Десислава", "Николай", "Йордан", "Петя",
		"Стоян", "Радослава", "Калин", "Виктория", "Борислав", "Цветелина", "Пламен", "Гергана", "Христо", "Надежда",
		"Тодор", "Мила", "Асен", "Ралица", "Велизар", "Светлана", "Кирил", "Теодора", "Любомир", "Ивелина", "Мартин",
		"Божидар", "Анелия", "Росица", "Васил", "Зорница", "Емил", "Дарина", "Огнян", "Невена", "Ангел"}
	lastNames = []string{"Петров", "Иванова", "Георгиев", "Димитрова", "Николов", "Стоянова", "Тодоров", "Илиева",
		"Христов", "Василева", "Ангелов", "Колева", "Маринов", "Попова", "Костадинов", "Атанасова", "Йорданов",
		"Михайлова", "Константинов", "Христозова"}
	latinNames = []string{"Ivan Petrov", "Maria", "Georgi", "Niki", "Alex", "Dani", "Teddy", "Kris", "Viki", "Boby",
		"Martin Ivanov", "Elena K", "Stefan", "Joro", "Mimi"}
	longNames = []string{"Александра Константинова", "Христофор Колумб Българов", "Радостина Хаджиниколова",
		"Константин Великов-Попов", "Maximilian von Bulgarien"}
	nickNames = []string{"Бухалът", "Енциклопедия", "Мозъка", "Котето", "Фенерът", "Лудия учен", "Тихата вода", "Мечо",
		"Звездичка", "Капитанът"}
	translit = map[rune]string{'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ж': "zh", 'з': "z",
		'и': "i", 'й': "y", 'к': "k", 'л': "l", 'м': "m", 'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t",
		'у': "u", 'ф': "f", 'х': "h", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "sht", 'ъ': "a", 'ь': "y", 'ю': "yu",
		'я': "ya"}
)

// drawName is a name a player might choose, and a tag that goes with it: most a first name and a surname, some a
// first name with digits, a Latin name, a long one, a nickname.
func (w *world) drawName(p *player) (name, tag string) {
	pick := func(s []string) string { return s[w.r.IntN(len(s))] }
	switch x := w.r.Float64(); {
	case x < 0.45:
		first, last := pick(firstNames), pick(lastNames)
		if strings.HasSuffix(first, "а") || strings.HasSuffix(first, "я") {
			last = female(last)
		} else {
			last = male(last)
		}
		name = first + " " + last
	case x < 0.62:
		name = pick(firstNames)
	case x < 0.74:
		name = fmt.Sprintf("%s%d", pick(firstNames), []int{7, 13, 21, 77, 88, 99, 2009, 2011, 1985, 1994}[w.r.IntN(10)])
	case x < 0.86:
		name = pick(latinNames)
	case x < 0.92:
		name = pick(longNames)
	default:
		name = pick(nickNames)
	}
	if p.persona == keyLegend {
		name = "Енциклопедия"
	}
	return name, tagOf(name)
}

func male(last string) string {
	if strings.HasSuffix(last, "ова") || strings.HasSuffix(last, "ева") || strings.HasSuffix(last, "ина") {
		return strings.TrimSuffix(last, "а")
	}
	return last
}

func female(last string) string {
	if strings.HasSuffix(last, "ов") || strings.HasSuffix(last, "ев") || strings.HasSuffix(last, "ин") {
		return last + "а"
	}
	return last
}

// tagOf is a tag made from a name, in Latin letters.
func tagOf(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case translit[r] != "":
			b.WriteString(translit[r])
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			if s := b.String(); s != "" && !strings.HasSuffix(s, "_") {
				b.WriteRune('_')
			}
		}
	}
	tag := strings.Trim(b.String(), "_")
	if len(tag) > account.TagMax-3 {
		tag = strings.Trim(tag[:account.TagMax-3], "_")
	}
	if len(tag) < account.TagMin || tag[0] < 'a' || tag[0] > 'z' {
		tag = "player_" + tag
	}
	return tag
}

// circleOf are the players a player knows (their circle), who have come by now.
func (w *world) circleOf(p *player) []*player {
	var out []*player
	for _, o := range w.players {
		if o != p && o.id != 0 && o.circle == p.circle {
			out = append(out, o)
		}
	}
	return out
}

// active are the players who have come and still play, as of day i.
func (w *world) active(i int) []*player {
	return slices.DeleteFunc(slices.Clone(w.players), func(p *player) bool {
		return p.id == 0 || p.joined > i || (p.until >= 0 && i > p.until)
	})
}

// isPersona is whether a player is one of the personas, or might be (the lapsed one's candidates).
func (p *player) isPersona() bool { return p.persona != "" || p.kind == lapsing }

// level is a player's strength as the duels' pairing reads it.
func (w *world) rating(p *player) int {
	r := play.StartRating
	_ = w.one(&r, `SELECT rating FROM users WHERE id = ?`, p.id)
	return r
}
