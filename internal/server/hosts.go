package server

import (
	"net"
	"net/http"
	"strings"
)

// hosts answers by the name a request was sent to: the game's own (PUBLIC_URL), www (sent there for good), the mail
// policy's (MTA-STS), and nothing else — the game never answers as some other site.
func (s *Server) hosts(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		host = strings.ToLower(host)
		switch {
		case host == s.host || s.cfg.Dev:
			next.ServeHTTP(w, r)
		case host == "www."+s.host:
			http.Redirect(w, r, s.cfg.PublicURL+r.URL.RequestURI(), http.StatusMovedPermanently)
		case host == "mta-sts."+s.host && len(s.cfg.MTASTS) > 0:
			s.mtaSTS(w, r)
		default:
			http.Error(w, "Not Found", http.StatusNotFound)
		}
	})
}

// mtaSTS is the domain's mail policy (RFC 8461): mail to its addresses only over TLS, only to these servers.
func (s *Server) mtaSTS(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/.well-known/mta-sts.txt" {
		http.NotFound(w, r)
		return
	}
	mode := s.cfg.MTASTSMode
	if mode == "" {
		mode = "testing"
	}
	var b strings.Builder
	b.WriteString("version: STSv1\r\nmode: " + mode + "\r\n")
	for _, mx := range s.cfg.MTASTS {
		b.WriteString("mx: " + mx + "\r\n")
	}
	b.WriteString("max_age: 604800\r\n")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write([]byte(b.String()))
}
