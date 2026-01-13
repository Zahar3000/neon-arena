// ============================================
// NEON ARENA - Fixed Multiplayer Server
// ============================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: false
    },
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

// Game Constants - FIXED VALUES
const MAX_PLAYERS = 4;
const MAP_WIDTH = 1600;
const MAP_HEIGHT = 1200;
const PLAYER_SPEED = 6;
const BULLET_SPEED = 15;
const BULLET_DAMAGE = 10;  // Reduced from 25 - now takes 10 hits to kill
const FIRE_RATE = 120;
const MAX_HEALTH = 100;
const ENEMY_SPAWN_RATE = 3000;  // Slowed down from 1500ms
const RESPAWN_TIME = 3000;
const INITIAL_ENEMIES = 5;  // Reduced from 10
const MAX_ENEMIES = 12;  // Maximum enemies on screen
const SAFE_SPAWN_RADIUS = 150;  // Distance from enemies when spawning

const PLAYER_COLORS = ['#00F0FF', '#FF003C', '#39FF14', '#BF00FF'];
const rooms = new Map();

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomSpawn() {
    const margin = 100;
    return {
        x: margin + Math.random() * (MAP_WIDTH - margin * 2),
        y: margin + Math.random() * (MAP_HEIGHT - margin * 2)
    };
}

// FIXED: Safe spawn - finds location away from enemies
function getSafeSpawn(enemies) {
    let attempts = 0;
    const margin = 100;
    
    while (attempts < 20) {
        const x = margin + Math.random() * (MAP_WIDTH - margin * 2);
        const y = margin + Math.random() * (MAP_HEIGHT - margin * 2);
        
        let safe = true;
        for (const enemy of enemies) {
            const dist = Math.sqrt((x - enemy.x) ** 2 + (y - enemy.y) ** 2);
            if (dist < SAFE_SPAWN_RADIUS) {
                safe = false;
                break;
            }
        }
        
        if (safe) return { x, y };
        attempts++;
    }
    
    // Fallback to random position if no safe spot found
    return getRandomSpawn();
}

function distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

class GameRoom {
    constructor(roomId, hostId) {
        this.id = roomId;
        this.hostId = hostId;
        this.state = 'waiting';
        this.players = new Map();
        this.bullets = [];
        this.enemies = [];
        this.lastEnemySpawn = 0;
    }

    spawnEnemy() {
        // Don't exceed max enemies
        if (this.enemies.length >= MAX_ENEMIES) return;

        const types = ['normal', 'fast', 'tank'];
        const weights = [0.6, 0.25, 0.15];
        let rand = Math.random();
        let type = 'normal';
        for (let i = 0; i < types.length; i++) {
            rand -= weights[i];
            if (rand <= 0) { type = types[i]; break; }
        }

        const stats = {
            normal: { radius: 18, speed: 2.5, health: 40, color: '#FF5F1F', points: 100 },
            fast: { radius: 14, speed: 4.5, health: 25, color: '#FF3366', points: 150 },
            tank: { radius: 30, speed: 1.2, health: 120, color: '#9933FF', points: 300 }
        };

        const stat = stats[type];
        const spawn = getRandomSpawn();
        this.enemies.push({
            id: `enemy_${Date.now()}_${Math.random()}`,
            x: spawn.x, y: spawn.y, type,
            radius: stat.radius,
            speed: stat.speed,
            health: stat.health,
            maxHealth: stat.health,
            color: stat.color,
            points: stat.points,
            angle: 0
        });
    }

    addPlayer(socket, nickname) {
        const colorIndex = this.players.size % PLAYER_COLORS.length;
        const spawn = getSafeSpawn(this.enemies);
        const player = {
            id: socket.id,
            socketId: socket.id,
            nickname: nickname || `Игрок ${this.players.size + 1}`,
            x: spawn.x, y: spawn.y,
            angle: 0,
            color: PLAYER_COLORS[colorIndex],
            health: MAX_HEALTH,
            score: 0,
            alive: true,
            respawnTime: 0,
            lastShot: 0,
            input: {}
        };
        this.players.set(socket.id, player);
        socket.join(this.id);
        socket.roomId = this.id;
        return player;
    }

    removePlayer(socketId) {
        const player = this.players.get(socketId);
        this.players.delete(socketId);
        if (this.hostId === socketId && this.players.size > 0) {
            this.hostId = this.players.keys().next().value;
        }
        return player;
    }

    update(currentTime) {
        if (this.state !== 'playing') return;

        for (const player of this.players.values()) {
            if (!player.alive) {
                if (currentTime > player.respawnTime) {
                    const spawn = getSafeSpawn(this.enemies);
                    player.x = spawn.x; player.y = spawn.y;
                    player.health = MAX_HEALTH;
                    player.alive = true;
                    player.score = Math.max(0, player.score - 25);
                }
                continue;
            }

            if (player.input) {
                let dx = 0, dy = 0;
                
                // Support joystick input (moveX/moveY)
                if (player.input.moveX !== undefined || player.input.moveY !== undefined) {
                    dx = player.input.moveX || 0;
                    dy = player.input.moveY || 0;
                }
                
                // Also support keyboard input (up/down/left/right)
                if (player.input.up) dy -= 1;
                if (player.input.down) dy += 1;
                if (player.input.left) dx -= 1;
                if (player.input.right) dx += 1;

                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) {
                    dx = (dx / len) * PLAYER_SPEED;
                    dy = (dy / len) * PLAYER_SPEED;
                }
                player.x += dx; player.y += dy;
                player.x = Math.max(20, Math.min(MAP_WIDTH - 20, player.x));
                player.y = Math.max(20, Math.min(MAP_HEIGHT - 20, player.y));
            }

            if (player.input && player.input.angle !== undefined) {
                player.angle = player.input.angle;
            }

            if (player.input && player.input.shooting && player.alive) {
                if (currentTime - player.lastShot >= FIRE_RATE) {
                    this.fireBullet(player);
                    player.lastShot = currentTime;
                }
            }
        }

        // Update bullets
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i];
            bullet.x += bullet.vx; bullet.y += bullet.vy;
            if (bullet.x < 0 || bullet.x > MAP_WIDTH || bullet.y < 0 || bullet.y > MAP_HEIGHT) {
                this.bullets.splice(i, 1);
                continue;
            }
            for (let j = this.enemies.length - 1; j >= 0; j--) {
                const enemy = this.enemies[j];
                if (distance(bullet, enemy) < bullet.radius + enemy.radius) {
                    enemy.health -= BULLET_DAMAGE;
                    this.bullets.splice(i, 1);
                    if (enemy.health <= 0) {
                        if (bullet.ownerId && this.players.has(bullet.ownerId)) {
                            this.players.get(bullet.ownerId).score += enemy.points;
                        }
                        this.enemies.splice(j, 1);
                    }
                    break;
                }
            }
        }

        // Update enemies
        for (const enemy of this.enemies) {
            let nearestPlayer = null;
            let nearestDist = Infinity;
            for (const player of this.players.values()) {
                if (!player.alive) continue;
                const dist = distance(enemy, player);
                if (dist < nearestDist) { nearestDist = dist; nearestPlayer = player; }
            }
            if (nearestPlayer) {
                const dx = nearestPlayer.x - enemy.x;
                const dy = nearestPlayer.y - enemy.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                enemy.x += (dx / dist) * enemy.speed;
                enemy.y += (dy / dist) * enemy.speed;
                enemy.angle = Math.atan2(dy, dx);
                
                // FIXED: Reduced damage per hit
                for (const player of this.players.values()) {
                    if (!player.alive) continue;
                    if (distance(enemy, player) < enemy.radius + 18) {
                        player.health -= enemy.type === 'tank' ? 8 : 5;
                        if (player.health <= 0) {
                            player.alive = false;
                            player.respawnTime = currentTime + RESPAWN_TIME;
                            player.health = 0;
                        }
                    }
                }
            }
        }

        // Spawn enemies (slower rate)
        if (currentTime - this.lastEnemySpawn > ENEMY_SPAWN_RATE && this.enemies.length < MAX_ENEMIES) {
            this.spawnEnemy();
            this.lastEnemySpawn = currentTime;
        }
    }

    fireBullet(player) {
        const angle = player.angle;
        const bullet = {
            id: `bullet_${Date.now()}_${Math.random()}`,
            x: player.x + Math.cos(angle) * 25,
            y: player.y + Math.sin(angle) * 25,
            vx: Math.cos(angle) * BULLET_SPEED,
            vy: Math.sin(angle) * BULLET_SPEED,
            radius: 5,
            ownerId: player.id
        };
        this.bullets.push(bullet);
    }

    getState() {
        const playerArray = [];
        for (const player of this.players.values()) {
            playerArray.push({
                id: player.id, nickname: player.nickname,
                x: player.x, y: player.y, angle: player.angle,
                color: player.color, health: player.health,
                score: player.score, alive: player.alive
            });
        }
        return {
            id: this.id, state: this.state,
            players: playerArray, bullets: this.bullets, enemies: this.enemies,
            hostId: this.hostId, playerCount: this.players.size
        };
    }
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('joinRoom', (data) => {
        let { roomId, nickname } = data;
        
        if (!nickname || nickname.trim().length < 1) {
            socket.emit('error', { message: 'Введите никнейм!' });
            return;
        }

        let room;
        if (roomId) {
            room = rooms.get(roomId.toUpperCase());
            if (!room) {
                socket.emit('error', { message: 'Комната не найдена!' });
                return;
            }
            if (room.players.size >= MAX_PLAYERS) {
                socket.emit('error', { message: 'Комната заполнена!' });
                return;
            }
        } else {
            roomId = generateRoomId();
            room = new GameRoom(roomId, socket.id);
            rooms.set(roomId, room);
        }

        room.addPlayer(socket, nickname.trim());
        
        socket.emit('roomJoined', {
            roomId: room.id,
            playerId: socket.id,
            isHost: socket.id === room.hostId,
            state: room.getState()
        });

        socket.to(room.id).emit('playerJoined', {
            player: room.players.get(socket.id)
        });

        console.log(`Player ${socket.id} (${nickname}) joined room ${room.id}`);
    });

    socket.on('input', (input) => {
        const room = rooms.get(socket.roomId);
        if (room && room.players.has(socket.id)) {
            room.players.get(socket.id).input = input;
        }
    });

    socket.on('startGame', () => {
        const room = rooms.get(socket.roomId);
        if (room && socket.id === room.hostId) {
            room.state = 'playing';
            room.enemies = []; room.bullets = []; room.lastEnemySpawn = Date.now();
            for (const player of room.players.values()) {
                const spawn = getSafeSpawn([]);
                player.x = spawn.x; player.y = spawn.y;
                player.health = MAX_HEALTH; player.score = 0; player.alive = true;
            }
            // FIXED: Spawn fewer initial enemies
            for (let i = 0; i < INITIAL_ENEMIES; i++) room.spawnEnemy();
            io.to(room.id).emit('gameStarted', room.getState());
            console.log(`Game started in room ${room.id}`);
        }
    });

    // FIXED: Chat disabled - removed handler
    socket.on('chat', () => {
        // Chat disabled - do nothing
    });

    socket.on('disconnect', (reason) => {
        const room = rooms.get(socket.roomId);
        if (room) {
            room.removePlayer(socket.id);
            socket.to(room.id).emit('playerLeft', { playerId: socket.id });
            if (room.players.size === 0) {
                rooms.delete(room.id);
                console.log(`Room ${room.id} deleted (empty)`);
            } else if (room.state === 'waiting') {
                io.to(room.id).emit('hostChanged', { hostId: room.hostId });
            }
        }
        console.log('Player disconnected:', socket.id, reason);
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', players: io.engine.clientsCount });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     NEON ARENA SERVER STARTED         ║');
    console.log('╠════════════════════════════════════════╣');
    console.log('║  Port: ' + PORT);
    console.log('║  Fixed: movement, spawn, health, enemies');
    console.log('╚════════════════════════════════════════╝');
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err.message);
});

// Game Loop - 60 TPS
setInterval(() => {
    const currentTime = Date.now();
    for (const room of rooms.values()) {
        room.update(currentTime);
        io.to(room.id).emit('gameUpdate', room.getState());
    }
}, 1000 / 60);
