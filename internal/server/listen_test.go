package server

import (
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"testing"
)

// A server started by systemd's socket serves on it: the socket comes as descriptor 3, named by LISTEN_FDS and
// LISTEN_PID, here to a copy of the test program, as systemd would hand it.
func TestListenOnTheHandedSocket(t *testing.T) {
	if os.Getenv("ALMANAC_HANDED") == "1" {
		os.Setenv("LISTEN_PID", strconv.Itoa(os.Getpid())) // systemd sets it to the pid it starts
		ln, err := listen("127.0.0.1:1")                   // an address it mustn't use
		if err != nil {
			os.Exit(2)
		}
		if os.Getenv("LISTEN_FDS") != "" {
			os.Exit(3) // left for a child to take as its own
		}
		_ = http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			io.WriteString(w, "handed")
			go ln.Close()
		}))
		os.Exit(0)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	f, err := ln.(*net.TCPListener).File()
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	cmd := exec.Command(os.Args[0], "-test.run=^TestListenOnTheHandedSocket$")
	cmd.Env = append(os.Environ(), "ALMANAC_HANDED=1", "LISTEN_FDS=1")
	cmd.ExtraFiles = []*os.File{f} // descriptor 3
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	res, err := http.Get("http://" + ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != "handed" {
		t.Fatalf("got %q", body)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatalf("the server on the handed socket: %v", err)
	}
}
