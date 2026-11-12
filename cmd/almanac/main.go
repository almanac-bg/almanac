// Command almanac is the whole game in one program: the server, and the tools that look after it.
//
//	almanac serve                       run the game
//	almanac bank check [dir]            check a question bank (what a server would refuse, and what to look at)
//	almanac bank fmt [dir]              rewrite a bank's files in their one format
//	almanac version
package main

import (
	"fmt"
	"os"
)

// version is set when a release is built (-ldflags "-X main.version=…").
var version = "dev"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "almanac:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	switch args[0] {
	case "serve":
		return serve(args[1:])
	case "bank":
		return bankCommand(args[1:])
	case "version":
		fmt.Println(version)
		return nil
	}
	return usage()
}

func usage() error {
	return fmt.Errorf("usage: almanac serve | bank check [dir] | bank fmt [dir] | version")
}
