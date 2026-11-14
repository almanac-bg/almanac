package play

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Titles: a few words worn under a player's name wherever they show („Мария Петрова · Нощна птица“). A title names
// the player — what kind of player they are: quick, steady, curious, hard to beat — never a deed: „Три поред“ is
// something done (an achievement); whoever keeps coming back every day for a month is „Желязна воля“.
//
// Every title fits anyone who wears it: it's a noun or a phrase with no masculine or feminine form („Светла глава“,
// „Твърд орех“), never „Отличник“ or „Шампион“. Only the achievements that say something about how a player plays
// give one; the rest come with a level, a Роял won, or a place on a season's podium, which counts how many times
// („Тройно злато“). Each has a tier, the colour it's worn in.

// Title is a title there is, and what unlocks it.
type Title struct {
	ID   string
	Name string
	Tier Tier
	by   unlock
}

// Titles are every title but the podium's, by tier and, in a tier, from the first a player is likely to earn.
var Titles = []Title{
	{"lightning", "Светкавица", Common, unlock{achieved: "fast"}},
	{"oneOfUs", "Свой човек", Common, unlock{level: 5}},

	{"straightA", "Пълна шестица", Rare, unlock{achieved: "perfect"}},
	{"eagleEye", "Орлово око", Rare, unlock{achieved: "exact"}},
	{"broadMind", "Широк кръгозор", Rare, unlock{achieved: "allTopics"}},
	{"soul", "Душа на компанията", Rare, unlock{achieved: "friends5"}},
	{"nightOwl", "Нощна птица", Rare, unlock{achieved: "nightOwl"}},
	{"earlyBird", "Ранна птичка", Rare, unlock{achieved: "earlyBird"}},
	{"steelNerves", "Железни нерви", Rare, unlock{achieved: "lastSecond"}},

	{"ironWill", "Желязна воля", Epic, unlock{achieved: "streak30"}},
	{"toughNut", "Твърд орех", Epic, unlock{achieved: "duel10"}},
	{"brightMind", "Светла глава", Epic, unlock{achieved: "master"}},
	{"swissKnife", "Швейцарско ножче", Epic, unlock{achieved: "allTypes"}},
	{"royalty", "Кралска особа", Epic, unlock{royal: 1}},
	{"oldGuard", "Стара гвардия", Epic, unlock{level: 25}},

	{"encyclopedia", "Ходеща енциклопедия", Legendary, unlock{achieved: "master5"}},
	{"winMachine", "Машина за победи", Legendary, unlock{achieved: "duel50"}},
	{"eternalFlame", "Неугасим пламък", Legendary, unlock{achieved: "streak100"}},
}

func titleByID(id string) (Title, bool) {
	i := slices.IndexFunc(Titles, func(t Title) bool { return t.ID == id })
	if i < 0 {
		return Title{}, false
	}
	return Titles[i], true
}

// TitleRef names a title: its id (to wear it), its name and its tier.
type TitleRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Tier Tier   `json:"tier"`
}

// titleFor is the title an achievement unlocks, if it unlocks one.
func titleFor(achievement string) *TitleRef {
	i := slices.IndexFunc(Titles, func(t Title) bool { return t.by.achieved == achievement })
	if i < 0 {
		return nil
	}
	t := Titles[i]
	return &TitleRef{t.ID, t.Name, t.Tier}
}

// titlesAtLevel are the titles a level from `from` (not included) to `to` unlocks.
func titlesAtLevel(from, to int) []TitleRef {
	var list []TitleRef
	for _, t := range Titles {
		if t.by.level > from && t.by.level <= to {
			list = append(list, TitleRef{t.ID, t.Name, t.Tier})
		}
	}
	return list
}

// TitleView is a title as a player may wear it: theirs, or locked with what unlocks it.
type TitleView struct {
	TitleRef
	Locked bool   `json:"locked,omitempty"`
	How    string `json:"how,omitempty"`
}

// podiumHow says what wins a place's title.
var podiumHow = [3]string{"първо място в сезон", "второ място в сезон", "трето място в сезон"}

// titles are every title, as a player with this wardrobe may wear them: the podium's first (named by how many times
// they're won), then the rest.
func (w wardrobe) titles() []TitleView {
	list := make([]TitleView, 0, len(w.podium)+len(Titles))
	for i, won := range w.podium {
		v := TitleView{TitleRef: TitleRef{ID: podiumTitleID(i + 1)}}
		v.Name, v.Tier = PodiumTitle(i+1, won)
		if won == 0 {
			v.Locked, v.How = true, podiumHow[i]
		}
		list = append(list, v)
	}
	for _, t := range Titles {
		v := TitleView{TitleRef: TitleRef{t.ID, t.Name, t.Tier}}
		if !w.has(t.by) {
			v.Locked, v.How = true, t.how()
		}
		list = append(list, v)
	}
	return list
}

// how says what unlocks a title, for whoever hasn't yet: an achievement's how (a hidden one isn't told), or the
// unlock's.
func (t Title) how() string {
	if t.by.achieved == "" {
		return t.by.how()
	}
	a, _ := achievementByID(t.by.achieved)
	if a.Hidden {
		return "скрито постижение"
	}
	first, n := utf8.DecodeRuneInString(a.About)
	return string(unicode.ToLower(first)) + a.About[n:]
}

// wears is whether a player with this wardrobe may wear a title: one of Titles they've unlocked, or a place on the
// podium they've won.
func (w wardrobe) wears(id string) bool {
	if t, ok := titleByID(id); ok {
		return w.has(t.by)
	}
	for place, n := range w.podium {
		if n > 0 && id == podiumTitleID(place+1) {
			return true
		}
	}
	return false
}

// TitleOf is the name a title is shown by, and its tier ("" for none): a title's id, or a place on a season's
// podium as lookColumns read it ("podium2:3": second, three times).
func TitleOf(id string) (string, Tier) {
	if rest, ok := strings.CutPrefix(id, "podium"); ok {
		p, n, _ := strings.Cut(rest, ":")
		place, _ := strconv.Atoi(p)
		times, _ := strconv.Atoi(n)
		if place < 1 || place > len(podiumTitles) || times < 1 {
			return "", ""
		}
		return PodiumTitle(place, times)
	}
	t, _ := titleByID(id)
	return t.Name, t.Tier
}

// podiumTitleID is the title of a place on a season's podium (1–3), as a player wears it.
func podiumTitleID(place int) string { return "podium" + strconv.Itoa(place) }

// podiumTitles are the places of the podium as titles: the medal's metal, whether it's a neuter word (злато,
// сребро) or not (бронз), for the word that counts it, and the tier each shows in.
var podiumTitles = [3]struct {
	metal  string
	neuter bool
	tier   Tier
}{{"злато", true, Legendary}, {"сребро", true, Epic}, {"бронз", false, Rare}}

// times say how many times, before a metal („Двойно злато“, „Троен бронз“); past five, in digits („7 пъти злато“).
var times = map[bool][]string{
	true:  {"", "", "Двойно", "Тройно", "Четворно", "Петорно"},
	false: {"", "", "Двоен", "Троен", "Четворен", "Петорен"},
}

// PodiumTitle is the title of a place on the podium (1–3), won n times: „Злато“, „Тройно злато“, „7 пъти бронз“.
func PodiumTitle(place, n int) (string, Tier) {
	t := podiumTitles[place-1]
	words := times[t.neuter]
	switch {
	case n <= 1:
		first, size := utf8.DecodeRuneInString(t.metal)
		return string(unicode.ToUpper(first)) + t.metal[size:], t.tier
	case n < len(words):
		return words[n] + " " + t.metal, t.tier
	}
	return strconv.Itoa(n) + " пъти " + t.metal, t.tier
}

// royalWins is how many Роял tournaments a player has won (first place, with someone else in it).
func (g *Game) royalWins(ctx context.Context, userID int64) (int, error) {
	var n int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM royal_players p WHERE p.user_id = ? AND p.place = 1
		AND (SELECT count(*) FROM royal_players o WHERE o.royal_id = p.royal_id) > 1`, userID).Scan(&n)
	return n, err
}
