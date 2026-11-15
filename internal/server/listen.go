package server

import (
	"net"
	"os"
	"strconv"
)

// listen is the server's socket: the one systemd hands it, if it's started by its socket (deploy/almanac.socket),
// else one of its own at addr. systemd keeps its socket open while the server restarts, so the connections that come
// meanwhile wait in it for the new server instead of being refused.
func listen(addr string) (net.Listener, error) {
	if os.Getenv("LISTEN_PID") == strconv.Itoa(os.Getpid()) && os.Getenv("LISTEN_FDS") == "1" {
		// The protocol (sd_listen_fds): the first socket is descriptor 3; the variables are for this process only.
		os.Unsetenv("LISTEN_PID")
		os.Unsetenv("LISTEN_FDS")
		os.Unsetenv("LISTEN_FDNAMES")
		f := os.NewFile(3, "systemd socket")
		defer f.Close()
		return net.FileListener(f)
	}
	return net.Listen("tcp", addr)
}
