# Neon Arena - Multiplayer Shooter

A real-time top-down shooter game with multiplayer support using Socket.io.

## Quick Deploy to Render.com (Free)

### Option 1: Automatic Deploy via GitHub

1. **Push to GitHub:**
   ```bash
   cd /workspace/game
   git init
   git add .
   git commit -m "Initial commit"
   git create neon-arena
   git push origin main
   ```

2. **Deploy to Render:**
   - Go to https://dashboard.render.com
   - Sign up/Login with GitHub
   - Click "New +" → "Web Service"
   - Select your repository
   - Configure:
     - **Name:** neon-arena
     - **Environment:** Node
     - **Build Command:** `npm install`
     - **Start Command:** `node server.js`
   - Click "Create Web Service"

3. **Your URL will be:** `https://neon-arena.onrender.com`

### Option 2: Manual Upload

1. Go to https://dashboard.render.com
2. Sign up/Login
3. Click "New +" → "Web Service"
4. Select "Upload Files"
5. Upload the `game` folder contents
6. Configure as above

## Keep Server Awake (Free)

Render free tier sleeps after 15 minutes of inactivity. To prevent this:

### Use UptimeRobot (Free)

1. Go to https://uptimerobot.com
2. Create free account
3. Add new monitor:
   - **Monitor Type:** HTTP(s)
   - **URL:** Your Render app URL
   - **Interval:** Every 5 minutes

Your server will stay awake 24/7!

## Local Development

```bash
cd game
npm install
npm start
# Open http://localhost:3000
```

## Features

- Multiplayer support (up to 4 players)
- Real-time gameplay with Socket.io
- Multiple enemy types
- Wave system
- Score tracking
- Character colors for players

## Controls

- **WASD** - Movement
- **Mouse** - Aiming
- **Left Click** - Shooting
- **Enter** - Send chat message

## Tech Stack

- Node.js + Express
- Socket.io for real-time communication
- HTML5 Canvas for rendering

## Troubleshooting

**Server sleeps immediately:**
- Add UptimeRobot ping every 5 minutes

**WebSocket connection failed:**
- Check Render logs for errors
- Ensure port 3000 is not blocked

**Players can't join:**
- Share the full Render URL
- Ensure all players use the same Room Code
