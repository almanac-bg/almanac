package play

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Titles: a few words worn under a player's name wherever they show. A title says something of the player and their
// knowledge („Любопитен ум“, „Оракул“, „Майстор · История“), never only a deed („Три поред“ is an achievement). They
// come four ways, each its own group:
//
//   - the level: a ladder from „Нова искра“ at the start to „Жив алманах“ at level 50, so that there's always a next
//     one in sight;
//   - an achievement: only those that say how someone plays („Светкавица“, „Неугасим пламък“);
//   - a topic: „Майстор · …“ and „Светило · …“ for reaching that mastery in it;
//   - the rating: a division reached, a Роял won, and a place on a season's podium, which counts how many times
//     („Двукратен шампион“).
//
// Each has a tier, the colour it's worn in.

// Title is a title there is, and what unlocks it.
type Title struct {
	ID    string
	Name  string
	Tier  Tier
	Group string // TitleLevel, TitleAchievement, TitleTopic or TitleRank
	by    unlock
	about string // what unlocks it, when the unlock can't say (a topic's)
}

// The groups titles come in, as Награди lists the locked ones.
const (
	TitleLevel       = "level"
	TitleAchievement = "achievement"
	TitleTopic       = "topic"
	TitleRank        = "rank"
)

// Titles are every title but the topics' (made from the bank's topics) and the podium's: the rating's, the level's
// ladder, then the achievements', each group from the first a player is likely to earn.
var Titles = []Title{
	{"goldSeason", "Златен сезон", Rare, TitleRank, unlock{division: "gold"}, ""},
	{"diamondMind", "Диамантен ум", Epic, TitleRank, unlock{division: "diamond"}, ""},
	{"livingLegend", "Жива легенда", Legendary, TitleRank, unlock{division: "legend"}, ""},
	{"royalCrown", "Короната на Роял", Epic, TitleRank, unlock{royal: 1}, ""},

	{"spark", "Нова искра", Common, TitleLevel, unlock{level: 1}, ""},
	{"curious", "Любопитен ум", Common, TitleLevel, unlock{level: 3}, ""},
	{"passion", "Страст към викторините", Common, TitleLevel, unlock{level: 5}, ""},
	{"erudition", "Ерудиция", Rare, TitleLevel, unlock{level: 8}, ""},
	{"omniscience", "Всезнание", Rare, TitleLevel, unlock{level: 12}, ""},
	{"genius", "Гениален ум", Rare, TitleLevel, unlock{level: 16}, ""},
	{"well", "Извор на знания", Epic, TitleLevel, unlock{level: 20}, ""},
	{"oracle", "Оракул", Epic, TitleLevel, unlock{level: 25}, ""},
	{"library", "Жива библиотека", Epic, TitleLevel, unlock{level: 30}, ""},
	{"wisdom", "Вековна мъдрост", Epic, TitleLevel, unlock{level: 35}, ""},
	{"keeper", "Пазител на знанието", Legendary, TitleLevel, unlock{level: 40}, ""},
	{"chronicler", "Летописец", Legendary, TitleLevel, unlock{level: 45}, ""},
	{"almanac", "Жив алманах", Legendary, TitleLevel, unlock{level: 50}, ""},

	{"speedDemon", "Светкавица", Common, TitleAchievement, unlock{achieved: "fast"}, ""},
	{"everyDay", "Всеки ден по малко", Rare, TitleAchievement, unlock{achieved: "streak7"}, ""},
	{"flawless", "Безупречност", Rare, TitleAchievement, unlock{achieved: "perfect"}, ""},
	{"sharpEye", "Остър поглед", Rare, TitleAchievement, unlock{achieved: "exact"}, ""},
	{"seeker", "Търсещ ум", Rare, TitleAchievement, unlock{achieved: "allTopics"}, ""},
	{"heartOfGame", "Сърцето на играта", Rare, TitleAchievement, unlock{achieved: "friends5"}, ""},
	{"nightOwl", "Нощна сова", Rare, TitleAchievement, unlock{achieved: "nightOwl"}, ""},
	{"quietStrength", "Хладнокръвие", Rare, TitleAchievement, unlock{achieved: "lastSecond"}, ""},
	{"duelInstinct", "Дуелен инстинкт", Epic, TitleAchievement, unlock{achieved: "duel10"}, ""},
	{"polymath", "Всестранен ум", Epic, TitleAchievement, unlock{achieved: "allTypes"}, ""},
	{"unquenched", "Неугасим пламък", Epic, TitleAchievement, unlock{achieved: "streak30"}, ""},
	{"purpose", "Целеустременост", Epic, TitleAchievement, unlock{achieved: "fullDays30"}, ""},
	{"encyclopedia", "Ходеща енциклопедия", Legendary, TitleAchievement, unlock{achieved: "master5"}, ""},
	{"razor", "Ум като бръснач", Legendary, TitleAchievement, unlock{achieved: "duel50"}, ""},
	{"sunrises", "Сто изгрева", Legendary, TitleAchievement, unlock{achieved: "streak100"}, ""},
}

// topicTiers are the mastery tiers that give a topic's title, and the tier it shows in.
var topicTiers = []struct {
	tier  int
	shows Tier
}{{MasterTier, Epic}, {MasterTier + 1, Legendary}}

// topicTitleID is the title of a mastery tier in a topic: "master-history".
func topicTitleID(tier int, category string) string { return MasteryTiers[tier].ID + "-" + category }

// titles are every title there is: Titles, with the topics' after (from the bank's topics).
func (g *Game) titles() []Title {
	list := slices.Clone(Titles)
	for _, c := range g.Bank().Categories {
		for _, t := range topicTiers {
			name := MasteryTiers[t.tier].Name
			list = append(list, Title{ID: topicTitleID(t.tier, c.ID), Name: name + " · " + c.Name, Tier: t.shows,
				Group: TitleTopic, by: unlock{topic: c.ID, mastery: t.tier},
				about: "стигни до „" + name + "“ в „" + c.Name + "“"})
		}
	}
	return list
}

func (g *Game) titleByID(id string) (Title, bool) {
	all := g.titles()
	i := slices.IndexFunc(all, func(t Title) bool { return t.ID == id })
	if i < 0 {
		return Title{}, false
	}
	return all[i], true
}

// TitleRef names a title: its id (to wear it), its name and its tier.
type TitleRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Tier Tier   `json:"tier"`
}

func (t Title) ref() TitleRef { return TitleRef{t.ID, t.Name, t.Tier} }

// TitleView is a title as a player may wear it: theirs, or locked with what unlocks it.
type TitleView struct {
	TitleRef
	Group  string `json:"group"`
	Locked bool   `json:"locked,omitempty"`
	How    string `json:"how,omitempty"`
}

// podiumHow says what wins a place's title.
var podiumHow = [3]string{"първо място в сезон", "второ място в сезон", "трето място в сезон"}

// titleViews are every title, as a player with this wardrobe may wear them: the podium's first (named by how many
// times they're won), then the rest.
func (w wardrobe) titleViews(all []Title) []TitleView {
	list := make([]TitleView, 0, len(w.podium)+len(all))
	for i, won := range w.podium {
		v := TitleView{TitleRef: TitleRef{ID: podiumTitleID(i + 1)}, Group: TitleRank}
		v.Name, v.Tier = PodiumTitle(i+1, won)
		if won == 0 {
			v.Locked, v.How = true, podiumHow[i]
		}
		list = append(list, v)
	}
	for _, t := range all {
		v := TitleView{TitleRef: t.ref(), Group: t.Group}
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
	if t.about != "" {
		return t.about
	}
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

// wears is whether a player with this wardrobe may wear a title: one they've unlocked, or a place on the podium
// they've won.
func (w wardrobe) wears(all []Title, id string) bool {
	if i := slices.IndexFunc(all, func(t Title) bool { return t.ID == id }); i >= 0 {
		return w.has(all[i].by)
	}
	for place, n := range w.podium {
		if n > 0 && id == podiumTitleID(place+1) {
			return true
		}
	}
	return false
}

// titleOf is the name a title is shown by, and its tier ("" for none): a title's id, or a place on a season's
// podium as lookColumns read it ("podium2:3": second, three times).
func (g *Game) titleOf(id string) (string, Tier) {
	if id == "" {
		return "", ""
	}
	if rest, ok := strings.CutPrefix(id, "podium"); ok {
		p, n, _ := strings.Cut(rest, ":")
		place, _ := strconv.Atoi(p)
		times, _ := strconv.Atoi(n)
		if place < 1 || place > len(podiumTitles) || times < 1 {
			return "", ""
		}
		return PodiumTitle(place, times)
	}
	t, _ := g.titleByID(id)
	return t.Name, t.Tier
}

// podiumTitleID is the title of a place on a season's podium (1–3), as a player wears it.
func podiumTitleID(place int) string { return "podium" + strconv.Itoa(place) }

// podiumTitles are the places of the podium as titles — won once, and before a count — and the tier each shows in.
var podiumTitles = [3]struct {
	once, name string
	tier       Tier
}{{"Шампион", "шампион", Legendary}, {"Вицешампион", "вицешампион", Epic}, {"Бронзов медалист", "бронзов медалист", Rare}}

// times say how many times, before a title („Двукратен“); past ten, in digits.
var times = []string{"", "", "Двукратен", "Трикратен", "Четирикратен", "Петкратен", "Шесткратен", "Седемкратен",
	"Осемкратен", "Деветкратен", "Десеткратен"}

// PodiumTitle is the title of a place on the podium (1–3), won n times: „Шампион“, „Трикратен шампион“.
func PodiumTitle(place, n int) (string, Tier) {
	t := podiumTitles[place-1]
	switch {
	case n <= 1:
		return t.once, t.tier
	case n < len(times):
		return times[n] + " " + t.name, t.tier
	}
	return strconv.Itoa(n) + "-кратен " + t.name, t.tier
}

// royalWins is how many Роял tournaments a player has won (first place, with someone else in it).
func (g *Game) royalWins(ctx context.Context, userID int64) (int, error) {
	var n int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM royal_players p WHERE p.user_id = ? AND p.place = 1
		AND (SELECT count(*) FROM royal_players o WHERE o.royal_id = p.royal_id) > 1`, userID).Scan(&n)
	return n, err
}
