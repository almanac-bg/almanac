package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/royal"
)

// royalEvents streams the evening's Роял to a screen (Server-Sent Events): as the viewer sees it, again after every
// change. Anyone may look; playing takes a player. The browser reconnects by itself if the line drops.
func (s *Server) royalEvents(w http.ResponseWriter, r *http.Request) {
	var viewer int64
	if u, err := s.user(r); err == nil && u != nil {
		viewer = u.ID
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	sub := s.royal.Follow(viewer)
	defer s.royal.Unfollow(sub)

	send := func(line string) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprint(w, line); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	ping := time.NewTicker(20 * time.Second) // keeps the line open through proxies (Cloudflare closes it after 100 s)
	defer ping.Stop()
	for {
		select {
		case <-sub.C:
			data, _ := json.Marshal(s.royal.View(viewer))
			if !send("data: " + string(data) + "\n\n") {
				return
			}
			// Many answers in a moment make one look, not one each.
			select {
			case <-time.After(150 * time.Millisecond):
			case <-r.Context().Done():
				return
			}
		case <-ping.C:
			if !send(": ping\n\n") {
				return
			}
		case <-s.closing:
			return
		case <-r.Context().Done():
			return
		}
	}
}

// joinRoyal puts the player in the evening's lobby.
func (s *Server) joinRoyal(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	look, err := s.game.LookOf(r.Context(), u.ID)
	if err != nil {
		look = play.Look{Avatar: play.DefaultAvatar(u.ID), Level: 1}
	}
	if err := s.royal.Join(r.Context(), royal.Player{ID: u.ID, Name: u.Name, Tag: u.Tag, Look: look}); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// leaveRoyal takes the player out of the lobby.
func (s *Server) leaveRoyal(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if err := s.royal.Leave(r.Context(), u.ID); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

func (s *Server) royalAnswer(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		N      int             `json:"n"`
		Answer json.RawMessage `json:"answer"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if err := s.royal.Answer(r.Context(), u.ID, in.N, in.Answer); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// royals lists the last tournaments the player was in, with their rating.
func (s *Server) royals(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	list, err := s.game.RoyalsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	st, err := s.game.StandingOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"royals": list, "standing": st})
}

// royalNews tells a player how a tournament they were in ended, when they weren't there to see it.
func (s *Server) royalNews(ctx context.Context, n play.RoyalNews) {
	m := push.Message{URL: "/royal", Title: fmt.Sprintf("Роял: %s от %d", ordinal(n.Place), n.Of)}
	if n.Of >= 3 { // with fewer, ratings don't move
		m.Body = fmt.Sprintf("Рейтинг: %+d.", n.Delta)
	}
	go s.notify(context.WithoutCancel(ctx), m, n.To)
}
