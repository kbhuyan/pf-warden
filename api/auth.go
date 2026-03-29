package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kbhuyan/pf-warden/db"
	"golang.org/x/crypto/bcrypt"
)

// LoginRequest represents the expected JSON payload
type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	var id int
	var hash string
	err := db.DB.QueryRow("SELECT id, password_hash FROM users WHERE username = ?", req.Username).Scan(&id, &hash)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	// Verify the password against the bcrypt hash
	err = bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	// Generate a secure session token
	sessionToken := uuid.New().String()
	expiresAt := time.Now().Add(24 * time.Hour)

	// Store session in DB
	_, err = db.DB.Exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", sessionToken, id, expiresAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	// Set HttpOnly cookie
	// params: name, value, maxAge, path, domain, secure, httpOnly
	c.SetCookie("pf_warden_session", sessionToken, 86400, "/", "", false, true)

	c.JSON(http.StatusOK, gin.H{"message": "Logged in successfully"})
}

func Logout(c *gin.Context) {
	cookie, err := c.Cookie("pf_warden_session")
	if err == nil {
		// Delete session from DB
		db.DB.Exec("DELETE FROM sessions WHERE token = ?", cookie)
	}

	// Clear the cookie in the browser
	c.SetCookie("pf_warden_session", "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

// AuthRequired is a Gin middleware that ensures the user has a valid session
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		cookie, err := c.Cookie("pf_warden_session")
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		var userID int
		var expiresAt time.Time
		err = db.DB.QueryRow("SELECT user_id, expires_at FROM sessions WHERE token = ?", cookie).Scan(&userID, &expiresAt)
		if err != nil || expiresAt.Before(time.Now()) {
			// Session invalid or expired
			db.DB.Exec("DELETE FROM sessions WHERE token = ?", cookie)
			c.SetCookie("pf_warden_session", "", -1, "/", "", false, true)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Session expired"})
			return
		}

		// Attach user ID to context for downstream handlers
		c.Set("userID", userID)
		c.Next()
	}
}
