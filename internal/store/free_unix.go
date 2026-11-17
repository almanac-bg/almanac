//go:build linux || darwin

package store

import "syscall"

// freeSpace is how many bytes the file system holding dir has free for an unprivileged writer.
func freeSpace(dir string) (uint64, bool) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil {
		return 0, false
	}
	return uint64(st.Bavail) * uint64(st.Bsize), true
}
