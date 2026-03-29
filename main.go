package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kbhuyan/pf-warden/api"
	"github.com/kbhuyan/pf-warden/db"
	"github.com/kbhuyan/pf-warden/network"
)

type Config struct {
	DBPath        string
	PublicDir     string
	ListenAddr    string
	NetworkConfig network.Config
}

func LoadConfig() *Config {
	cfg := &Config{}
	cfg.DBPath = getEnv("PFW_DB_PATH", "pf_warden.db")
	cfg.PublicDir = getEnv("PFW_PUBLIC_DIR", "./public")
	cfg.ListenAddr = getEnv("PFW_LISTEN_ADDR", ":8080")

	cfg.NetworkConfig = network.Config{
		DHCPLeasesFile: getEnv("PFW_DHCP_LEASES", "/var/db/dhcpd/dhcpd.leases"),
		DHCPConfFile:   getEnv("PFW_DHCP_CONF", "/usr/local/etc/dhcpd.conf"),
		WrapperCmd:     getEnv("PFW_WRAPPER_CMD", "doas"),
		// Split arguments by space so users can pass multiple args via ENV
		WrapperArgs: strings.Fields(getEnv("PFW_WRAPPER_ARGS", "/usr/local/bin/pf-block-sync")),
	}

	log.Printf("Loaded config: %+v\n", cfg)
	return cfg
}

// Helper function to read an environment variable or return a default value
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

func fini(exitCode *int) {
	log.Println("🛑 Shutting down service...")
	// 3. Force SQLite Checkpoint and Close DB
	if db.DB != nil {
		// FORCE CHECKPOINT: Moves data from -wal file to .db file
		// TRUNCATE: Resets the WAL file to 0 bytes
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		log.Println("💾 Checkpointing WAL to main database file...")
		_, err := db.DB.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE);")
		if err != nil {
			log.Println("❌ Failed to checkpoint WAL", "error", err)
			*exitCode = 1
		} else {
			log.Println("✅ WAL checkpoint complete")
		}

		err = db.DB.Close()
		if err != nil {
			log.Println("❌ Failed to close database connection", "error", err)
			*exitCode = 1
		} else {
			log.Println("✅ Database connection closed")
		}
		*exitCode = 0
	}

	log.Println("✅ Service shutdown complete")
	os.Exit(*exitCode)
}

func main() {
	exitCode := 0
	// 1. Define CLI flags
	userFlag := flag.String("user", "", "Username to create or update")
	passFlag := flag.String("pass", "", "Password for the user")
	flag.Parse()

	cfg := LoadConfig()
	// 1.5. Setup Signal Handler
	signalChan := make(chan os.Signal, 1)
	signal.Notify(signalChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-signalChan
		fini(&exitCode)
	}()
	defer fini(&exitCode)

	// 2. Initialize SQLite Database
	err := db.InitDB(cfg.DBPath)
	if err != nil {
		log.Printf("Failed to initialize database: %v", err)
		exitCode = 1
		return
	}

	// 3. Handle CLI User Management
	if *userFlag != "" && *passFlag != "" {
		err := db.UpsertUser(*userFlag, *passFlag)
		if err != nil {
			log.Printf("Error saving user: %v", err)
			exitCode = 1
			return
		}
		// Exit successfully without starting the web server
		exitCode = 0
		return
	} else if *userFlag != "" || *passFlag != "" {
		// If they only provided one of the two flags, throw an error
		log.Printf("Error: Both -user and -pass flags must be provided together.")
		exitCode = 1
		return
	}

	// 4. Start the background reconciler (Runs every 15 seconds)
	network.StartReconciler(db.DB, 15*time.Second, &cfg.NetworkConfig)

	// 5. Setup Gin Router
	r := gin.Default()

	// Define Public API Routes
	apiGroup := r.Group("/api")
	{
		apiGroup.POST("/login", api.Login)
		apiGroup.POST("/logout", api.Logout)
	}

	// Define Protected API Routes
	protected := apiGroup.Group("/")
	protected.Use(api.AuthRequired())
	{
		protected.GET("/me", func(c *gin.Context) {
			userID := c.MustGet("userID").(int)
			c.JSON(http.StatusOK, gin.H{"user_id": userID, "message": "You are authenticated!"})
		})

		protected.GET("/devices", api.GetDevices)
		protected.POST("/devices", api.CreateDevice)
		protected.DELETE("/devices/:id", api.DeleteDevice)
		protected.PUT("/devices/:id/block", api.ToggleBlock)

		protected.PUT("/devices/:id/tags", api.UpdateDeviceTags)
		protected.PUT("/devices/block-by-tag", api.BlockByTag)

		protected.POST("/devices/:id/macs", api.AddMacAddress)
		protected.DELETE("/devices/:id/macs/:mac_id", api.RemoveMacAddress)
	}

	// 6. Serve the Vanilla JS Frontend
	r.StaticFile("/", cfg.PublicDir+"/index.html")
	r.StaticFile("/favicon.svg", cfg.PublicDir+"/favicon.svg")
	r.StaticFile("/favicon.ico", cfg.PublicDir+"/favicon.ico")
	r.Static("/js", cfg.PublicDir+"/js")
	r.Static("/css", cfg.PublicDir+"/css")

	// 7. Start the Server
	log.Printf("Starting pf-warden server on %s...", cfg.ListenAddr)
	if err := r.Run(cfg.ListenAddr); err != nil {
		log.Printf("Failed to run server: %v", err)
		exitCode = 1
		return
	}
}
