# pf-warden 🛡️

**A lightweight, self-hosted device access manager for FreeBSD `pf` firewalls.**

`pf-warden` provides a beautiful Web UI to control internet access for devices on your FreeBSD home router or homelab. Instead of manually editing firewall rules or tracking down constantly changing IP addresses, `pf-warden` allows you to block or unblock devices with a single click based on their **MAC Addresses**.

## ✨ Features
* **Zero-Dependency Web UI:** A fast, responsive Single Page Application (SPA) built with Vanilla JS and Tailwind CSS.
* **Smart MAC-to-IP Translation:** Devices change IPs. `pf-warden` uses a background "Reconciliation Loop" to constantly monitor live `arp` tables, active `dhcpd.leases`, and static `dhcpd.conf` reservations to ensure blocked devices stay blocked, even if they pull a new IP.
* **Strict Privilege Separation:** The web server runs as an unprivileged user. Firewall updates are executed atomically via a compiled Go wrapper (`pf-block-sync`) authorized strictly through `doas`.
* **CGO-Free SQLite:** Uses a pure-Go SQLite database, making cross-compiling for FreeBSD incredibly easy.
* **Secure Authentication:** Built-in user management with `bcrypt` password hashing and `HttpOnly` session cookies to prevent XSS attacks.

---

## 🏗️ Architecture & Security Model

Directly modifying a firewall from a web application is historically dangerous. `pf-warden` solves this using two isolated components:

1. **The Web API (`pf-warden`)**: Runs as an unprivileged system user (`pfwarden`). It serves the UI, manages the SQLite database, and runs the background reconciliation loop to map MAC addresses to active IPs. 
2. **The Firewall Wrapper (`pf-block-sync`)**: A tiny, compiled CLI tool that accepts a list of IPs via standard input and atomically swaps the `pf` table (`pfctl -t blocklist_internal -T replace`). The web API is only permitted to run this specific binary via `doas` without a password. Command injection is impossible by design.

---

## ⚙️ Configuration (Environment Variables)

`pf-warden` is configured entirely via environment variables. If deploying via FreeBSD `rc.d`, these are exported in the service script.

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PFW_LISTEN_ADDR` | `:8080` | The `IP:PORT` the web server binds to. |
| `PFW_DB_PATH` | `pf_warden.db` | Path to the SQLite database. |
| `PFW_PUBLIC_DIR` | `./public` | Path to the HTML/JS/CSS static assets. |
| `PFW_DHCP_LEASES` | `/var/db/dhcpd/dhcpd.leases` | Path to the ISC DHCP active leases file. |
| `PFW_DHCP_CONF` | `/usr/local/etc/dhcpd.conf` | Path to the ISC DHCP config (for static IPs). |
| `PFW_WRAPPER_CMD` | `doas` | The privilege escalation command. |
| `PFW_WRAPPER_ARGS` | `/usr/local/bin/pf-block-sync` | The arguments passed to the wrapper command. |

---

## 🚀 Installation on FreeBSD

### 1. Build the Binaries
You can compile these directly on FreeBSD, or cross-compile from Mac/Linux:
```bash
# Build the main web app
GOOS=freebsd GOARCH=amd64 go build -o pf-warden .

# Build the secure CLI wrapper
cd cmd/pf-block-sync
GOOS=freebsd GOARCH=amd64 go build -o pf-block-sync .
```

### 2. System Preparation
Create a dedicated user and install the files:
```bash
# Create unprivileged service user
doas pw useradd pfwarden -d /nonexistent -s /usr/sbin/nologin -c "pf-warden service"

# Install binaries
doas install -m 555 pf-warden /usr/local/bin/
doas install -m 555 pf-block-sync /usr/local/bin/

# Setup Web Assets
doas mkdir -p /usr/local/share/pf-warden/public
doas cp -r public/* /usr/local/share/pf-warden/public/

# Setup Database Directory
doas mkdir -p /var/db/pf-warden
doas chown pfwarden:wheel /var/db/pf-warden
```

### 3. Configure `pf` and `doas`
Ensure your `/etc/pf.conf` has the blocklist table defined and actively blocking traffic from reaching the internet:
```pf
table <blocklist_internal> persist
block log quick on $lan_if from <blocklist_internal> to ! $lan_net
```
*Reload pf:* `doas pfctl -f /etc/pf.conf`

Next, allow the web app to execute the sync tool by adding this to `/usr/local/etc/doas.conf`:
```text
permit nopass pfwarden as root cmd /usr/local/bin/pf-block-sync
```

### 4. Create the `rc.d` Service
Copy `scripts/pfwarden` to `/usr/local/etc/rc.d/pfwarden`

```bash
doas cp scripts/pfwarden /usr/local/etc/rc.d/
doas chmod 555 /usr/local/etc/rc.d/pfwarden
doas sysrc pfwarden_enable="YES"
```

---

## 🧑‍💻 Usage

### Create the initial Admin user
Before starting the service, you must create an admin account using the CLI flags. *(Run this as root to ensure the DB file is created with the correct permissions).*
```bash
doas env PFW_DB_PATH="/var/db/pf-warden/pf_warden.db" /usr/local/bin/pf-warden -user admin -pass YourSecurePassword

# Ensure the service user owns the newly created database
doas chown pfwarden:wheel /var/db/pf-warden/pf_warden.db
```

### Start the Service
```bash
doas service pfwarden start
```

### Access the Web UI
Navigate to `http://<your-router-ip>:8080` in your web browser, log in, and start managing your network!

---

## 📸 Screenshots
*(Add screenshots of your Dashboard and Login screen here!)*

## 📝 License
This project is licensed under the MIT License. See the `LICENSE` file for details.