// ============================================
// NEON ARENA - Multiplayer Game Server
// ============================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Important: Allow all origins for Socket.io
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game Constants
const MAX_PLAYERS = 4;
const MAP_WIDTH = 1600;
const MAP_HEIGHT = 1200;
const PLAYER_SPEED = 6;
const BULLET_SPEED = 15;
const BULLET_DAMAGE = 25;
const FIRE_RATE = 100;
const MAX_HEALTH = 100;
const ENEMY_SPAWN_RATE = 1500;
const RESPAWN_TIME = 3000;

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
        this.spawnEnemy();
        this.spawnEnemy();
    }

    spawnEnemy() {
        const types = ['normal', 'fast', 'tank'];
        const weights = [0.6, 0.25, 0.15];
        let rand = Math.random();
        let type = 'normal';
        for (let i = 0; i < types.length; i++) {
            rand -= weights[i];
            if (rand <= 0) { type = types[i]; break; }
        }

        const stats = {
            normal: { radius: 18, speed: 2, health: 50, color: '#FF5F1F', points: 100 },
            fast: { radius: 14, speed: 4, health: 30, color: '#FF3366', points: 150 },
            tank: { radius: 35, speed: 1, health: 150, color: '#9933FF', points: 300 }
        };

        const stat = stats[type];
        const spawn = getRandomSpawn();
        this.enemies.push({
            id: `enemy_${Date.now()}_${Math.random()}`,
            x: spawn.x, y: spawn.y, type,
            radius: stat.radius,
            speed: stat.speed * (1 + this.getWaveMultiplier()),
            health: stat.health * this.getWaveMultiplier(),
            maxHealth: stat.health * this.getWaveMultiplier(),
            color: stat.color, points: stat.points, angle: 0
        });
    }

    getWaveMultiplier() {
        const playerCount = this.players.size;
        return 1 + (playerCount - 1) * 0.3;
    }

    addPlayer(socket, nickname) {
        const colorIndex = this.players.size % PLAYER_COLORS.length;
        const spawn = getRandomSpawn();
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
            lastShot: 0
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
                    const spawn = getRandomSpawn();
                    player.x = spawn.x; player.y = spawn.y;
                    player.health = MAX_HEALTH;
                    player.alive = true;
                    player.score = Math.max(0, player.score - 50);
                }
                continue;
            }

            if (player.input) {
                let dx = 0, dy = 0;
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
                for (const player of this.players.values()) {
                    if (!player.alive) continue;
                    if (distance(enemy, player) < enemy.radius + 15) {
                        player.health -= enemy.type === 'tank' ? 15 : 10;
                        if (player.health <= 0) {
                            player.alive = false;
                            player.respawnTime = currentTime + RESPAWN_TIME;
                        }
                    }
                }
            }
        }

        // Spawn enemies
        if (currentTime - this.lastEnemySpawn > ENEMY_SPAWN_RATE) {
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

// Socket.io handlers
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('joinRoom', (data) => {
        const { roomId, nickname } = data;
        let room;
        if (roomId) {
            room = rooms.get(roomId.toUpperCase());
            if (!room) { socket.emit('error', { message: 'Комната не найдена' }); return; }
            if (room.players.size >= MAX_PLAYERS) { socket.emit('error', { message: 'Комната заполнена' }); return; }
        } else {
            roomId = generateRoomId();
            room = new GameRoom(roomId, socket.id);
            rooms.set(roomId, room);
        }
        room.addPlayer(socket, nickname);
        socket.emit('roomJoined', {
            roomId: room.id, playerId: socket.id,
            isHost: socket.id === room.hostId, state: room.getState()
        });
        socket.to(room.id).emit('playerJoined', { player: room.players.get(socket.id) });
        console.log(`Player ${socket.id} joined room ${room.id}`);
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
                const spawn = getRandomSpawn();
                player.x = spawn.x; player.y = spawn.y;
                player.health = MAX_HEALTH; player.score = 0; player.alive = true;
            }
            for (let i = 0; i < 10; i++) room.spawnEnemy();
            io.to(room.id).emit('gameStarted', room.getState());
            console.log(`Game started in room ${room.id}`);
        }
    });

    socket.on('disconnect', () => {
        const room = rooms.get(socket.roomId);
        if (room) {
            const player = room.removePlayer(socket.id);
            socket.to(room.id).emit('playerLeft', { playerId: socket.id });
            if (room.players.size === 0) {
                rooms.delete(room.id);
                console.log(`Room ${room.id} deleted (empty)`);
            } else if (room.state === 'waiting') {
                io.to(room.id).emit('hostChanged', { hostId: room.hostId });
            }
        }
        console.log('Player disconnected:', socket.id);
    });
});

// Game Loop
setInterval(() => {
    const currentTime = Date.now();
    for (const room of rooms.values()) {
        room.update(currentTime);
        io.to(room.id).emit('gameUpdate', room.getState());
    }
}, 1000 / 60);

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('NEON ARENA SERVER RUNNING');
    console.log('Port:', PORT);
    console.log('Environment:', process.env.NODE_ENV || 'development');
});

// Error handlers
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err.message);
});
