package api

import (
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/kbhuyan/pf-warden/db"
	"github.com/kbhuyan/pf-warden/network"
)

// --- Data Models ---

type Device struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	IsBlocked bool      `json:"is_blocked"`
	Tags      []string  `json:"tags"`
	MACs      []MacAddr `json:"macs"`
}

type MacAddr struct {
	ID            int                      `json:"id"`
	DeviceID      int                      `json:"device_id"`
	MacAddress    string                   `json:"mac_address"`
	InterfaceType string                   `json:"interface_type"`
	LiveInfo      *network.LiveNetworkInfo `json:"live_info"`
}

// --- Handlers ---

// GetDevices returns all devices and their associated MAC addresses
func GetDevices(c *gin.Context) {
	// 1. Fetch all devices
	rows, err := db.DB.Query("SELECT id, name, is_blocked, IFNULL(tags, '') FROM devices ORDER BY name ASC")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch devices"})
		return
	}
	defer rows.Close()

	deviceMap := make(map[int]*Device)
	var devices []*Device

	for rows.Next() {
		d := &Device{MACs: []MacAddr{}, Tags: []string{}}
		var tagsCSV string
		if err := rows.Scan(&d.ID, &d.Name, &d.IsBlocked, &tagsCSV); err == nil {
			// Convert ",alex,phone," back to ["alex", "phone"]
			if tagsCSV != "" {
				clean := strings.Trim(tagsCSV, ",")
				if clean != "" {
					d.Tags = strings.Split(clean, ",")
				}
			}
			deviceMap[d.ID] = d
			devices = append(devices, d)
		}
	}

	// 2. Fetch all MACs and attach them to their devices
	// also update the live info for each mac
	network.CacheLock.RLock() // Use Read-Lock for thread safety
	macRows, err := db.DB.Query("SELECT id, device_id, mac_address, interface_type FROM device_macs")
	if err == nil {
		defer macRows.Close()
		for macRows.Next() {
			var m MacAddr
			if err := macRows.Scan(&m.ID, &m.DeviceID, &m.MacAddress, &m.InterfaceType); err == nil {
				if dev, exists := deviceMap[m.DeviceID]; exists {
					// LOOKUP IN CACHE
					if info, found := network.LiveCache[strings.ToLower(m.MacAddress)]; found {
						m.LiveInfo = &info
					}
					dev.MACs = append(dev.MACs, m)
				}
			}
		}
	}
	network.CacheLock.RUnlock()

	// Return empty array instead of null if no devices exist
	if devices == nil {
		devices = []*Device{}
	}

	c.JSON(http.StatusOK, devices)
}

// CreateDevice creates a new device profile
func CreateDevice(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	res, err := db.DB.Exec("INSERT INTO devices (name) VALUES (?)", req.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create device"})
		return
	}

	id, _ := res.LastInsertId()
	c.JSON(http.StatusOK, gin.H{"id": id, "name": req.Name, "is_blocked": false, "macs": []MacAddr{}})
}

// DeleteDevice removes a device (and cascades to its MACs)
func DeleteDevice(c *gin.Context) {
	id := c.Param("id")
	_, err := db.DB.Exec("DELETE FROM devices WHERE id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete device"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Device deleted"})
}

// ToggleBlock updates the is_blocked status
func ToggleBlock(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		IsBlocked bool `json:"is_blocked"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	_, err := db.DB.Exec("UPDATE devices SET is_blocked = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", req.IsBlocked, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update block status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Block status updated"})
}

// AddMacAddress adds a MAC address to a specific device
func AddMacAddress(c *gin.Context) {
	deviceID := c.Param("id")
	var req struct {
		MacAddress    string `json:"mac_address" binding:"required"`
		InterfaceType string `json:"interface_type"` // e.g. "WiFi" or "Ethernet"
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "MAC address is required"})
		return
	}

	// Strictly validate and normalize the MAC address format
	hw, err := net.ParseMAC(req.MacAddress)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid MAC address format"})
		return
	}
	normalizedMac := hw.String() // Ensures it looks like aa:bb:cc:dd:ee:ff

	res, err := db.DB.Exec("INSERT INTO device_macs (device_id, mac_address, interface_type) VALUES (?, ?, ?)", deviceID, normalizedMac, req.InterfaceType)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "MAC address already exists or invalid device ID"})
		return
	}

	id, _ := res.LastInsertId()
	c.JSON(http.StatusOK, gin.H{"id": id, "device_id": deviceID, "mac_address": normalizedMac, "interface_type": req.InterfaceType})
}

// RemoveMacAddress deletes a MAC address
func RemoveMacAddress(c *gin.Context) {
	macID := c.Param("mac_id")
	_, err := db.DB.Exec("DELETE FROM device_macs WHERE id = ?", macID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete MAC address"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "MAC address deleted"})
}

// Helper to normalize tags: [" Phone ", "ALEX"] -> ",phone,alex,"
func normalizeTags(tags []string) string {
	if len(tags) == 0 {
		return ""
	}
	var clean []string
	for _, t := range tags {
		trimmed := strings.ToLower(strings.TrimSpace(t))
		if trimmed != "" {
			clean = append(clean, trimmed)
		}
	}
	if len(clean) == 0 {
		return ""
	}
	return "," + strings.Join(clean, ",") + ","
}

// UpdateDeviceTags replaces the tags for a specific device
func UpdateDeviceTags(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Tags []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	tagStr := normalizeTags(req.Tags)
	_, err := db.DB.Exec("UPDATE devices SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", tagStr, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update tags"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Tags updated"})
}

// BlockByTag toggles is_blocked for all devices matching a specific tag
func BlockByTag(c *gin.Context) {
	var req struct {
		Tag       string `json:"tag" binding:"required"`
		IsBlocked bool   `json:"is_blocked"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Tag and block status are required"})
		return
	}

	// The safe comma-wrapped search pattern
	searchPattern := "%," + strings.ToLower(strings.TrimSpace(req.Tag)) + ",%"

	_, err := db.DB.Exec("UPDATE devices SET is_blocked = ?, updated_at = CURRENT_TIMESTAMP WHERE tags LIKE ?", req.IsBlocked, searchPattern)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update devices"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Devices updated successfully"})
}
