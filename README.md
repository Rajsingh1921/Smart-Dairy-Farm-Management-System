# Smart Dairy Farm Manager

A full-stack web app for running a dairy farm in Maharashtra, in **English and Marathi**.
Built with **React (Vite)**, **Node.js / Express** and **MySQL**. All data is stored in MySQL on your own computer or server, not in the browser.

- Currency INR (₹, Indian digit grouping: ₹1,23,456.00), quantities in litres and kilograms
- Dates shown and typed as **DD-MM-YYYY**; all "today" logic uses **Asia/Kolkata**
- Works on mobile phones and desktop computers

> **About figures:** the app starts **empty**. It never invents business numbers. The optional demo data
> (`npm run seed:demo`) is clearly labelled: tags and names start with `DEMO`, and every screen and printout shows a
> yellow **"DEMO DATA"** banner. Remove it with `npm run clear-data -- --confirm` before entering real records.

---

## 1. Features

| Module | What you can do |
|---|---|
| **Dashboard** | Animal counts by category/species, pregnant & milking counts, today's milk (morning/evening), 30-day milk chart, where today's milk went (sold / household / calves / wastage / not recorded), today's sales, this month's profit, customer dues, expenses by category, upcoming & overdue reminders. Staff do not see money figures. |
| **Animals** | Unique tag IDs, name, species, breed, category, sex, date of birth (with "approximate" flag), age, photo, mother (dam), sire/semen details, source, purchase date/price/seller, pregnancy status, expected calving, lactation number, notes. Status changes (sold / dead / transferred / back to active, category moves) are **kept in history**; sold animals stay in the records. Filters + CSV. |
| **Milk production** | Fast daily entry sheet per session (Enter moves to next cow), fat %/SNF %, records list with date filters, **edit history** (old → new, who, when, reason; deletions logged too), daily totals, milk use (household, calf feeding, wastage, other) and a **produced vs sold vs used** reconciliation. |
| **Customers & sales** | Customer profiles with usual morning/evening quantity and rate, daily **delivery sheet** ("Fill usual quantities" in one click), invoices for any period, **partial payments**, printable invoices and receipts, statements with running balance, outstanding balances and advances. |
| **Feed & inventory** | Items with units, low-stock alert level, opening stock, purchases (with supplier and unit price), usage, stock corrections, remaining stock, 30-day usage and "days left", suppliers, low-stock reminders. |
| **Health** | Vet visits, symptoms, **diagnosis and medicines exactly as the veterinarian wrote them**, vaccinations (single animal or the whole herd), deworming, next-dose due dates, follow-ups, costs. The app **never diagnoses or suggests treatment**. |
| **Breeding** | Heat observations, AI / natural service with semen details, pregnancy checks, expected calving (from species gestation days, editable), calving with **automatic calf registration linked to the mother**, abortion, breeding status board. |
| **Finance** | Expenses (feed, medicine & vet, breeding/AI, wages, electricity, transport, equipment, animal purchase, repairs, other – categories are editable), other income (animal sales, manure, subsidy, insurance), daily / monthly / yearly **profit and cash flow** with an explanation of exactly how it is calculated. |
| **Employees & tasks** | Staff list, job roles, monthly salary, salary/advance/bonus payments (become wage expenses), task assignment with due dates and priority, start/complete tracking with completion notes. |
| **Reminders** | Computed live: vaccinations & deworming due, vet follow-ups, pregnancy checks due, expected calvings, overdue customer invoices, low stock, task due dates, plus your own manual reminders. |
| **Reports** | 12 printable reports (A4 print layout) with CSV download that opens correctly in Excel (including Marathi text). |
| **Backup** | One-click full backup download / restore in Settings, plus command-line SQL backups for scheduling. |
| **Settings** | Farm details, invoice footer, payment terms, reminder windows, users & roles, animal categories (and which are milked), species & gestation days, breeds, expense categories, change password, language. |

---

## 2. Requirements

- **Node.js 20 or newer** – <https://nodejs.org> (LTS version)
- **MySQL 8.0 or newer** (MySQL 9 also works)
  - Windows: *MySQL Installer* from <https://dev.mysql.com/downloads/installer/> (choose "Server only"; remember the root password)
  - macOS: `brew install mysql && brew services start mysql`
  - Ubuntu: `sudo apt install mysql-server`
- A modern browser (Chrome, Edge, Firefox, Safari) on phone or computer

---

## 3. Installation (step by step)

Open a terminal (Windows: *Command Prompt* or *PowerShell*) in this project folder.

```bash
# 1. Install everything (server + client)
npm install

# 2. Create the database, a dedicated MySQL user and server/.env (asks for your MySQL root password once)
npm run setup

# 3. Build the website
npm run build

# 4. Start the app
npm start
```

Open **http://localhost:4000**. The first time, you will see **First-time setup** – create the **owner** account there.
To use it from phones on the same Wi-Fi, open `http://<this-computer's-IP>:4000` (for example `http://192.168.1.10:4000`).

`npm run setup` never stores your MySQL root password. It creates a MySQL user (`dairy_farm_app`) with a long random
password that can only access the `dairy_farm` database, generates a random `JWT_SECRET`, writes `server/.env`
(readable only by you) and creates all tables.

### Manual database setup (alternative to `npm run setup`)

```sql
-- run as MySQL root:  mysql -u root -p
CREATE DATABASE dairy_farm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'dairy_app'@'localhost' IDENTIFIED BY 'choose-a-long-password';
CREATE USER 'dairy_app'@'127.0.0.1' IDENTIFIED BY 'choose-a-long-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, LOCK TABLES ON dairy_farm.* TO 'dairy_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, LOCK TABLES ON dairy_farm.* TO 'dairy_app'@'127.0.0.1';
```

Then copy `server/.env.example` to `server/.env`, fill in the values, and run `npm run migrate` (tables are also created automatically on every `npm start`).

---

## 4. Environment configuration (`server/.env`)

| Variable | Meaning |
|---|---|
| `NODE_ENV` | `production` for normal use, `development` while changing code |
| `PORT` | Web port (default `4000`) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection. Only the server reads these; they are **never sent to the browser**. |
| `JWT_SECRET` | Random secret (at least 32 characters) used to sign login sessions. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SESSION_HOURS` | How long a login lasts (default 12) |
| `SETUP_TOKEN` | Optional. If set, the first-run owner setup page asks for this token. **Set it if the server is reachable from the internet before you create the owner.** |
| `COOKIE_SECURE` | `true` when the site is served over **https**. Must be `false` for plain `http://` use on the farm network, otherwise login will not stick. Defaults to `true` when `NODE_ENV=production` and it is left empty. |
| `TRUST_PROXY` | `true` when running behind nginx/Apache so rate limits see the real client IP |
| `CORS_ORIGIN` | Only if the frontend is served from a different address than the API (not needed normally) |
| `UPLOAD_DIR` | Folder for animal photos (default `server/uploads`) |

---

## 5. Owner / admin account

- **Web (first run):** open the app → *First-time setup* → name, username, password (8+ characters, letters and numbers). This page disables itself permanently once any account exists.
- **Command line:** `npm run create-owner` (asks for name, username, hidden password).
  Forgot the owner password? `npm run create-owner -- --username owner --reset`
- Add other users in **Settings → Users**. Link a staff user to their employee record (Employees → Edit → *App login*) so they see their own tasks.

| Role | Can do |
|---|---|
| **Owner** | Everything, including users, settings, categories, backup/restore |
| **Manager** | All farm work and money, deleting records, editing past milk entries. No users/settings/backup. |
| **Accountant** | Customers, invoices, payments, expenses, income, salaries, finance reports. Read-only for animals/milk. |
| **Staff** | Milk entry (today's corrections only), milk use, deliveries, health & breeding records, feed usage, own tasks. No money pages. |

Every permission is checked **on the server**, not only hidden in the screen.

---

## 6. Using it day to day

1. **Settings → Categories & breeds** – check species, gestation days, breeds and categories (set which categories are milked).
2. **Animals → Add animal** for each animal (purchase price can automatically become an *Animal purchase* expense).
3. **Customers → Add customer** with their rate and usual quantities; enter any old dues as *Opening balance*.
4. **Feed & Inventory** – add items with *opening stock* (not counted as an expense) and a low-stock level.
5. Every morning/evening: **Milk Production → Daily entry**, then **Sales & Billing → Delivery sheet** (*Fill usual quantities* → adjust → *Save*). Record household/calf/wastage under *Household / calf / wastage*.
6. Month end: **Sales & Billing → Invoices → Generate invoices**, print or share them; record payments as they come (receipt opens for printing).
7. Record purchases, vet visits, inseminations and salaries in their own modules – they flow into **Finance** automatically.

### On a phone

- Open `http://<farm-computer-IP>:4000` in Chrome on the same Wi-Fi, then use **⋮ → Add to Home screen** (Safari: **Share → Add to Home Screen**). It opens like an app, with the farm logo as its icon.
- The bottom bar has **Home, Milk, Sales, Animals** and **More** (all other sections). Tabs a person's role cannot use are left out.
- **Home** shows today's milk and four big buttons: *Enter milk*, *Milk delivery*, *Money received*, *Health entry*.
- On the milk and delivery sheets, tap **Morning / Evening** (सकाळ / संध्याकाळ) and use **‹ ›** to change the day. Type litres and press the keyboard's *Next* key to jump to the next animal. Changing a figure that was already saved asks for a reason, which goes into the edit history.
- Lists show only the search box at first; tap **Filters** for more choices. The language button at the top switches between मराठी and English.

---

## 7. How the money calculations work (no double counting)

- **Milk sales** = sum of deliveries (litres × rate). This is the only source of milk revenue.
- **Customer balance** = opening balance + all deliveries − all payments. Positive = they owe you, negative = advance.
- **Invoice paid status** is derived: payments settle the opening balance first, then invoices oldest first. So partial payments and lump-sum payments are always consistent with the balance.
- **Every cost exists exactly once** in the expenses table. Feed purchases, vet/health costs, AI/breeding costs, salaries and animal purchases each create one linked expense automatically; editing or deleting the original record updates or removes it. Linked expenses cannot be edited from Finance (to keep both in step).
- **Using feed from stock is not an expense** – the purchase already was. Opening stock is not an expense either.
- **Profit** = milk sales + other income − expenses.
- **Cash flow** = customer payments received + other income − expenses. Customer payments are *not* added to profit again because they only settle sales already counted.
- Money is stored as `DECIMAL(12,2)`; delivery amounts are computed by the database itself.

---

## 8. Reports & exports

**Reports** page: milk production & use (daily), milk by animal, sales & dues by customer, customer statement, profit & loss, expenses, inventory stock, stock movement, health, breeding, animal register, salaries.
Each has **Print** (clean A4 layout with farm name, period and date generated) and **Download CSV**. Most lists elsewhere also have *Download CSV*. CSV files are UTF-8 with BOM, so Excel shows Marathi correctly; dates in CSV are `YYYY-MM-DD` so Excel sorts them properly.

---

## 9. Backup and restore

**Do this regularly – this is your farm's record.**

**From the app (owner):** Settings → Backup & restore → **Download backup** (one `.json` file with every record).
Restore: choose the file, type `REPLACE`, confirm. This replaces all current data in one transaction (if anything fails, nothing changes) and logs everyone out.

**From the command line:**

```bash
npm run backup                 # server/backups/dairy-YYYY-MM-DD-HH-MM.sql (uses mysqldump if installed, else .json)
npm run backup -- --json       # portable .json backup
npm run restore -- server/backups/dairy-2026-10-29-20-00.sql --yes
npm run restore -- server/backups/dairy-2026-10-29-20-00.json --yes
```

Animal photos live in `server/uploads/`; `npm run backup` copies them to `server/backups/uploads-<date>/`. Copy the `backups` folder to a pen drive or cloud storage.

**Automatic daily backup**
- Linux/macOS (`crontab -e`), every night at 21:30:
  `30 21 * * * cd /path/to/Smart-Dairy-Farm-Management-System && /usr/bin/npm run backup >> server/backups/backup.log 2>&1`
- Windows: Task Scheduler → *Create Basic Task* → Daily → Program `cmd.exe`, arguments
  `/c cd /d "C:\path\to\Smart Dairy Farm Management System" && npm run backup`

---

## 10. Trying the demo data

Use a **separate database** so demo numbers never mix with real records. Easiest: copy the whole project folder
(e.g. `Dairy Demo`), and in the copy:

```bash
npm install
npm run setup            # when asked for the database name, type: dairy_demo
# edit the copy's server/.env and set PORT=4001 so it can run next to the real app
npm run build
npm run seed:demo -- --yes
npm start                # demo on http://localhost:4001
```

The seeder refuses to run on a database that already contains animals or customers. To wipe all farm records
(keeps users, settings and lists): `npm run clear-data -- --confirm`.

---

## 11. Development

```bash
npm run dev:server     # API on http://localhost:4000 (restarts on change)
npm run dev:client     # React dev server on http://localhost:5173 (proxies /api to :4000)
```

Server tests (end-to-end workflows against a **separate** test database – it is wiped on every run):

```bash
# create an empty database dairy_test that DB_USER can access, then:
TEST_DB_NAME=dairy_test npm test
```

The 14 test groups cover: owner setup, login & CSRF protection, roles, animal purchase/sale/history, milk sheet & edit history
& reconciliation, deliveries → invoice → partial payments → FIFO status → statement → invoice locking, inventory stock and linked expenses,
health reminders and costs, breeding → calving with linked calf, salaries & tasks, finance totals (no double counting), CSV reports,
validation/injection safety, user management, and backup/restore round-trip.

---

## 12. Deployment

### A. On a farm computer (simplest)
1. Follow *Installation* above. Keep `COOKIE_SECURE=false` (plain http on your Wi-Fi).
2. Give the computer a fixed local IP in your router; phones use `http://<ip>:4000`.
3. Keep it running: `npm install -g pm2 && pm2 start "npm start" --name dairy && pm2 save && pm2 startup` (Windows: add `npm start` to Task Scheduler "At log on").
4. Allow port 4000 in the firewall for the local network only. Set up the nightly backup.

### B. On an internet server (Ubuntu VPS with HTTPS)
1. Install Node 20+, MySQL 8, nginx; clone/copy the project; `npm install && npm run setup && npm run build`.
2. In `server/.env` set `COOKIE_SECURE=true`, `TRUST_PROXY=true`, and a `SETUP_TOKEN` (create the owner, then you may remove it).
3. `pm2 start "npm start" --name dairy && pm2 save && pm2 startup`
4. nginx site (`/etc/nginx/sites-available/dairy`):
   ```nginx
   server {
     server_name dairy.example.com;
     client_max_body_size 200m;   # backup restore / photos
     location / { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host;
                  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
   }
   ```
5. HTTPS: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d dairy.example.com`
6. Keep MySQL bound to localhost (default) and do not open port 3306 or 4000 to the internet.

### C. On Vercel (website + API, with a cloud MySQL)
Vercel cannot reach the MySQL on your own computer, so first create a **MySQL 8 database online** (any provider with TLS, ideally in an India region). The project already contains `vercel.json` (site in `client/dist`, API in `api/index.js`, Singapore region `sin1`, next to the database) and `.vercelignore` (keeps `.env`, photos and backups out of uploads).

1. Vercel → Project → **Settings → Environment Variables**, for *Production* (and *Preview* if you use it):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the provider's connection address, e.g. `mysql://user:password@host:port/defaultdb?ssl-mode=REQUIRED` (or set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` and `DB_SSL=true` separately) |
   | `DB_SSL_CA` | the provider's CA certificate text, if it uses its own (Aiven does) |
   | `JWT_SECRET` | a new random string — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `SETUP_TOKEN` | another random string; you type it once when creating the owner |

2. Deploy: `npx vercel --prod` from the project folder (or redeploy in the dashboard).
3. Open the site. Tables are created automatically on the first visit. Create the owner account using the `SETUP_TOKEN`.

This project runs on **Aiven for MySQL (free plan, Singapore)**, so `vercel.json` uses the Singapore function region `sin1`, next to the database. The app sets standard MySQL behaviour on every connection, so hosts that default to ANSI mode (Aiven does) work the same as a local MySQL.

On Vercel: **animal photo upload is turned off** (its disk is wiped, so photos would be lost), backup restore is limited to files under about 4 MB, and the first request after a quiet period takes a few seconds. If the login page shows a message such as *Missing required environment variable…* or *Cannot connect to the database…*, fix that setting and redeploy.

**Updating to a new version:** take a backup, replace the code, `npm install && npm run build`, restart. Database changes are applied automatically at start (`server/src/migrations`).

---

## 13. Security

- Passwords hashed with **bcrypt** (cost 12); minimum 8 characters with letters and numbers.
- Sessions are signed JWTs in an **httpOnly, SameSite=strict** cookie (not readable by JavaScript). Changing a password, role or disabling a user signs that user out everywhere.
- Every write request must carry a custom header (CSRF protection) and is **validated on the server** (zod schemas, date checks, ranges).
- **Only parameterized SQL**; foreign keys, unique keys, CHECK constraints and indexes in the database.
- Login rate limiting and account lock for 15 minutes after 5 wrong passwords; general API rate limit.
- Security headers (helmet, Content-Security-Policy). Photo uploads limited to JPG/PNG/WEBP up to 5 MB with random file names, served only to logged-in users.
- Audit log of every create/update/delete (who, when, what) in the `audit_log` table.
- Database credentials live only in `server/.env`; the frontend never sees them. CSV exports guard against spreadsheet formula injection.

---

## 14. Project structure

```
server/
  src/app.js, index.js           Express app and entry point
  src/migrations/*.sql           Database schema (applied automatically)
  src/routes/*.js                API: auth, users, settings, animals, milk, customers, sales, billing,
                                 finance, inventory, health, breeding, employees, tasks, reminders, dashboard, reports, backup
  src/services/*.js              Billing balance/FIFO, finance summary, reminders, linked expenses, backup
  scripts/                       setup, migrate, create-owner, seed-demo, clear-data, backup, restore
  test/workflows.test.js         End-to-end API tests
client/
  src/pages/*.jsx                One page per module (+ printable invoice/receipt)
  src/components/                UI kit, forms, layout
  src/lib/strings.js             All English + Marathi text
```

Main tables: `users, settings, species, breeds, animal_categories, animals, animal_history, milk_records, milk_record_history, milk_usage,
customers, milk_deliveries, invoices, payments, suppliers, inventory_items, inventory_transactions, expense_categories, expenses, other_income,
health_records, breeding_events, employees, salary_payments, tasks, reminders, audit_log, counters`.

---

## 15. Troubleshooting

| Problem | Fix |
|---|---|
| `Missing required environment variable` | Run `npm run setup`, or copy `server/.env.example` to `server/.env` and fill it in. |
| `Access denied for user '..._app'` | Wrong `DB_PASSWORD`/host in `server/.env`; re-run `npm run setup -- --force`. |
| Login works then immediately asks again | You are on `http://` with `COOKIE_SECURE=true`. Set `COOKIE_SECURE=false` or use https. |
| Phones cannot open the site | Use the computer's IP (not `localhost`), same Wi-Fi, allow port 4000 in the firewall. |
| "This record is used by other records and cannot be deleted" | Intended – history is protected. Mark animals Sold/Dead, customers/suppliers/employees Inactive instead. |
| Blank page after updating | Run `npm run build` again, then restart. |

---

## 16. Known limitations

- Single farm per installation (no multi-farm/branch support).
- Inventory purchases, breeding events and salary payments are corrected by **deleting and re-entering** (their linked expense follows automatically); deleting a breeding event does not roll back the pregnancy status it set (edit the animal if needed).
- Supplier credit/payables are not tracked: every expense is treated as paid on its date.
- Milk rates are per customer per delivery; there is no automatic fat/SNF-based rate chart for dairy collection centres (enter the centre's rate on the delivery sheet).
- No SMS/WhatsApp sending of invoices or reminders; reminders are shown in the app (print or share the invoice PDF from the browser's print dialog).
- No offline mode; the phone must reach the server.
- Gestation days and pregnancy-check intervals are configurable averages used only for reminders – they are not veterinary advice.
