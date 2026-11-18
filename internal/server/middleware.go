package server

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/safe"
)

// recovered turns a panic in a handler into a 500, a log entry with its stack and a problem, instead of a dropped
// connection: as package safe does for the work done in the background.
func (s *Server) recovered(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				safe.Report(r.Method+" "+r.Pattern, v) // logged with its stack, and told as a problem (New: safe.Tell)
				http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// Unwrap lets http.ResponseController reach the connection (flushing a stream).
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// logged writes a line per request: method, route, status, time. Not for a file, nor for what a page or a monitor
// asks every so often (polled) when it went well: those would be most of the log and say nothing.
//
// The route is the pattern the request matched ("/api/rooms/{code}/join"), or for a page its first part ("/hand/…"),
// never the path itself: a path carries what the log has no need of, a handoff's token, the code of a room, a
// challenge or an invite, a player's tag (review 2026-11-18, S23). The address goes only with a request that failed (a
// refusal, a limit, something missing, an error): that's what tracing abuse needs, and a player playing leaves none in
// the log (I6). The log is kept 14 days (deploy/setup.sh), as the privacy page says.
func (s *Server) logged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		if sw.status < 400 && (isAsset(r.URL.Path) || polled[r.Pattern]) {
			return
		}
		if sw.status == 499 { // the player left before the answer: not worth a line
			return
		}
		args := []any{"method", r.Method, "route", route(r), "status", sw.status, "ms", time.Since(start).Milliseconds()}
		if sw.status >= 400 {
			args = append(args, "ip", s.clientIP(r))
		}
		level := slog.LevelInfo
		if sw.status >= 500 {
			level = slog.LevelError
		}
		slog.Log(r.Context(), level, "request", args...)
	})
}

// polled are the routes a page asks every so often while it's open (or a monitor does): logged only when they fail.
var polled = map[string]bool{
	"GET /api/health":          true,
	"GET /api/friends":         true,
	"GET /api/friends/invites": true,
	"GET /api/royal/tonight":   true,
}

// route is a request as the log names it: the pattern it matched, without its method; or, for a page (and whatever
// matched no pattern but the pages'), the path's first part, with "/…" for the rest.
func route(r *http.Request) string {
	if p := r.Pattern; p != "" && p != "/" {
		if _, path, ok := strings.Cut(p, " "); ok {
			return path
		}
		return p
	}
	return pageRoute(r.URL.Path)
}

// pageRoute is a page's path as the log names it: its first part, with "/…" for the rest.
func pageRoute(path string) string {
	// What anyone asked for, on one line of its own (the JSON log escapes it as well).
	path = strings.ReplaceAll(strings.ReplaceAll(path, "\n", ""), "\r", "")
	first, rest, _ := strings.Cut(strings.TrimPrefix(path, "/"), "/")
	if c := cut(first, 40); c != first {
		first = c + "…"
	}
	if rest != "" {
		return "/" + first + "/…"
	}
	return "/" + first
}

// csp lets the page load only its own files: no inline scripts, no third parties.
const csp = "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; " +
	"font-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"

func (s *Server) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
		if s.secure {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
		}
		next.ServeHTTP(w, r)
	})
}
