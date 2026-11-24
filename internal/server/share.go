package server

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/card"
	"github.com/almanac-bg/almanac/internal/play"
)

// Sharing the day's result (play/share.go): the link a player shares, made as they first share their day (POST
// /api/runs/{id}/share: the text to share, ending with it); the page it opens (/d/<issue>-<code>: the app, with the
// shared day in its boot, which shows the day's issue to play while it lasts, and the card in its preview: pages.go);
// and the card (GET /card/<issue>-<shape>.png: internal/card, drawn with the issue's chapters).
//
// What it costs, if one network does it all day: a link is made once for each finished day, and asked for within
// sharesPlayer a player and sharesNet a network an hour (with their site's); a card is the same for every result of
// one shape on one day, so one is drawn once and kept (cardsKept, the newest), drawn at most cardsDrawing at once,
// and a network may have the server draw cardsNet an hour (its site cardsSite): past those it gets the game's picture
// instead, marked a stand-in (standIn). Previews (Viber's, Messenger's) ask from their own networks, for every chat a link is sent to: the card is
// cached by them and by Cloudflare too, for a week (its address says all it shows).

const (
	sharesPlayer = 30
	sharesNet    = 120
	sharesSite   = 600
	cardsNet     = 200
	cardsSite    = 1000
	cardsKept    = 200
	cardsDrawing = 2
)

// sharePath is a shared day's link (play.Share.Path), and cardName a card's file: only as cardOf spells it (the issue
// without a leading zero, then its ten marks), so that no card is drawn, kept or cached under a second name.
var (
	sharePath = regexp.MustCompile(`^/d/([0-9]{1,5})-([a-z2-9]{8})$`)
	cardName  = regexp.MustCompile(`^([1-9][0-9]{0,4})-([0-3]{10})\.png$`)
)

// standIn is the header that marks the site's picture sent in a card's place, past its budget: the page sharing the
// day (game/share.ts, cardFile) shares no card then; a link's preview shows the picture as it is.
const standIn = "X-Stand-In"

// siteImage is the site's own picture (card.Site), drawn once.
var siteImage = sync.OnceValues(card.Site)

// sitePicture serves the site's own picture (GET /og.png): what a link to any page but a shared day shows, and a
// card's stand-in past its budget.
func (s *Server) sitePicture(w http.ResponseWriter, r *http.Request) {
	b, err := siteImage()
	if err != nil {
		slog.Error("site picture", "err", err)
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	// Its address names no version, but it changes only with a release that redraws it, and a day late is harmless:
	// previewers ask for it with every link to the site.
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}
	w.Header().Set("Content-Type", "image/png")
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(b))
}

// share makes the link to a player's finished day, or gives the one it has, with the text to share.
func (s *Server) share(w http.ResponseWriter, r *http.Request) error {
	user, id, err := s.runOf(r)
	if err != nil {
		return err
	}
	if !s.limits.allow("share:"+strconv.FormatInt(user, 10), sharesPlayer, time.Hour) ||
		!s.allowFrom(r, "share", sharesNet, sharesSite, time.Hour) {
		return errTooMany
	}
	sh, err := s.game.Share(r.Context(), user, id)
	if err != nil {
		return err
	}
	// The text it's shared with is the client's (game/share.ts): one wording, made where it's shared.
	return ok(w, map[string]string{"url": s.cfg.PublicURL + sh.Path()})
}

// sharedOf is the shared day a page's path is the link to, if it's one that is.
func (s *Server) sharedOf(r *http.Request) (play.Share, bool) {
	m := sharePath.FindStringSubmatch(r.URL.Path)
	if m == nil {
		return play.Share{}, false
	}
	issue, _ := strconv.Atoi(m[1])
	sh, err := s.game.Shared(r.Context(), issue, m[2])
	return sh, err == nil
}

// cardOf is where a shared day's card is, as the release that draws it names it: a card is kept a week wherever it's
// cached (the browser, Cloudflare, the apps' previews), so a release that draws cards anew asks for them under a new
// address (?v=, which the card's handler ignores: game/share.ts, cardPath, the same) and no old drawing is shared.
func cardOf(sh play.Share, version string) string {
	p := fmt.Sprintf("/card/%d-%s.png", sh.Issue, sh.Shape)
	if version != "" {
		p += "?v=" + url.QueryEscape(version)
	}
	return p
}

// cards are the cards drawn, kept by their file's name, and the turns to draw one.
type cards struct {
	mu    sync.Mutex
	drawn map[string][]byte
	turns chan struct{}
}

func newCards() *cards {
	return &cards{drawn: map[string][]byte{}, turns: make(chan struct{}, cardsDrawing)}
}

func (c *cards) get(name string) []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.drawn[name]
}

// draw draws a card, when its turn comes, and keeps it: in place of one of the others (any), once there are
// cardsKept.
func (c *cards) draw(ctx context.Context, name string, of card.Card) ([]byte, error) {
	select {
	case c.turns <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	b, err := func() ([]byte, error) {
		defer func() { <-c.turns }() // the turn given back however the drawing ends, a panic in it included
		return card.Draw(of)
	}()
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.drawn) >= cardsKept {
		for k := range c.drawn {
			delete(c.drawn, k)
			break
		}
	}
	c.drawn[name] = b
	return b, nil
}

// card is a shared day's card: the issue's (one that has come out) and the shape's in its name, nothing else.
func (s *Server) card(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	m := cardName.FindStringSubmatch(name)
	issue := 0
	if m != nil {
		issue, _ = strconv.Atoi(m[1])
	}
	if issue < 1 || issue > play.Issue(s.game.Today()) {
		http.NotFound(w, r)
		return
	}
	b := s.cards.get(name)
	if b == nil {
		if !s.allowFrom(r, "card", cardsNet, cardsSite, time.Hour) {
			// Past its budget: the game's own picture, for now.
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set(standIn, "1")
			s.sitePicture(w, r)
			return
		}
		day := play.IssueDay(issue)
		chapters, err := s.game.IssueChapters(r.Context(), day)
		if err == nil {
			b, err = s.cards.draw(r.Context(), name, card.Card{Issue: issue, Date: play.DateWords(day),
				National: bank.NationalName(day), Chapters: chapters, Shape: m[2]})
		}
		if err != nil {
			if r.Context().Err() == nil {
				slog.Error("card", "err", err)
			}
			http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
			return
		}
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=604800")
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(b))
}
