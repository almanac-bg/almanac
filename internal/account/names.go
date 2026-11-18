package account

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Names are shown to strangers: on the boards, in Роял, in rooms, in a link's preview („<name> те кани…“). So a name
// is plain letters of the two scripts players here write in, Cyrillic and Latin, each word in one of them (a Latin
// „A“ inside „АЛМАНАХ“ is how a fake looks real), with no dot between letters (a name isn't a web address), and
// nothing that reads as the game or its people (reservedRoots): checked over two skeletons of the name, one by how
// it looks (a Latin „H“ for „Н“, a „0“ for „О“) and one by how it sounds („almanakh“), with spaces, dots and doubled
// letters gone, so that „А Л М А Н А Х“ and „Allmanac“ are caught as well. Whoever keeps the game (an admin) may
// take such a name; and can put any player's name and tag back to the drawn ones (ResetName).
//
// Nor is a name or tag rude (Rude): the swear words and slurs a board or a room's big screen would show, in Cyrillic,
// in Latin letters and in the digits chat writes some letters with („pi4ka“), heard by how they sound, so that
// „kurva“ and „курва“ are one. The list is a floor, not a wall: what gets past it, a room's host asks to change
// (room.Room.AskName), and whoever keeps the game resets (ResetName).

var (
	ErrBadName = errors.New("bad name")
	// ErrNameScripts is a word of a name in two scripts at once: Cyrillic and Latin letters mixed.
	ErrNameScripts = errors.New("a word in two scripts")
	// ErrNameLink is a name with a dot between letters: a web address.
	ErrNameLink = errors.New("a name like a web address")
	// ErrNameReserved is a name or tag that reads as the game's own, or its people's.
	ErrNameReserved = errors.New("a reserved name")
	// ErrNameRude is a name or tag that swears or insults (Rude).
	ErrNameRude = errors.New("a rude name")
	ErrBadTag   = errors.New("bad tag")
	ErrTagTaken = errors.New("tag taken")
)

const (
	NameMin = 2
	NameMax = 30
	TagMin  = 3
	TagMax  = 20
)

// Rename gives a player a new name (anyone's: names may repeat; the tag tells players apart).
func (a *Accounts) Rename(ctx context.Context, userID int64, name string) (string, error) {
	name, err := NormalName(name)
	if err == nil && Reserved(name) {
		err = a.unlessAdmin(ctx, userID)
	}
	if err != nil {
		return "", err
	}
	_, err = a.DB.Write.ExecContext(ctx, `UPDATE users SET name = ? WHERE id = ?`, name, userID)
	return name, err
}

// Retag gives a player a new tag, if it's free.
func (a *Accounts) Retag(ctx context.Context, userID int64, tag string) (string, error) {
	tag, err := NormalTag(tag)
	if err == nil && Rude(tag) {
		err = ErrNameRude
	}
	if err == nil && Reserved(tag) {
		err = a.unlessAdmin(ctx, userID)
	}
	if err != nil {
		return "", err
	}
	_, err = a.DB.Write.ExecContext(ctx, `UPDATE users SET tag = ? WHERE id = ?`, tag, userID)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return "", ErrTagTaken
	}
	return tag, err
}

// unlessAdmin is ErrNameReserved, unless the player keeps the game.
func (a *Accounts) unlessAdmin(ctx context.Context, userID int64) error {
	var admin bool
	if err := a.DB.Read.QueryRowContext(ctx, `SELECT admin FROM users WHERE id = ?`, userID).Scan(&admin); err != nil {
		return err
	}
	if admin {
		return nil
	}
	return ErrNameReserved
}

// ResetName puts a player's name and tag back to ones drawn for them, as a new player's (whoever keeps the game does,
// for a name that pretends or offends): the name and tag it gave.
func (a *Accounts) ResetName(ctx context.Context, userID int64) (name, tag string, err error) {
	err = a.DB.Tx(ctx, func(tx *sql.Tx) error {
		var exists bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM users WHERE id = ?)`, userID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return sql.ErrNoRows
		}
		name, tag, err = draw(tx, userID)
		return err
	})
	return name, tag, err
}

// NormalTag is a tag as it's kept — 3 to 20 latin letters, digits and underscores, starting with a letter,
// lowercase, without the @ it's written with — or ErrBadTag. (Whether a new one is free to take is Retag's: a tag
// is looked up by this too.)
func NormalTag(s string) (string, error) {
	s = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(s), "@"))
	if len(s) < TagMin || len(s) > TagMax || s[0] < 'a' || s[0] > 'z' {
		return "", ErrBadTag
	}
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return "", ErrBadTag
		}
	}
	return s, nil
}

// NormalName is a name as players see it — 2 to 30 Cyrillic or Latin letters, digits, single spaces, dots, dashes
// and underscores, at least one letter — or ErrBadName; ErrNameScripts for a word in both scripts, ErrNameLink for a
// dot between letters, ErrNameRude for one that swears or insults (Rude). Whether it's free to take is Rename's
// (Reserved).
func NormalName(s string) (string, error) {
	s = strings.Join(strings.Fields(s), " ")
	n := utf8.RuneCountInString(s)
	if n < NameMin || n > NameMax {
		return "", ErrBadName
	}
	letters := 0
	word := 0 // the scripts of the word so far: cyrillic, latin, or both
	prev := ' '
	for _, r := range s {
		switch {
		case scriptOf(r) != 0:
			letters++
			if word |= scriptOf(r); word == cyrillic|latin {
				return "", ErrNameScripts
			}
			if prev == '.' {
				return "", ErrNameLink
			}
		case r >= '0' && r <= '9':
			if prev == '.' {
				return "", ErrNameLink
			}
		case r == ' ', r == '.', r == '-', r == '_':
			word = 0
		default:
			return "", ErrBadName
		}
		prev = r
	}
	if letters == 0 {
		return "", ErrBadName
	}
	if Rude(s) {
		return "", ErrNameRude
	}
	return s, nil
}

const (
	cyrillic = 1 << iota
	latin
)

// scriptOf is the script of a letter a name may have (cyrillic or latin), or 0: Cyrillic as Bulgarian and its
// neighbours write it (not the old letters past U+04FF, which only look odd), Latin with its accents (to U+024F).
func scriptOf(r rune) int {
	switch {
	case !unicode.IsLetter(r):
		return 0
	case r >= 0x0400 && r <= 0x04FF:
		return cyrillic
	case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= 0x00C0 && r <= 0x024F:
		return latin
	}
	return 0
}

// reservedRoots read as the game or its people: a name or tag with one of them anywhere in it (by either skeleton)
// is reserved.
var reservedRoots = []string{
	"алманах", "almanac", "almanakh",
	"админ", "admin",
	"модератор", "moderator",
	"поддръжка", "support",
}

// reservedWhole are reserved as a whole name or tag only (inside a longer one they say nothing).
var reservedWhole = []string{"помощ", "help", "root", "system", "система", "служител", "staff", "official"}

// skeletons of the reserved roots and whole words, made once.
var rootSkeletons, wholeSkeletons = skeletonsOf(reservedRoots), skeletonsOf(reservedWhole)

func skeletonsOf(words []string) map[string]bool {
	out := map[string]bool{}
	for _, w := range words {
		for _, s := range skeletons(w) {
			out[s] = true
		}
	}
	return out
}

// Reserved is whether a name or tag reads as the game's own, or its people's (reservedRoots).
func Reserved(name string) bool {
	for _, s := range skeletons(name) {
		if wholeSkeletons[s] {
			return true
		}
		for root := range rootSkeletons {
			if strings.Contains(s, root) {
				return true
			}
		}
	}
	return false
}

// skeletons are a name as it looks and as it sounds: each letter folded to one that looks the same (looks), or to
// its sound in Latin letters (sounds); with what isn't a letter or digit gone, and doubled letters made single.
func skeletons(name string) [2]string {
	var look, sound strings.Builder
	for _, r := range strings.ToLower(name) {
		if l, ok := looks[r]; ok {
			look.WriteString(l)
		} else if unicode.IsLetter(r) || unicode.IsDigit(r) {
			look.WriteRune(r)
		}
		if s, ok := sounds[r]; ok {
			sound.WriteString(s)
		} else if unicode.IsLetter(r) || unicode.IsDigit(r) {
			sound.WriteRune(r)
		}
	}
	heard := strings.NewReplacer("kh", "h", "ck", "k", "x", "h", "c", "k", "q", "k", "w", "v").Replace(sound.String())
	return [2]string{single(look.String()), single(heard)}
}

// single makes each run of one letter a single one.
func single(s string) string {
	var b strings.Builder
	var last rune = -1
	for _, r := range s {
		if r != last {
			b.WriteRune(r)
		}
		last = r
	}
	return b.String()
}

// looks folds a letter or digit to the one it can pass for: Cyrillic to the Latin it looks like, digits to letters,
// accented Latin to plain.
var looks = foldMap(map[string]string{
	"аàáâãäåā": "a", "в8ъь": "b", "сçć": "c", "е\u0451èéêëēє": "e", "нh": "h", "іїi1ìíîïl|": "l", "ј": "j", "к": "k",
	"л": "l", "м": "m", "пñń": "n", "оòóôõöø0": "o", "р": "p", "гr": "r", "ѕ5": "s", "т7": "t", "иùúûüц": "u",
	"у": "y", "х": "x", "з3": "3", "б6": "6", "ч4": "4", "шщ": "w",
})

// sounds folds a letter or digit to its sound in Latin letters (Bulgarian's own way of writing it so).
var sounds = foldMap(map[string]string{
	"а4àáâãäåā": "a", "б8": "b", "в": "v", "г": "g", "д": "d", "е\u044dєèéêëē3": "e", "ж": "zh", "з": "z",
	"иіїìíîï1": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о0òóôõöø": "o", "п": "p", "р": "r",
	"с5ѕ": "s", "т7": "t", "уўùúûü": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sht",
	"ъ": "a", "ь\u044b": "y", "ю": "yu", "я": "ya", "\u0451": "yo", "ј": "j", "ç": "c", "ñ": "n",
})

func foldMap(m map[string]string) map[rune]string {
	out := map[rune]string{}
	for from, to := range m {
		for _, r := range from {
			out[r] = to
		}
	}
	return out
}

// The rude words, by how each is matched against a name heard (the sound skeleton of each of its words, and of all of
// them run together, for „п у т к а“): anywhere, at a word's start, or as a whole word. A short root that sits inside
// ordinary names is matched whole or at a start only („кур“ is in „Куртев“, „еба“ in „Хлебарка“, „шиб“ in „Шибил“,
// „fuk“ in „Fukuoka“); anywhere is for roots no name has.
var (
	rudeAnywhere = []string{
		"путк", "пизд", "курв", "хуй", "бляд", "шибан", "педераст", "мамкати", "мамкаму", "духач", "хитлер", "нацист",
		"порн", "asshole", "pussy",
	}
	rudeStart = []string{
		"ебан", "ебал", "ебат", "ебах", "ебеш", "ебем", "ебач", "ебло", "педал", "лайна", "лайно", "fucke", "fucki",
		"fucks", "motherfuck",
	}
	rudeWhole = []string{
		"кур", "гъз", "сука", "пичка", "пишка", "задник", "еба", "ебе", "еби", "фак", "fuck", "fck", "hui", "huj", "shit",
		"cunt", "bitch", "whore", "slut", "nigger", "nigga", "nazi",
	}
)

// The rude words as heard (their sound skeletons), made once.
var rudeAnywhereHeard, rudeStartHeard, rudeWholeHeard = heardAll(rudeAnywhere), heardAll(rudeStart), heardAll(rudeWhole)

func heardAll(words []string) []string {
	out := make([]string, 0, len(words))
	for _, w := range words {
		out = append(out, skeletons(w)[1])
	}
	return out
}

// chat writes some Bulgarian letters with the digits that look like them („pi4ka“, „6iban“): a name is heard both as
// it's written and so.
var chat = strings.NewReplacer("4", "ч", "6", "ш")

// Rude is whether a name or tag swears or insults: one of the rude words (rudeAnywhere, rudeStart, rudeWhole) heard in
// it.
func Rude(name string) bool {
	for _, form := range []string{name, chat.Replace(name)} {
		words := strings.FieldsFunc(form, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
		all := skeletons(strings.Join(words, ""))[1]
		for _, root := range rudeAnywhereHeard {
			if strings.Contains(all, root) {
				return true
			}
		}
		for _, w := range words {
			heard := skeletons(w)[1]
			if slices.Contains(rudeWholeHeard, heard) {
				return true
			}
			for _, root := range rudeStartHeard {
				if strings.HasPrefix(heard, root) {
					return true
				}
			}
		}
	}
	return false
}
