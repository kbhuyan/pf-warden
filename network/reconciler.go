package network

import (
	"database/sql"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"
)

// Config holds the environment-specific paths for the reconciler
type Config struct {
	DHCPLeasesFile string
	DHCPConfFile   string
	WrapperCmd     string
	WrapperArgs    []string
}

func StartReconciler(db *sql.DB, interval time.Duration, cfg *Config) {
	log.Printf("Starting Network Reconciler loop (every %v)", interval)
	ticker := time.NewTicker(interval)

	go func() {
		for range ticker.C {
			reconcile(db, cfg)
		}
	}()
}

func reconcile(db *sql.DB, cfg *Config) {
	// 1. Get all MAC addresses that belong to blocked devices
	query := `
		SELECT m.mac_address 
		FROM device_macs m 
		JOIN devices d ON m.device_id = d.id 
		WHERE d.is_blocked = 1
	`
	rows, err := db.Query(query)
	if err != nil {
		log.Printf("Reconciler Error querying DB: %v", err)
		return
	}
	defer rows.Close()

	blockedMACs := make(map[string]bool)
	for rows.Next() {
		var mac string
		if err := rows.Scan(&mac); err == nil {
			blockedMACs[strings.ToLower(mac)] = true
		}
	}

	// Fast exit if nobody is blocked
	if len(blockedMACs) == 0 {
		pushToFirewall([]string{}, cfg)
		return
	}

	// 2. Gather network state from all 3 sources
	arpMap := GetArpLeases()
	dhcpMap := GetCurrentLeases(cfg.DHCPLeasesFile)
	staticMap := GetStaticReservations(cfg.DHCPConfFile)

	// 3. Find active IPs for the blocked MACs (using a Set to avoid duplicates)
	blockedIPs := make(map[string]bool)

	for mac := range blockedMACs {
		if ip, exists := arpMap[mac]; exists {
			blockedIPs[ip] = true
		}
		if ip, exists := dhcpMap[mac]; exists {
			blockedIPs[ip] = true
		}
		if ip, exists := staticMap[mac]; exists {
			blockedIPs[ip] = true
		}
	}

	// Convert map keys to slice
	var finalIPList []string
	for ip := range blockedIPs {
		finalIPList = append(finalIPList, ip)
	}

	// 4. Push to pf-block-sync
	pushToFirewall(finalIPList, cfg)
}

func pushToFirewall(ips []string, cfg *Config) {
	input := strings.Join(ips, "\n") + "\n"

	// Check if the wrapper binary actually exists on this system
	// If not, we just log what we *would* have done (Great for local testing on Mac/Windows)
	if _, err := exec.LookPath(cfg.WrapperCmd); err != nil {
		log.Printf("[DEV MODE] Would have blocked IPs: %v", ips)
		return
	}

	cmd := exec.Command(cfg.WrapperCmd, cfg.WrapperArgs...)
	cmd.Stdin = strings.NewReader(input)

	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("pf-block-sync failed: %v | Output: %s", err, string(output))
		return
	}

	fmt.Printf("Reconciler pushed %d blocked IPs to pf.\n", len(ips))
}
