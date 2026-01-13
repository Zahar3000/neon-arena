// ============================================
// NEON ARENA - With Power-ups & Smooth Movement
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

// Game Constants - With Power-ups
const MAX_PLAYERS = 4;
const MAP_WIDTH = 1600;
const MAP_HEIGHT = 1200;
const PLAYER_SPEED = 5;
const BULLET_SPEED = 14;
const BULLET_DAMAGE = 20;
const FIRE_RATE = 130;
const MAX_HEALTH = 100;
const ENEMY_SPAWN_RATE = 3500;
const RESPAWN_TIME = 3000;
const INITIAL_ENEMIES = 4;
const MAX_ENEMIES = 10;
const SAFE_SPAWN_RADIUS = 180;
const POWERUP_SPAWN_RATE = 15000;  // New: power-up spawn every 15 seconds
const MAX_POWERUPS = 5;

const PLAYER_COLORS = ['#00F0FF', '#FF003C', '#39FF14', '#BF00FF'];
const rooms = new Map();

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomSpawn() {
    const margin = 120;
    return {
        x: margin + Math.random() * (MAP_WIDTH - margin * 2),
        y: margin + Math.random() * (MAP_HEIGHT - margin * 2)
    };
}

function getSafeSpawn(enemies) {
    let attempts = 0;
    const margin = 120;
    
    while (attempts < 30) {
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
    
    return getRandomSpawn();
}

function distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Power-up types
const POWERUP_TYPES = [
    { type: 'rapid', name: 'Быстрог огонь', color: '#FFFF00', duration: 8000, icon: '⚡' },
    { type: 'power', name: 'Сила', color: '#FF6600', duration: 8000, icon: '💥' },
    { type: 'speed', name: 'Скорость', color: '#00FF88', duration: 6000, icon: '💨' },
    { type: 'shield', name: 'Щит', color: '#00FFFF', duration: 5000, icon: '🛡️' }
];

class GameRoom {
    constructor(roomId, hostId) {
        this.id = roomId;
        this.hostId = hostId;
        this.state = 'waiting';
        this.players = new Map();
        this.bullets = [];
        this.enemies = [];
        this.powerups = [];
        this.lastEnemySpawn = 0;
        this.lastPowerupSpawn = 0;
    }

    spawnEnemy() {
        if (this.enemies.length >= MAX_ENEMIES) return;

        const types = ['normal', 'fast', 'tank'];
        const weights = [0.65, 0.25, 0.10];
        let rand = Math.random();
        let type = 'normal';
        for (let i = 0; i < types.length; i++) {
            rand -= weights[i];
            if (rand <= 0) { type = types[i]; break; }
        }

        // Much weaker enemies
        const stats = {
            normal: { radius: 16, speed: 2.8, health: 20, color: '#FF5F1F', points: 50 },
            fast: { radius: 12, speed: 5, health: 15, color: '#FF3366', points: 75 },
            tank: { radius: 28, speed: 1, health: 50, color: '#9933FF', points: 150 }
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

    spawnPowerup() {
        if (this.powerups.length >= MAX_POWERUPS) return;
        
        const spawn = getRandomSpawn();
        const powerupType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
        
        this.powerups.push({
            id: `powerup_${Date.now()}_${Math.random()}`,
            x: spawn.x,
            y: spawn.y,
            type: powerupType.type,
            name: powerupType.name,
            color: powerupType.color,
            icon: powerupType.icon,
            duration: powerupType.duration,
            radius: 15,
            pulse: 0
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
            prevX: spawn.x, prevY: spawn.y,  // For interpolation
            angle: 0,
            color: PLAYER_COLORS[colorIndex],
            health: MAX_HEALTH,
            score: 0,
            alive: true,
            respawnTime: 0,
            lastShot: 0,
            input: {},
            // Power-up states
            powerups: {
                rapid: 0,
                power: 0,
                speed: 0,
                shield: 0
            }
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

    applyPowerup(player, powerupType) {
        const now = Date.now();
        const duration = powerupType.duration;
        
        switch (powerupType.type) {
            case 'rapid':
                player.powerups.rapid = now + duration;
                break;
            case 'power':
                player.powerups.power = now + duration;
                break;
            case 'speed':
                player.powerups.speed = now + duration;
                break;
            case 'shield':
                player.powerups.shield = now + duration;
                break;
        }
    }

    update(currentTime) {
        if (this.state !== 'playing') return;

        for (const player of this.players.values()) {
            // Store previous position for interpolation
            player.prevX = player.x;
            player.prevY = player.y;

            if (!player.alive) {
                if (currentTime > player.respawnTime) {
                    const spawn = getSafeSpawn(this.enemies);
                    player.x = spawn.x; player.prevX = spawn.x;
                    player.y = spawn.y; player.prevY = spawn.y;
                    player.health = MAX_HEALTH;
                    player.alive = true;
                    player.score = Math.max(0, player.score - 25);
                    // Clear power-ups on respawn
                    player.powerups = { rapid: 0, power: 0, speed: 0, shield: 0 };
                }
                continue;
            }

            if (player.input) {
                let dx = 0, dy = 0;
                
                if (player.input.moveX !== undefined || player.input.moveY !== undefined) {
                    dx = player.input.moveX || 0;
                    dy = player.input.moveY || 0;
                }
                
                if (player.input.up) dy -= 1;
                if (player.input.down) dy += 1;
                if (player.input.left) dx -= 1;
                if (player.input.right) dx += 1;

                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) {
                    let speed = PLAYER_SPEED;
                    
                    // Speed boost power-up
                    if (player.powerups.speed > currentTime) {
                        speed = PLAYER_SPEED * 1.6;
                    }
                    
                    dx = (dx / len) * speed;
                    dy = (dy / len) * speed;
                }
                player.x += dx; player.y += dy;
                player.x = Math.max(20, Math.min(MAP_WIDTH - 20, player.x));
                player.y = Math.max(20, Math.min(MAP_HEIGHT - 20, player.y));
            }

            if (player.input && player.input.angle !== undefined) {
                player.angle = player.input.angle;
            }

            if (player.input && player.input.shooting && player.alive) {
                // Fire rate power-up
                const fireRate = player.powerups.rapid > currentTime ? FIRE_RATE / 2.5 : FIRE_RATE;
                
                if (currentTime - player.lastShot >= fireRate) {
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
                    // Damage power-up
                    let damage = BULLET_DAMAGE;
                    const shooter = this.players.get(bullet.ownerId);
                    if (shooter && shooter.powerups.power > currentTime) {
                        damage = BULLET_DAMAGE * 2;
                    }
                    
                    enemy.health -= damage;
                    this.bullets.splice(i, 1);
                    
                    if (enemy.health <= 0) {
                        if (shooter) {
                            shooter.score += enemy.points;
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
                    
                    // Shield blocks damage
                    if (player.powerups.shield > currentTime) continue;
                    
                    if (distance(enemy, player) < enemy.radius + 18) {
                        player.health -= enemy.type === 'tank' ? 5 : 3;
                        if (player.health <= 0) {
                            player.alive = false;
                            player.respawnTime = currentTime + RESPAWN_TIME;
                            player.health = 0;
                        }
                    }
                }
            }
        }

        // Check power-up collection
        for (let i = this.powerups.length - 1; i >= 0; i--) {
            const powerup = this.powerups[i];
            powerup.pulse += 0.1;
            
            for (const player of this.players.values()) {
                if (!player.alive) continue;
                if (distance(player, powerup) < 25) {
                    this.applyPowerup(player, powerup);
                    this.powerups.splice(i, 1);
                    
                    // Notify player
                    io.to(player.id).emit('powerupCollected', { 
                        type: powerup.type, 
                        name: powerup.name,
                        duration: powerup.duration 
                    });
                    break;
                }
            }
        }

        // Spawn enemies
        if (currentTime - this.lastEnemySpawn > ENEMY_SPAWN_RATE && this.enemies.length < MAX_ENEMIES) {
            this.spawnEnemy();
            this.lastEnemySpawn = currentTime;
        }

        // Spawn power-ups
        if (currentTime - this.lastPowerupSpawn > POWERUP_SPAWN_RATE) {
            this.spawnPowerup();
            this.lastPowerupSpawn = currentTime;
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
                score: player.score, alive: player.alive,
                powerups: player.powerups
            });
        }
        return {
            id: this.id, state: this.state,
            players: playerArray, bullets: this.bullets, enemies: this.enemies,
            powerups: this.powerups,
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
            room.enemies = []; 
            room.bullets = []; 
            room.powerups = [];
            room.lastEnemySpawn = Date.now();
            room.lastPowerupSpawn = Date.now();
            
            for (const player of room.players.values()) {
                const spawn = getSafeSpawn([]);
                player.x = spawn.x; player.prevX = spawn.x;
                player.y = spawn.y; player.prevY = spawn.y;
                player.health = MAX_HEALTH; 
                player.score = 0; 
                player.alive = true;
                player.powerups = { rapid: 0, power: 0, speed: 0, shield: 0 };
            }
            
            for (let i = 0; i < INITIAL_ENEMIES; i++) room.spawnEnemy();
            io.to(room.id).emit('gameStarted', room.getState());
            console.log(`Game started in room ${room.id}`);
        }
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
    console.log('║  With power-ups & smooth movement');
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
