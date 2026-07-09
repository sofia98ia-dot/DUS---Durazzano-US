// ============================================================
//  DUS — Durazzano Us (skeleton)
//  Server autoritativo Node.js + Socket.io.
//  Stanze multiple identificate da un codice. Grafica segnaposto.
// ============================================================

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

// ---------------- Parametri di gioco ----------------
const CFG = {
  TICK_HZ: 20,
  MAP_W: 1600,
  MAP_H: 900,
  PLAYER_R: 16,
  SPEED: 220,
  KILL_RANGE: 70,
  KILL_COOLDOWN: 20,        // secondi tra un'uccisione e l'altra
  KILL_COOLDOWN_START: 6,   // attesa iniziale (e dopo una riunione): più corta per testare
  INTERACT_RANGE: 60,
  TASKS_PER_PLAYER: 3,
  VOTE_SECONDS: 40,
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 10,
  EMERGENCY_PER_PLAYER: 1,
};

const WALLS = [
  { x: 300, y: 200, w: 260, h: 30 },
  { x: 300, y: 200, w: 30, h: 220 },
  { x: 760, y: 120, w: 30, h: 300 },
  { x: 1050, y: 250, w: 300, h: 30 },
  { x: 1320, y: 250, w: 30, h: 260 },
  { x: 250, y: 640, w: 400, h: 30 },
  { x: 820, y: 600, w: 30, h: 240 },
  { x: 1050, y: 640, w: 320, h: 30 },
];

const TASK_SPOTS = [
  { id: 't1', x: 180, y: 160, name: 'Reattore' },
  { id: 't2', x: 640, y: 320, name: 'Cablaggi' },
  { id: 't3', x: 980, y: 180, name: 'Navigazione' },
  { id: 't4', x: 1440, y: 200, name: 'Scudi' },
  { id: 't5', x: 200, y: 780, name: 'Smaltimento' },
  { id: 't6', x: 720, y: 760, name: 'Medbay' },
  { id: 't7', x: 1200, y: 780, name: 'Comunicazioni' },
  { id: 't8', x: 1460, y: 620, name: 'Motore' },
];

const COLORS = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#b5179e',
                '#f4a261','#8ecae6','#606c38','#ff8fab','#adb5bd'];

// ---------------- Stanze ----------------
const rooms = new Map();          // code -> game
const socketRoom = new Map();     // socketId -> code
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente O/0/I/1

function genCode() {
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]; }
  while (rooms.has(c));
  return c;
}
function newGame(code) {
  return { code, phase:'LOBBY', players:new Map(), bodies:[], meeting:null, winner:null,
           totalRealTasks:0, doneRealTasks:0 };
}
function gameOfSocket(id) { const c = socketRoom.get(id); return c ? rooms.get(c) : null; }

function makePlayer(id, name, color) {
  return {
    id, name, color, x:0, y:0,
    input:{up:false,down:false,left:false,right:false},
    role:null, alive:true, tasks:[],
    killReadyAt:0, emergencyLeft:CFG.EMERGENCY_PER_PLAYER, isHost:false,
  };
}

// ---------------- Geometria ----------------
function circleHitsRect(cx, cy, r, rc) {
  const nx = Math.max(rc.x, Math.min(cx, rc.x + rc.w));
  const ny = Math.max(rc.y, Math.min(cy, rc.y + rc.h));
  const dx = cx - nx, dy = cy - ny;
  return dx*dx + dy*dy < r*r;
}
function collides(x, y) {
  if (x < CFG.PLAYER_R || y < CFG.PLAYER_R ||
      x > CFG.MAP_W - CFG.PLAYER_R || y > CFG.MAP_H - CFG.PLAYER_R) return true;
  for (const w of WALLS) if (circleHitsRect(x, y, CFG.PLAYER_R, w)) return true;
  return false;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// ---------------- Host / colori (per stanza) ----------------
function livingHost(g) { for (const p of g.players.values()) if (p.isHost) return p; return null; }
function reassignHost(g) {
  if (livingHost(g)) return;
  const first = g.players.values().next().value;
  if (first) first.isHost = true;
}
function usedColors(g) { return new Set([...g.players.values()].map(p => p.color)); }
function freeColor(g) { const used = usedColors(g); return COLORS.find(c => !used.has(c)) || COLORS[0]; }

// ---------------- Avvio partita ----------------
function startGame(g) {
  const players = [...g.players.values()];
  if (players.length < CFG.MIN_PLAYERS) return;

  const impCount = players.length >= 7 ? 2 : 1;
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  shuffled.forEach((p, i) => { p.role = i < impCount ? 'IMPOSTOR' : 'CREW'; });

  g.totalRealTasks = 0; g.doneRealTasks = 0;
  for (const p of players) {
    p.alive = true;
    p.killReadyAt = Date.now() + CFG.KILL_COOLDOWN_START * 1000;
    p.emergencyLeft = CFG.EMERGENCY_PER_PLAYER;
    do { p.x = 100 + Math.random()*(CFG.MAP_W-200); p.y = 100 + Math.random()*(CFG.MAP_H-200); }
    while (collides(p.x, p.y));
    const spots = [...TASK_SPOTS].sort(() => Math.random()-0.5).slice(0, CFG.TASKS_PER_PLAYER);
    p.tasks = spots.map(s => ({ id:s.id, x:s.x, y:s.y, name:s.name, done:false, fake:p.role==='IMPOSTOR' }));
    if (p.role === 'CREW') g.totalRealTasks += p.tasks.length;
  }
  g.bodies = []; g.meeting = null; g.winner = null; g.phase = 'PLAYING';
  broadcastPhase(g);
}

// ---------------- Vittoria ----------------
function alivePlayers(g) { return [...g.players.values()].filter(p => p.alive); }
function aliveImpostors(g) { return alivePlayers(g).filter(p => p.role === 'IMPOSTOR'); }
function aliveCrew(g) { return alivePlayers(g).filter(p => p.role === 'CREW'); }

function checkWin(g) {
  const imp = aliveImpostors(g).length;
  const crew = aliveCrew(g).length;
  if (imp === 0) return endGame(g, 'CREW');
  if (imp >= crew) return endGame(g, 'IMPOSTOR');
  if (g.totalRealTasks > 0 && g.doneRealTasks >= g.totalRealTasks) return endGame(g, 'CREW');
  return false;
}
function endGame(g, winner) {
  g.winner = winner; g.phase = 'END'; g.meeting = null;
  broadcastPhase(g);
  return true;
}

// ---------------- Riunione ----------------
function startMeeting(g, calledBy, reason) {
  if (g.phase !== 'PLAYING') return;
  g.bodies = [];
  g.meeting = { endsAt: Date.now() + CFG.VOTE_SECONDS*1000, votes:{}, calledBy, reason };
  g.phase = 'MEETING';
  broadcastPhase(g);
}
function resolveMeeting(g) {
  const tally = {};
  for (const v of Object.values(g.meeting.votes)) tally[v] = (tally[v]||0) + 1;
  let top = null, topN = -1, tie = false;
  for (const [k, n] of Object.entries(tally)) {
    if (n > topN) { top = k; topN = n; tie = false; }
    else if (n === topN) tie = true;
  }
  let ejected = null, wasImpostor = false;
  if (top && top !== 'skip' && !tie) {
    const p = g.players.get(top);
    if (p) { p.alive = false; ejected = { name:p.name, color:p.color }; wasImpostor = p.role === 'IMPOSTOR'; }
  }
  for (const p of g.players.values()) {
    p.killReadyAt = Date.now() + CFG.KILL_COOLDOWN_START*1000;
    p.input = { up:false, down:false, left:false, right:false };
  }
  g.bodies = [];
  const result = { ejected, wasImpostor, skipped: !ejected };
  g.meeting = null; g.phase = 'PLAYING';
  if (!checkWin(g)) { broadcastPhase(g); io.to(g.code).emit('meetingResult', result); }
}

// ---------------- Loop ----------------
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000; last = now;

  for (const g of rooms.values()) {
    if (g.phase === 'PLAYING') {
      for (const p of g.players.values()) {
        let dx = (p.input.right?1:0) - (p.input.left?1:0);
        let dy = (p.input.down?1:0) - (p.input.up?1:0);
        if (dx || dy) {
          const len = Math.hypot(dx, dy); dx/=len; dy/=len;
          const nx = p.x + dx*CFG.SPEED*dt, ny = p.y + dy*CFG.SPEED*dt;
          if (!p.alive) {
            p.x = Math.max(CFG.PLAYER_R, Math.min(CFG.MAP_W-CFG.PLAYER_R, nx));
            p.y = Math.max(CFG.PLAYER_R, Math.min(CFG.MAP_H-CFG.PLAYER_R, ny));
          } else {
            if (!collides(nx, p.y)) p.x = nx;
            if (!collides(p.x, ny)) p.y = ny;
          }
        }
      }
    }
    if (g.phase === 'MEETING' && g.meeting) {
      const everyoneVoted = alivePlayers(g).every(p => g.meeting.votes[p.id] !== undefined);
      if (now >= g.meeting.endsAt || everyoneVoted) resolveMeeting(g);
    }
    broadcastState(g);
  }
}, 1000 / CFG.TICK_HZ);

// ---------------- Invio stato ----------------
function lobbyList(g) {
  return [...g.players.values()].map(p => ({ id:p.id, name:p.name, color:p.color, isHost:p.isHost }));
}
function broadcastPhase(g) {
  for (const [id, p] of g.players) {
    io.to(id).emit('phase', {
      phase: g.phase, code: g.code,
      you: { id:p.id, role:p.role, alive:p.alive },
      winner: g.winner, lobby: lobbyList(g),
      config: { MAP_W:CFG.MAP_W, MAP_H:CFG.MAP_H, PLAYER_R:CFG.PLAYER_R, walls:WALLS, taskSpots:TASK_SPOTS },
      minPlayers: CFG.MIN_PLAYERS,
    });
  }
}
function broadcastState(g) {
  if (g.phase === 'LOBBY' || g.phase === 'END') return;
  for (const [id, me] of g.players) {
    const amImpostor = me.role === 'IMPOSTOR';
    const amGhost = !me.alive;
    const visible = [...g.players.values()]
      .filter(o => o.alive || amGhost)
      .map(o => ({
        id:o.id, name:o.name, color:o.color, x:Math.round(o.x), y:Math.round(o.y), alive:o.alive,
        role: (o.id === me.id || (amImpostor && o.role === 'IMPOSTOR')) ? o.role : null,
      }));

    let nearTask = null;
    if (g.phase === 'PLAYING') for (const t of me.tasks) if (!t.done && dist(me,t) < CFG.INTERACT_RANGE) { nearTask = t.id; break; }
    let nearBody = null;
    if (g.phase === 'PLAYING' && me.alive) for (const b of g.bodies) if (dist(me,b) < CFG.INTERACT_RANGE) { nearBody = b.id; break; }
    let killTarget = null;
    if (g.phase === 'PLAYING' && amImpostor && me.alive && Date.now() >= me.killReadyAt) {
      let best = Infinity;
      for (const o of alivePlayers(g)) {
        if (o.role === 'IMPOSTOR') continue;
        const d = dist(me, o);
        if (d < CFG.KILL_RANGE && d < best) { best = d; killTarget = o.id; }
      }
    }

    const payload = {
      phase: g.phase,
      players: visible,
      bodies: (me.alive || amGhost) ? g.bodies : [],
      you: {
        id:me.id, alive:me.alive, role:me.role, tasks:me.tasks,
        killCooldown: Math.max(0, Math.ceil((me.killReadyAt - Date.now())/1000)),
        emergencyLeft: me.emergencyLeft, nearTask, nearBody, killTarget,
      },
      progress: { done:g.doneRealTasks, total:g.totalRealTasks },
    };
    if (g.phase === 'MEETING' && g.meeting) {
      payload.meeting = {
        secondsLeft: Math.max(0, Math.ceil((g.meeting.endsAt - Date.now())/1000)),
        reason: g.meeting.reason, calledBy: g.meeting.calledBy,
        candidates: [...g.players.values()].map(p => ({ id:p.id, name:p.name, color:p.color, alive:p.alive })),
        votes: Object.entries(g.meeting.votes).map(([voter,target]) => ({ voter, target })),
        myVote: g.meeting.votes[me.id] ?? null,
        canVote: me.alive,
      };
    }
    io.to(id).emit('state', payload);
  }
}

// ---------------- Socket ----------------
function cleanName(n){ return String(n||'').trim().slice(0,14) || 'Giocatore'; }

io.on('connection', (socket) => {
  socket.emit('colors', { colors: COLORS });

  socket.on('createRoom', ({ name, color }) => {
    if (socketRoom.has(socket.id)) return;
    const code = genCode();
    const g = newGame(code);
    rooms.set(code, g);
    const p = makePlayer(socket.id, cleanName(name), COLORS.includes(color)?color:COLORS[0]);
    p.isHost = true;
    g.players.set(socket.id, p);
    socketRoom.set(socket.id, code);
    socket.join(code);
    broadcastPhase(g);
  });

  socket.on('joinRoom', ({ code, name, color }) => {
    if (socketRoom.has(socket.id)) return;
    code = String(code||'').trim().toUpperCase();
    const g = rooms.get(code);
    if (!g) { socket.emit('joinError', 'Codice stanza non valido.'); return; }
    if (g.phase !== 'LOBBY') { socket.emit('joinError', 'Partita già in corso in questa stanza.'); return; }
    if (g.players.size >= CFG.MAX_PLAYERS) { socket.emit('joinError', 'Stanza piena.'); return; }
    if (usedColors(g).has(color)) color = freeColor(g);
    const p = makePlayer(socket.id, cleanName(name), COLORS.includes(color)?color:freeColor(g));
    if (g.players.size === 0) p.isHost = true;
    g.players.set(socket.id, p);
    socketRoom.set(socket.id, code);
    socket.join(code);
    broadcastPhase(g);
  });

  socket.on('start', () => {
    const g = gameOfSocket(socket.id); if (!g) return;
    const p = g.players.get(socket.id);
    if (p && p.isHost && g.phase === 'LOBBY') startGame(g);
  });

  socket.on('input', (inp) => {
    const g = gameOfSocket(socket.id); if (!g || g.phase !== 'PLAYING') return;
    const p = g.players.get(socket.id); if (!p) return;
    p.input = { up:!!inp.up, down:!!inp.down, left:!!inp.left, right:!!inp.right };
  });

  socket.on('kill', () => {
    const g = gameOfSocket(socket.id); if (!g || g.phase !== 'PLAYING') return;
    const me = g.players.get(socket.id);
    if (!me || me.role !== 'IMPOSTOR' || !me.alive || Date.now() < me.killReadyAt) return;
    let victim = null, best = Infinity;
    for (const o of alivePlayers(g)) {
      if (o.role === 'IMPOSTOR') continue;
      const d = dist(me, o);
      if (d < CFG.KILL_RANGE && d < best) { best = d; victim = o; }
    }
    if (!victim) return;
    victim.alive = false;
    g.bodies.push({ id:'b_'+victim.id, x:victim.x, y:victim.y, color:victim.color });
    me.x = victim.x; me.y = victim.y;
    me.killReadyAt = Date.now() + CFG.KILL_COOLDOWN*1000;
    checkWin(g);
  });

  socket.on('completeTask', ({ taskId }) => {
    const g = gameOfSocket(socket.id); if (!g || g.phase !== 'PLAYING') return;
    const me = g.players.get(socket.id); if (!me) return;
    const t = me.tasks.find(t => t.id === taskId && !t.done);
    if (!t || dist(me, t) > CFG.INTERACT_RANGE) return;
    t.done = true;
    if (!t.fake && me.role === 'CREW') { g.doneRealTasks++; checkWin(g); }
  });

  socket.on('report', () => {
    const g = gameOfSocket(socket.id); if (!g || g.phase !== 'PLAYING') return;
    const me = g.players.get(socket.id); if (!me || !me.alive) return;
    if (g.bodies.some(b => dist(me,b) < CFG.INTERACT_RANGE)) startMeeting(g, me.name, 'Cadavere segnalato');
  });

  socket.on('emergency', () => {
    const g = gameOfSocket(socket.id); if (!g || g.phase !== 'PLAYING') return;
    const me = g.players.get(socket.id); if (!me || !me.alive || me.emergencyLeft <= 0) return;
    me.emergencyLeft--;
    startMeeting(g, me.name, 'Riunione d\'emergenza');
  });

  socket.on('vote', ({ target }) => {
    const g = gameOfSocket(socket.id); if (!g || g.phase !== 'MEETING' || !g.meeting) return;
    const me = g.players.get(socket.id); if (!me || !me.alive) return;
    if (g.meeting.votes[me.id] !== undefined) return;
    if (target !== 'skip' && !g.players.has(target)) return;
    g.meeting.votes[me.id] = target;
  });

  socket.on('restart', () => {
    const g = gameOfSocket(socket.id); if (!g) return;
    const p = g.players.get(socket.id); if (!p || !p.isHost) return;
    g.phase = 'LOBBY'; g.bodies = []; g.meeting = null; g.winner = null;
    for (const pl of g.players.values()) { pl.role = null; pl.alive = true; pl.tasks = []; }
    broadcastPhase(g);
  });

  socket.on('disconnect', () => {
    const g = gameOfSocket(socket.id);
    socketRoom.delete(socket.id);
    if (!g) return;
    g.players.delete(socket.id);
    g.bodies = g.bodies.filter(b => b.id !== 'b_'+socket.id);
    if (g.players.size === 0) { rooms.delete(g.code); return; }   // stanza vuota: elimina
    reassignHost(g);
    if (g.phase === 'LOBBY') broadcastPhase(g);
    else if (g.phase === 'PLAYING' || g.phase === 'MEETING') { if (!checkWin(g)) broadcastPhase(g); }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DUS in ascolto su http://localhost:${PORT}`));
