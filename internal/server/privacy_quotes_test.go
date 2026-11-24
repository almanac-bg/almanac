package server

import (
	"bytes"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/backup"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/store"
)

// The privacy page is a promise (CLAUDE.md: privacy is what the page says), and it quotes numbers the code keeps:
// each is pinned here to the value the page was written for, beside the words that say it (in words or in digits).
// A constant changed fails this with the page's phrase to edit; the phrase edited, with the constant to check.
func TestPrivacyQuotesTheCode(t *testing.T) {
	var out bytes.Buffer
	if err := privacyBody.Execute(&out, map[string]any{"Operator": "x", "Contact": "a@b.c", "ContactParts": []string{"a@b.c"}}); err != nil {
		t.Fatal(err)
	}
	page := strings.Join(strings.Fields(out.String()), " ")
	journal, err := os.ReadFile("../../deploy/journald.conf")
	if err != nil {
		t.Fatal(err)
	}
	day := 24 * time.Hour
	for _, q := range []struct {
		what      string
		got, want any
		phrase    string
	}{
		{"account.SessionDays", account.SessionDays, 400, "играта не бъде отворена 400 дни"},
		{"account.EmailRequestDays", account.EmailRequestDays, 60, "чака до 60 дни"},
		{"account.ReportDays", account.ReportDays, 30, "докато го прегледаме, и 30 дни след това"},
		{"account.HandoffTTL", account.HandoffTTL, 30 * time.Minute, "веднъж, до половин час"},
		{"account.CodeTTL", account.CodeTTL, 15 * time.Minute, "една за 15 минути, когато поискаш код"},
		{"playedKept", playedKept, 2 * day, "една за два дни с датата"},
		{"StreakMailFrom", StreakMailFrom, 5, "серия от 5 дни или повече"},
		{"StreakMailEvery", StreakMailEvery, 30, "най-много едно на 30 дни"},
		{"RemindIgnored", RemindIgnored, 3, "след три такива дни подред"},
		{"play.DuelFor", play.DuelFor, 7 * day, "не изиграе до седем дни"},
		{"play.Forgives", play.Forgives, 2, "до два пропуснати дни в седмицата"},
		{"play.LateGrace", play.LateGrace, 15 * time.Second, "до 15 секунди след времето на въпроса"},
		{"play.BoardTop", play.BoardTop, 20, "за първите 20"},
		{"play.SharerAsks", play.SharerAsks, 20, "по една връзка най-много 20 души"},
		{"backup.DaysKept", backup.DaysKept, 30 * day, "Резервните копия на базата данни се пазят до месец"},
		{"store.CopiesKept", store.CopiesKept, 30 * day, "от резервните копия — до месец"},
		{"deploy/journald.conf's MaxRetentionSec", regexp.MustCompile(`(?m)^MaxRetentionSec=(.*)$`).FindStringSubmatch(string(journal))[1],
			"14day", "Пазим ги до 14 дни"},
	} {
		if q.got != q.want {
			t.Errorf("%s is %v, and the privacy page says it's %v: „%s“ (privacy.go)", q.what, q.got, q.want, q.phrase)
		} else if !strings.Contains(page, q.phrase) {
			t.Errorf("the privacy page no longer says „%s“: is %s (%v) still told right?", q.phrase, q.what, q.want)
		}
	}
	// Every push service the game posts to is named: whoever runs it gets the address a browser is reached at.
	owners := map[string]string{"googleapis.com": "Google", "apple.com": "Apple", "mozilla.com": "Mozilla",
		"windows.com": "Microsoft"}
	for _, host := range push.Services {
		_, domain, _ := strings.Cut(strings.TrimPrefix(host, "."), ".")
		for strings.Count(domain, ".") > 1 {
			_, domain, _ = strings.Cut(domain, ".")
		}
		if owner, ok := owners[domain]; !ok {
			t.Errorf("push service %s: whose is it? Name it on the privacy page, and here", host)
		} else if !strings.Contains(page, owner) {
			t.Errorf("push service %s isn't named on the privacy page (%s)", host, owner)
		}
	}
}
