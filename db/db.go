package db

import (
	"database/sql"
	"fmt"
	"log"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

var DB *sql.DB

func InitDB(dataSourceName string) error {
	var err error

	// Open the database using the modernc pure-Go driver
	DB, err = sql.Open("sqlite", dataSourceName)
	if err != nil {
		return err
	}

	// Enable Write-Ahead Logging (WAL) for performance and Foreign Keys for data integrity
	_, err = DB.Exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA foreign_keys = ON;
	`)
	if err != nil {
		return fmt.Errorf("failed to set pragmas: %v", err)
	}

	err = createTables()
	if err != nil {
		return err
	}

	err = seedAdminUser()
	if err != nil {
		return err
	}

	return nil
}

func createTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS sessions (
		token TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		expires_at DATETIME NOT NULL,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS devices (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		is_blocked BOOLEAN NOT NULL DEFAULT 0,
		tags TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS device_macs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_id INTEGER NOT NULL,
		mac_address TEXT NOT NULL UNIQUE,
		interface_type TEXT,
		FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
	);
	`
	_, err := DB.Exec(schema)
	return err
}

func seedAdminUser() error {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return err
	}

	// If no users exist, create the default admin/admin account
	if count == 0 {
		hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
		if err != nil {
			return err
		}

		_, err = DB.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", string(hash))
		if err != nil {
			return err
		}
		log.Println("Database seeded with default user: admin / admin")
	}

	return nil
}

// UpsertUser creates a new user or updates the password if the user already exists
func UpsertUser(username, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	var id int
	err = DB.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&id)

	if err == sql.ErrNoRows {
		// User doesn't exist, create them
		_, err = DB.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", username, string(hash))
		if err != nil {
			return fmt.Errorf("failed to insert user: %v", err)
		}
		log.Printf("Successfully created new user: %s\n", username)
		return nil
	} else if err != nil {
		return fmt.Errorf("database error: %v", err)
	}

	// User exists, update password
	_, err = DB.Exec("UPDATE users SET password_hash = ? WHERE id = ?", string(hash), id)
	if err != nil {
		return fmt.Errorf("failed to update user: %v", err)
	}
	log.Printf("Successfully updated password for existing user: %s\n", username)
	return nil
}
