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
//     one in sight. A level is time played, so its titles name devotion („Постоянство“, „Вярност към Алманаха“), not
//     intellect: a claim to knowing is mastery's to give;
//   - an achievement: only those that say how someone plays („Светкавица“ for five quick right answers in a game,
//     „Неугасим пламък“), never one tap's luck or the hour on the clock (what „След полунощ“ or „В последния миг“
//     earn is an avatar);
//   - mastery: „Майстор · …“ and „Светило · …“ for reaching that mastery in a topic, „Всезнание“ for „Експерт“ in
//     every topic and „Оракул“ for „Светило“ in three;
//   - the rating and the leagues: a division reached, a Роял won, and first place in a week of Рила, which counts
//     how many times („Три купи на Рила“).
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

// Titles are every title but the topics' (made from the bank's topics) and the champion's: the rating's, the level's
// ladder, then the achievements', each group from the first a player is likely to earn.
var Titles = []Title{
	{"goldStandard", "Чисто злато", Rare, TitleRank, unlock{division: "gold"}, ""},
	{"diamondMind", "Диамантен ум", Epic, TitleRank, unlock{division: "diamond"}, ""},
	{"livingLegend", "Жива легенда", Legendary, TitleRank, unlock{division: "legend"}, ""},
	{"royalCrown", "Короната на Роял", Epic, TitleRank, unlock{royal: 1}, ""},

	{"spark", "Нова искра", Common, TitleLevel, unlock{level: 1}, ""},
	{"curious", "Любопитен ум", Common, TitleLevel, unlock{level: 3}, ""},
	{"passion", "Страст към викторините", Common, TitleLevel, unlock{level: 5}, ""},
	{"persistence", "Постоянство", Rare, TitleLevel, unlock{level: 8}, ""},
	{"insatiable", "Ненаситно любопитство", Rare, TitleLevel, unlock{level: 12}, ""},
	{"devotion", "Всеотдайност", Rare, TitleLevel, unlock{level: 16}, ""},
	{"grit", "Упоритост", Epic, TitleLevel, unlock{level: 20}, ""},
	{"loyalty", "Вярност към Алманаха", Epic, TitleLevel, unlock{level: 25}, ""},
	{"longevity", "Дълголетие", Epic, TitleLevel, unlock{level: 30}, ""},
	{"endurance", "Издръжливост", Epic, TitleLevel, unlock{level: 35}, ""},
	{"keeper", "Стълб на Алманаха", Legendary, TitleLevel, unlock{level: 40}, ""},
	{"chronicler", "Летопис на дните", Legendary, TitleLevel, unlock{level: 45}, ""},
	{"almanac", "Жив алманах", Legendary, TitleLevel, unlock{level: 50}, ""},

	{"everyDay", "Всеки ден по малко", Rare, TitleAchievement, unlock{achieved: "streak7"}, ""},
	{"speedDemon", "Светкавица", Rare, TitleAchievement, unlock{achieved: "fast"}, ""},
	{"flawless", "Безупречност", Rare, TitleAchievement, unlock{achieved: "perfect"}, ""},
	{"sharpEye", "Остър поглед", Rare, TitleAchievement, unlock{achieved: "exact"}, ""},
	{"seeker", "Търсещ ум", Rare, TitleAchievement, unlock{achieved: "allTopics"}, ""},
	{"heartOfGame", "Сърцето на играта", Rare, TitleAchievement, unlock{achieved: "friends5"}, ""},
	{"duelInstinct", "Инстинкт за победа", Epic, TitleAchievement, unlock{achieved: "duel10"}, ""},
	{"polymath", "Всестранен ум", Epic, TitleAchievement, unlock{achieved: "allTypes"}, ""},
	{"unquenched", "Неугасим пламък", Epic, TitleAchievement, unlock{achieved: "streak30"}, ""},
	{"purpose", "Целеустременост", Epic, TitleAchievement, unlock{achieved: "fullDays30"}, ""},
	{"encyclopedia", "Ходеща енциклопедия", Legendary, TitleAchievement, unlock{achieved: "master5"}, ""},
	{"razor", "Ум като бръснач", Legendary, TitleAchievement, unlock{achieved: "duel50"}, ""},
	{"sunrises", "Сто изгрева", Legendary, TitleAchievement, unlock{achieved: "streak100"}, ""},
	{"fullYear", "Година без пропуск", Legendary, TitleAchievement, unlock{achieved: "streak365"}, ""},
}

// acrossTopics are mastery's titles over several topics, after each topic's own: the claims to knowing a lot, which
// only knowing a lot unlocks.
var acrossTopics = []Title{
	{"omniscience", "Всезнание", Legendary, TitleTopic, unlock{topics: everyTopic, mastery: MasterTier - 1}, ""},
	{"oracle", "Оракул", Legendary, TitleTopic, unlock{topics: 3, mastery: MasterTier + 1}, ""},
}

// topicTiers are the mastery tiers that give a topic's title, and the tier it shows in.
var topicTiers = []struct {
	tier  int
	shows Tier
}{{MasterTier, Epic}, {MasterTier + 1, Legendary}}

// topicTitleID is the title of a mastery tier in a topic: "master-history".
func topicTitleID(tier int, category string) string { return MasteryTiers[tier].ID + "-" + category }

// titles are every title there is: Titles, with the topics' after (from the bank's topics), then those across them.
func (g *Game) titles() []Title {
	list := slices.Clone(Titles)
	for _, c := range g.Bank().Categories {
		for _, t := range topicTiers {
			name := MasteryTiers[t.tier].Name
			list = append(list, Title{ID: topicTitleID(t.tier, c.ID), Name: name + " · " + c.Name, Tier: t.shows,
				Group: TitleTopic, by: unlock{topic: c.ID, mastery: t.tier},
				about: "„" + name + "“ в „" + c.Name + "“"})
		}
	}
	return append(list, acrossTopics...)
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

// championHow says what wins the champion's title.
const championHow = "първо място за седмица в Рила"

// titleViews are every title, as a player with this wardrobe may wear them: the champion's first (named by how many
// times it's won), then the rest.
func (w wardrobe) titleViews(all []Title) []TitleView {
	list := make([]TitleView, 0, 1+len(all))
	won := w.champion()
	v := TitleView{TitleRef: TitleRef{ID: championID}, Group: TitleRank}
	v.Name, v.Tier = ChampionTitle(won)
	if won == 0 {
		v.Locked, v.How = true, championHow
	}
	list = append(list, v)
	for _, t := range all {
		v := TitleView{TitleRef: t.ref(), Group: t.Group}
		if !w.has(t.by) {
			v.Locked, v.How = true, t.how()
		}
		list = append(list, v)
	}
	return list
}

// how says what unlocks a title, for whoever hasn't yet, as a phrase after „Отключва се:“: the topic's mastery, the
// achievement (a hidden one isn't named), or the unlock's.
func (t Title) how() string {
	if t.about != "" {
		return t.about
	}
	if a, ok := achievementByID(t.by.achieved); ok && a.Hidden {
		return "скрито постижение"
	}
	return t.by.how()
}

// wears is whether a player with this wardrobe may wear a title: one they've unlocked, or the champion's, won.
func (w wardrobe) wears(all []Title, id string) bool {
	if i := slices.IndexFunc(all, func(t Title) bool { return t.ID == id }); i >= 0 {
		return w.has(all[i].by)
	}
	return id == championID && w.champion() > 0
}

// titleOf is the name a title is shown by, and its tier ("" for none): a title's id, or the champion's as lookColumns
// read it ("champion:3": three times).
func (g *Game) titleOf(id string) (string, Tier) {
	if id == "" {
		return "", ""
	}
	if rest, ok := strings.CutPrefix(id, championID+":"); ok {
		times, _ := strconv.Atoi(rest)
		if times < 1 {
			return "", ""
		}
		return ChampionTitle(times)
	}
	t, _ := g.titleByID(id)
	return t.Name, t.Tier
}

// unchosen is the title of a player who hasn't chosen one (users.title NULL), as lookColumns read it: they wear their
// level's (LevelTitle), so that a new player's „Нова искра“ shows from the first game and grows with the level. „Без
// титла“ is a choice, kept as "".
const unchosen = "~level"

// LevelTitle is the newest title of the level's ladder a player at this level has reached.
func LevelTitle(level int) string {
	id := ""
	for _, t := range Titles {
		if t.Group == TitleLevel && t.by.level <= level {
			id = t.ID
		}
	}
	return id
}

// championID is the champion's title, as a player wears it: first place in a week of the top league.
const championID = "champion"

// ChampionTitle is the champion's title, won n times: „Купата на Рила“, „Три купи на Рила“ (a cup won, not „шампион“,
// so that it's the same for anyone who wears it).
func ChampionTitle(n int) (string, Tier) {
	top := " на " + Leagues[TopLeague].Name
	if n <= 1 {
		return "Купата" + top, Legendary
	}
	w := inWords(n)
	first, size := utf8.DecodeRuneInString(w)
	return string(unicode.ToUpper(first)) + w[size:] + " купи" + top, Legendary
}

// royalWins is how many Роял tournaments a player has won (first place, with someone else in it).
func (g *Game) royalWins(ctx context.Context, userID int64) (int, error) {
	var n int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM royal_players p WHERE p.user_id = ? AND p.place = 1
		AND (SELECT count(*) FROM royal_players o WHERE o.royal_id = p.royal_id) > 1`, userID).Scan(&n)
	return n, err
}
