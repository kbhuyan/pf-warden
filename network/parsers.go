package network

import (
	"bufio"
	"bytes"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

// GetArpLeases returns a map of [mac]ip from live ARP data
func GetArpLeases() map[string]string {
	macToIP := make(map[string]string)
	cmd := exec.Command("arp", "-a")
	output, err := cmd.Output()
	if err != nil {
		return macToIP // Return empty on error
	}

	re := regexp.MustCompile(`\(([\d\.]+)\)\s+at\s+([a-fA-F0-9:]+)`)
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		matches := re.FindStringSubmatch(scanner.Text())
		if len(matches) == 3 {
			macToIP[strings.ToLower(matches[2])] = matches[1]
		}
	}
	return macToIP
}

// GetCurrentLeases parses the isc-dhcp-server leases file
func GetCurrentLeases(filePath string) map[string]string {
	macToIP := make(map[string]string)
	file, err := os.Open(filePath)
	if err != nil {
		return macToIP
	}
	defer file.Close()

	type leaseData struct{ MAC, State string }
	ipTracker := make(map[string]leaseData)
	scanner := bufio.NewScanner(file)

	var currentIP, currentMAC, currentState string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "lease ") && strings.HasSuffix(line, "{") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				currentIP = fields[1]
			}
			currentMAC, currentState = "", ""
			continue
		}
		if line == "}" {
			if currentIP != "" {
				ipTracker[currentIP] = leaseData{MAC: currentMAC, State: currentState}
			}
			currentIP = ""
			continue
		}
		if strings.HasPrefix(line, "binding state ") {
			fields := strings.Fields(line)
			if len(fields) >= 3 {
				currentState = strings.TrimSuffix(fields[2], ";")
			}
			continue
		}
		if strings.HasPrefix(line, "hardware ethernet ") {
			fields := strings.Fields(line)
			if len(fields) >= 3 {
				currentMAC = strings.ToLower(strings.TrimSuffix(fields[2], ";"))
			}
		}
	}

	for ip, data := range ipTracker {
		if data.State == "active" && data.MAC != "" {
			macToIP[data.MAC] = ip
		}
	}
	return macToIP
}

// GetStaticReservations parses dhcpd.conf for fixed IP assignments
func GetStaticReservations(filePath string) map[string]string {
	macToIP := make(map[string]string)
	file, err := os.Open(filePath)
	if err != nil {
		return macToIP
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	inHostBlock := false
	var currentMAC, currentIP string

	for scanner.Scan() {
		line := scanner.Text()
		if idx := strings.Index(line, "#"); idx != -1 {
			line = line[:idx]
		}
		line = strings.ReplaceAll(line, "{", " { ")
		line = strings.ReplaceAll(line, "}", " } ")
		line = strings.ReplaceAll(line, ";", " ; ")
		words := strings.Fields(line)

		for i := 0; i < len(words); i++ {
			w := words[i]
			if w == "host" {
				inHostBlock = true
				currentMAC, currentIP = "", ""
			} else if w == "}" {
				if inHostBlock && currentMAC != "" && currentIP != "" {
					macToIP[currentMAC] = currentIP
				}
				inHostBlock = false
			} else if inHostBlock {
				if w == "hardware" && i+2 < len(words) && words[i+1] == "ethernet" {
					currentMAC = strings.ToLower(words[i+2])
					i += 2
				}
				if w == "fixed-address" && i+1 < len(words) {
					currentIP = words[i+1]
					i += 1
				}
			}
		}
	}
	return macToIP
}
