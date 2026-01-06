# How to Host Your Discord Bot for Free on Render.com

Since LocalTunnel requires your PC to be on, hosting on **Render.com** is a great free alternative. It keeps your bot online 24/7.

## Prerequisities
1. A **GitHub** account (free).
2. A **Render** account (free).

---

## Step 1: Upload Your Code to GitHub
You need to put your code in a private repository on GitHub so Render can access it.

1.  **Create a Repository:**
    *   Go to [GitHub.com](https://github.com/new).
    *   Name it `discord-roblox-bot`.
    *   Select **Private**.
    *   Click **Create repository**.

2.  **Upload Files:**
    *   On the new repo page, look for **"uploading an existing file"**.
    *   Drag and drop ALL your bot files **EXCEPT** `node_modules` and `.env`.
        *   ✅ `index.js`
        *   ✅ `package.json`
        *   ✅ `deploy-commands.js`
        *   ✅ `config.json`
        *   ✅ `active_tickets.json` / `ticket_counter.json` (if you have them)
    *   Click **Commit changes**.

---

## Step 2: Deploy on Render
1.  Go to [Render.com](https://render.com) and log in.
2.  Click **New +** -> **Web Service**.
3.  Connect your GitHub account and select your `discord-roblox-bot` repository.
4.  **Configure the Service:**
    *   **Name:** `brainrot-bot` (or anything you like)
    *   **Region:** Choose the one closest to you (e.g., US East).
    *   **Branch:** `main` (default).
    *   **Runtime:** `Node` (default).
    *   **Build Command:** `npm install`
    *   **Start Command:** `npm start`
    *   **Plan:** Select **Free**.

5.  **Environment Variables (Crucial!):**
    *   Scroll down to "Environment Variables".
    *   Click "Add Environment Variable".
    *   Add your secrets from your `.env` file:
        *   `DISCORD_TOKEN` = `your_bot_token_here`
        *   `CLIENT_ID` = `your_client_id_here`
        *   `GUILD_ID` = `your_guild_id_here` (if used)

6.  Click **Create Web Service**.

---

## Step 3: Wait & Get URL
1.  Render will now build your bot. Wait for it to say **"Live"** or **"Succeeded"** in the logs.
2.  Once live, look at the top left of the dashboard for your **Service URL**.
    *   It will look like: `https://brainrot-bot.onrender.com`

---

## Step 4: Update Roblox Script
1.  Copy that new Render URL.
2.  Open **Roblox Studio**.
3.  Open `RobloxLinkScript.lua`.
4.  Replace `API_URL` with your new Render URL.
    ```lua
    local API_URL = "https://brainrot-bot.onrender.com"
    ```
5.  **Publish** your Roblox game.

---

## 🎉 Done!
Your bot is now hosted 24/7 for free! You can turn off your PC, and the linking system will still work.

### Note on Render's Free Tier
Render's free web services "spin down" (go to sleep) after 15 minutes of inactivity.
*   **The Problem:** The first time someone tries to link after a while, it might take 30-60 seconds for the bot to wake up.
*   **The Fix:** You can use a free "uptime monitor" service (like **UptimeRobot**) to ping your bot's URL (`https://brainrot-bot.onrender.com`) every 5 minutes. This keeps it awake!
