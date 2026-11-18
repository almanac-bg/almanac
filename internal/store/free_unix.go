//go:build linux || darwin

package store

import "syscall"

// freeSpace is how many bytes the file system holding dir has free for an unprivileged writer, and how big it is.
func freeSpace(dir string) (free, total uint64, ok bool) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil {
		return 0, 0, false
	}
	return uint64(st.Bavail) * uint64(st.Bsize), uint64(st.Blocks) * uint64(st.Bsize), true
}
