package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
)

func main() {
	// 1. Enforce root execution (will be run via doas)
	if os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Error: pf-block-sync must be run as root (via doas)")
		os.Exit(1)
	}

	var ips []string
	scanner := bufio.NewScanner(os.Stdin)

	// 2. Read from standard input and strictly validate IPs
	for scanner.Scan() {
		ipStr := strings.TrimSpace(scanner.Text())
		if ipStr == "" {
			continue
		}
		// If it is a valid IP, add it to our list
		if net.ParseIP(ipStr) != nil {
			ips = append(ips, ipStr)
		}
	}

	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "Error reading stdin: %v\n", err)
		os.Exit(1)
	}

	// 3. Atomically replace the PF table
	// We use 'replace -f -' to swap the entire table in milliseconds, reading from stdin
	input := strings.Join(ips, "\n") + "\n"
	cmd := exec.Command("/sbin/pfctl", "-t", "blocklist_internal", "-T", "replace", "-f", "-")
	cmd.Stdin = strings.NewReader(input)
	
	// We only care about standard error (pfctl usually prints stats to stderr)
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "pfctl failed: %v\n", err)
		os.Exit(1)
	}
}
