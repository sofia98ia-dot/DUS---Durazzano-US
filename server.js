// ============================================================
//  DUS — Durazzano Us (skeleton)
//  Mappa a quadretti (zone + strade) dal disegno dell'utente.
//  Visibilità a LINEA DI VISTA: i muri bloccano lo sguardo.
// ============================================================

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

const CELL = 72, GRID_COLS = 44, GRID_ROWS = 30;
const CFG = {
  TICK_HZ: 20, MAP_W: GRID_COLS*CELL, MAP_H: GRID_ROWS*CELL,
  PLAYER_R: 16, SPEED: 235,
  KILL_RANGE: 100, KILL_COOLDOWN: 20, KILL_COOLDOWN_START: 6,
  INTERACT_RANGE: 100, LOS_RANGE: 720,
  TASKS_PER_PLAYER: 3, VOTE_SECONDS: 40,
  MIN_PLAYERS: 3, MAX_PLAYERS: 20, EMERGENCY_PER_PLAYER: 1,
};

// ---- Zone (dal tuo editor) ----
const ZONES = [
{ id:'vianova', name:'Via Nova', x:1368, y:936, w:216, h:144 },
  { id:'ngop', name:"'Ngop 'o pont", x:1368, y:576, w:216, h:144 },
  { id:'jardino', name:'Jardino', x:864, y:144, w:216, h:144 },
  { id:'potec', name:"A' potec e' vascio", x:792, y:1008, w:216, h:144 },
  { id:'sangiorgio', name:'San Giorgio', x:144, y:360, w:216, h:144 },
  { id:'aglio', name:'Aglio', x:216, y:792, w:216, h:144 },
  { id:'casanova', name:'Casanova', x:1152, y:1584, w:216, h:144 },
  { id:'piedicasale', name:'Piedicasale', x:1944, y:1080, w:216, h:144 },
  { id:'terramurata', name:'Terra Murata', x:2376, y:1368, w:216, h:144 },
  { id:'vigne', name:'Vigne', x:1944, y:432, w:216, h:144 },
  { id:'maneggio', name:'Maneggio', x:2808, y:1872, w:216, h:144 },
  { id:'tiroalvolo', name:'Tiro al volo', x:2160, y:1872, w:216, h:144 },
];
// ---- Strade: celle [colonna, riga] dipinte nell'editor ----
const ROAD_CELLS = [[20,10],[20,11],[20,12],[20,7],[20,6],[19,6],[18,6],[17,6],[16,6],[15,6],[14,6],[13,6],[13,5],[13,4],[21,6],[22,6],[23,6],[24,6],[25,6],[26,6],[22,13],[23,13],[24,13],[25,13],[26,13],[27,13],[28,13],[28,14],[28,12],[28,11],[28,10],[28,9],[28,8],[30,15],[31,15],[32,15],[33,15],[34,15],[34,16],[34,17],[34,18],[32,19],[31,19],[31,20],[31,21],[31,22],[31,23],[31,24],[31,25],[34,26],[35,26],[36,26],[37,26],[38,26],[33,26],[17,24],[17,25],[17,26],[17,27],[18,27],[19,27],[20,27],[21,27],[22,27],[23,27],[24,27],[25,27],[26,27],[27,27],[28,27],[29,27],[18,13],[17,13],[16,13],[15,13],[15,14],[15,15],[14,15],[17,21],[17,20],[16,20],[15,20],[14,20],[13,20],[12,20],[11,20],[10,20],[9,20],[8,20],[8,19],[8,18],[8,17],[8,16],[8,15],[8,14],[9,14],[10,14],[8,13],[8,12],[8,11],[7,11],[6,11],[8,10],[8,9],[8,8],[8,7],[8,6],[7,6],[6,6],[5,6],[30,19],[29,19],[28,19],[27,19],[26,19],[25,19],[24,19],[23,19],[22,19],[21,19],[20,19],[20,18],[20,17],[20,16],[20,15]];

// insieme delle celle calpestabili (zone + strade)
const WALK = new Set();
for (const z of ZONES){ const c0=z.x/CELL, r0=z.y/CELL, cw=z.w/CELL, ch=z.h/CELL;
  for(let dc=0;dc<cw;dc++) for(let dr=0;dr<ch;dr++) WALK.add((c0+dc)+','+(r0+dr)); }
for (const [c,r] of ROAD_CELLS) WALK.add(c+','+r);

// rettangoli strada per il disegno lato client
const STREETS = ROAD_CELLS.map(([c,r],i)=>({ id:'r'+i, x:c*CELL, y:r*CELL, w:CELL, h:CELL }));
// una postazione-task al centro di ogni zona
const TASK_SPOTS = ZONES.map(z=>({ id:'task_'+z.id, x:Math.round(z.x+z.w/2), y:Math.round(z.y+z.h/2), name:z.name, zone:z.id }));

const COLORS = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#b5179e','#f4a261','#8ecae6','#606c38','#ff8fab','#adb5bd',
                '#c77dff','#90be6d','#ff6d00','#00b4d8','#7209b7','#d00000','#38b000','#4361ee','#f15bb5','#9c6644'];

// ---------------- Stanze di gioco ----------------
const rooms = new Map();
const socketRoom = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(){ let c; do{ c=''; for(let i=0;i<4;i++) c+=CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]; } while(rooms.has(c)); return c; }
function newGame(code){ return { code, phase:'LOBBY', players:new Map(), bodies:[], meeting:null, winner:null, totalRealTasks:0, doneRealTasks:0 }; }
function gameOfSocket(id){ const c=socketRoom.get(id); return c?rooms.get(c):null; }
function makePlayer(id,name,color){ return { id,name,color,x:0,y:0,input:{up:false,down:false,left:false,right:false},role:null,alive:true,tasks:[],killReadyAt:0,emergencyLeft:CFG.EMERGENCY_PER_PLAYER,isHost:false }; }

// ---------------- Geometria / vista ----------------
function inRect(x,y,r){ return x>=r.x && x<=r.x+r.w && y>=r.y && y<=r.y+r.h; }
function cellWalkable(x,y){ const c=Math.floor(x/CELL), r=Math.floor(y/CELL); return WALK.has(c+','+r); }
function collides(x,y){ if(x<CFG.PLAYER_R||y<CFG.PLAYER_R||x>CFG.MAP_W-CFG.PLAYER_R||y>CFG.MAP_H-CFG.PLAYER_R) return true; return !cellWalkable(x,y); }
function areaAt(x,y){
  for(const z of ZONES) if(inRect(x,y,z)) return { id:z.id, name:z.name };
  const c=Math.floor(x/CELL), r=Math.floor(y/CELL);
  if(WALK.has(c+','+r)) return { id:'road', name:'In strada' };
  return null;
}
function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
// linea di vista: nessun muro tra a e b, entro il raggio
function lineOfSight(a,b){
  const d=Math.hypot(b.x-a.x,b.y-a.y);
  if(d>CFG.LOS_RANGE) return false;
  const steps=Math.max(1,Math.ceil(d/(CELL/2)));
  for(let i=1;i<steps;i++){
    const t=i/steps, x=a.x+(b.x-a.x)*t, y=a.y+(b.y-a.y)*t;
    if(!cellWalkable(x,y)) return false;
  }
  return true;
}

// Visibilità a compartimenti: dentro una stanza vedi SOLO chi è nella stessa stanza
// (chi è fuori non ti vede finché non entra). In strada, chi è in strada e a vista.
function sameCompartment(a,b){
  const A=areaAt(a.x,a.y), B=areaAt(b.x,b.y);
  if(!A||!B) return false;
  if(A.id!=='road') return B.id===A.id;        // io in una stanza -> solo stessa stanza
  return B.id==='road' && lineOfSight(a,b);      // io in strada -> solo strada, a vista
}

// ---------------- Host / colori ----------------
function livingHost(g){ for(const p of g.players.values()) if(p.isHost) return p; return null; }
function reassignHost(g){ if(livingHost(g))return; const f=g.players.values().next().value; if(f) f.isHost=true; }
function usedColors(g){ return new Set([...g.players.values()].map(p=>p.color)); }
function freeColor(g){ const u=usedColors(g); return COLORS.find(c=>!u.has(c))||COLORS[0]; }

// numero impostori in base ai giocatori (scaglioni scelti dall'utente)
function impostorCount(n){
  if(n>=17) return 4;
  if(n>=13) return 3;
  if(n>=7)  return 2;
  return 1;
}

// ---------------- Avvio ----------------
function startGame(g){
  const players=[...g.players.values()];
  if(players.length<CFG.MIN_PLAYERS) return;
  const impCount = impostorCount(players.length);
  const shuffled=[...players].sort(()=>Math.random()-0.5);
  shuffled.forEach((p,i)=>{ p.role = i<impCount?'IMPOSTOR':'CREW'; });
  g.totalRealTasks=0; g.doneRealTasks=0;
  const via = ZONES.find(z=>z.id==='vianova') || ZONES[0];
  for(const p of players){
    p.alive=true; p.killReadyAt=Date.now()+CFG.KILL_COOLDOWN_START*1000; p.emergencyLeft=CFG.EMERGENCY_PER_PLAYER;
    p.x = via.x + 30 + Math.random()*(via.w-60);
    p.y = via.y + 30 + Math.random()*(via.h-60);
    const spots=[...TASK_SPOTS].sort(()=>Math.random()-0.5).slice(0,CFG.TASKS_PER_PLAYER);
    p.tasks=spots.map(s=>({ id:s.id, x:s.x, y:s.y, name:s.name, done:false, fake:p.role==='IMPOSTOR' }));
    if(p.role==='CREW') g.totalRealTasks+=p.tasks.length;
  }
  g.bodies=[]; g.meeting=null; g.winner=null; g.phase='PLAYING';
  broadcastPhase(g);
}

// ---------------- Vittoria ----------------
function alivePlayers(g){ return [...g.players.values()].filter(p=>p.alive); }
function aliveImpostors(g){ return alivePlayers(g).filter(p=>p.role==='IMPOSTOR'); }
function aliveCrew(g){ return alivePlayers(g).filter(p=>p.role==='CREW'); }
function checkWin(g){
  const imp=aliveImpostors(g).length, crew=aliveCrew(g).length;
  if(imp===0) return endGame(g,'CREW');
  if(imp>=crew) return endGame(g,'IMPOSTOR');
  if(g.totalRealTasks>0 && g.doneRealTasks>=g.totalRealTasks) return endGame(g,'CREW');
  return false;
}
function endGame(g,w){ g.winner=w; g.phase='END'; g.meeting=null; broadcastPhase(g); return true; }

// ---------------- Riunione ----------------
function startMeeting(g,calledBy,reason){
  if(g.phase!=='PLAYING') return;
  g.bodies=[];
  g.meeting={ endsAt:Date.now()+CFG.VOTE_SECONDS*1000, votes:{}, calledBy, reason };
  g.phase='MEETING';
  const via=ZONES.find(z=>z.id==='vianova')||ZONES[0];
  for(const p of g.players.values()){ if(p.alive){ p.x=via.x+30+Math.random()*(via.w-60); p.y=via.y+30+Math.random()*(via.h-60);} }
  broadcastPhase(g);
}
function resolveMeeting(g){
  const tally={}; for(const v of Object.values(g.meeting.votes)) tally[v]=(tally[v]||0)+1;
  let top=null,topN=-1,tie=false;
  for(const [k,n] of Object.entries(tally)){ if(n>topN){top=k;topN=n;tie=false;} else if(n===topN) tie=true; }
  let ejected=null,wasImpostor=false;
  if(top && top!=='skip' && !tie){ const p=g.players.get(top); if(p){ p.alive=false; ejected={name:p.name,color:p.color}; wasImpostor=p.role==='IMPOSTOR'; } }
  for(const p of g.players.values()){ p.killReadyAt=Date.now()+CFG.KILL_COOLDOWN_START*1000; p.input={up:false,down:false,left:false,right:false}; }
  g.bodies=[];
  const result={ ejected, wasImpostor, skipped:!ejected };
  g.meeting=null; g.phase='PLAYING';
  if(!checkWin(g)){ broadcastPhase(g); io.to(g.code).emit('meetingResult',result); }
}

// ---------------- Loop ----------------
let last=Date.now();
setInterval(()=>{
  const now=Date.now(); const dt=(now-last)/1000; last=now;
  for(const g of rooms.values()){
    if(g.phase==='PLAYING'){
      for(const p of g.players.values()){
        let dx=(p.input.right?1:0)-(p.input.left?1:0);
        let dy=(p.input.down?1:0)-(p.input.up?1:0);
        if(dx||dy){
          const len=Math.hypot(dx,dy); dx/=len; dy/=len;
          const nx=p.x+dx*CFG.SPEED*dt, ny=p.y+dy*CFG.SPEED*dt;
          if(!p.alive){ p.x=Math.max(CFG.PLAYER_R,Math.min(CFG.MAP_W-CFG.PLAYER_R,nx)); p.y=Math.max(CFG.PLAYER_R,Math.min(CFG.MAP_H-CFG.PLAYER_R,ny)); }
          else { if(!collides(nx,p.y)) p.x=nx; if(!collides(p.x,ny)) p.y=ny; }
        }
      }
    }
    if(g.phase==='MEETING' && g.meeting){
      const everyoneVoted=alivePlayers(g).every(p=>g.meeting.votes[p.id]!==undefined);
      if(now>=g.meeting.endsAt || everyoneVoted) resolveMeeting(g);
    }
    broadcastState(g);
  }
},1000/CFG.TICK_HZ);

// ---------------- Invio stato ----------------
function lobbyList(g){ return [...g.players.values()].map(p=>({ id:p.id, name:p.name, color:p.color, isHost:p.isHost })); }
function broadcastPhase(g){
  for(const [id,p] of g.players){
    io.to(id).emit('phase',{
      phase:g.phase, code:g.code,
      you:{ id:p.id, role:p.role, alive:p.alive },
      winner:g.winner, lobby:lobbyList(g),
      config:{ MAP_W:CFG.MAP_W, MAP_H:CFG.MAP_H, PLAYER_R:CFG.PLAYER_R, zones:ZONES, streets:STREETS, taskSpots:TASK_SPOTS },
      minPlayers:CFG.MIN_PLAYERS,
    });
  }
}
function broadcastState(g){
  if(g.phase==='LOBBY'||g.phase==='END') return;
  for(const [id,me] of g.players){
    const amImpostor=me.role==='IMPOSTOR';
    const amGhost=!me.alive;
    const myArea=amGhost?null:areaAt(me.x,me.y);

    // VISIBILITÀ a linea di vista
    const visible=[...g.players.values()].filter(o=>{
      if(amGhost) return true;
      if(!o.alive) return false;
      if(o.id===me.id) return true;
      return sameCompartment(me,o);
    }).map(o=>({
      id:o.id, name:o.name, color:o.color, x:Math.round(o.x), y:Math.round(o.y), alive:o.alive,
      role:(o.id===me.id||(amImpostor&&o.role==='IMPOSTOR'))?o.role:null,
    }));

    const visibleBodies=g.bodies.filter(b=> amGhost || sameCompartment(me,b));

    let nearTask=null;
    if(g.phase==='PLAYING') for(const t of me.tasks) if(!t.done && dist(me,t)<CFG.INTERACT_RANGE){ nearTask=t.id; break; }
    let nearBody=null;
    if(g.phase==='PLAYING'&&me.alive) for(const b of visibleBodies) if(dist(me,b)<CFG.INTERACT_RANGE){ nearBody=b.id; break; }
    let killTarget=null;
    if(g.phase==='PLAYING'&&amImpostor&&me.alive&&Date.now()>=me.killReadyAt){
      let best=Infinity;
      for(const o of alivePlayers(g)){
        if(o.role==='IMPOSTOR') continue;
        if(!sameCompartment(me,o)) continue;
        const d=dist(me,o); if(d<CFG.KILL_RANGE && d<best){ best=d; killTarget=o.id; }
      }
    }

    const payload={
      phase:g.phase, players:visible, bodies:visibleBodies,
      you:{ id:me.id, alive:me.alive, role:me.role, tasks:me.tasks,
        killCooldown:Math.max(0,Math.ceil((me.killReadyAt-Date.now())/1000)),
        emergencyLeft:me.emergencyLeft, nearTask, nearBody, killTarget,
        area: amGhost ? 'Fantasma' : (myArea?myArea.name:'In strada') },
      progress:{ done:g.doneRealTasks, total:g.totalRealTasks },
    };
    if(g.phase==='MEETING'&&g.meeting){
      payload.meeting={
        secondsLeft:Math.max(0,Math.ceil((g.meeting.endsAt-Date.now())/1000)),
        reason:g.meeting.reason, calledBy:g.meeting.calledBy,
        candidates:[...g.players.values()].map(p=>({ id:p.id, name:p.name, color:p.color, alive:p.alive })),
        votes:Object.entries(g.meeting.votes).map(([voter,target])=>({ voter, target })),
        myVote:g.meeting.votes[me.id]??null, canVote:me.alive,
      };
    }
    io.to(id).emit('state',payload);
  }
}

// ---------------- Socket ----------------
function cleanName(n){ return String(n||'').trim().slice(0,14)||'Giocatore'; }
io.on('connection',(socket)=>{
  socket.emit('colors',{ colors:COLORS });
  socket.on('createRoom',({name,color})=>{
    if(socketRoom.has(socket.id)) return;
    const code=genCode(); const g=newGame(code); rooms.set(code,g);
    const p=makePlayer(socket.id,cleanName(name),COLORS.includes(color)?color:COLORS[0]);
    p.isHost=true; g.players.set(socket.id,p); socketRoom.set(socket.id,code); socket.join(code); broadcastPhase(g);
  });
  socket.on('joinRoom',({code,name,color})=>{
    if(socketRoom.has(socket.id)) return;
    code=String(code||'').trim().toUpperCase(); const g=rooms.get(code);
    if(!g){ socket.emit('joinError','Codice stanza non valido.'); return; }
    if(g.phase!=='LOBBY'){ socket.emit('joinError','Partita già in corso in questa stanza.'); return; }
    if(g.players.size>=CFG.MAX_PLAYERS){ socket.emit('joinError','Stanza piena.'); return; }
    if(usedColors(g).has(color)) color=freeColor(g);
    const p=makePlayer(socket.id,cleanName(name),COLORS.includes(color)?color:freeColor(g));
    if(g.players.size===0) p.isHost=true;
    g.players.set(socket.id,p); socketRoom.set(socket.id,code); socket.join(code); broadcastPhase(g);
  });
  socket.on('start',()=>{ const g=gameOfSocket(socket.id); if(!g)return; const p=g.players.get(socket.id); if(p&&p.isHost&&g.phase==='LOBBY') startGame(g); });
  socket.on('input',(inp)=>{ const g=gameOfSocket(socket.id); if(!g||g.phase!=='PLAYING')return; const p=g.players.get(socket.id); if(!p)return; p.input={up:!!inp.up,down:!!inp.down,left:!!inp.left,right:!!inp.right}; });
  socket.on('kill',()=>{
    const g=gameOfSocket(socket.id); if(!g||g.phase!=='PLAYING')return;
    const me=g.players.get(socket.id);
    if(!me||me.role!=='IMPOSTOR'||!me.alive||Date.now()<me.killReadyAt) return;
    let victim=null,best=Infinity;
    for(const o of alivePlayers(g)){ if(o.role==='IMPOSTOR') continue; if(!sameCompartment(me,o)) continue; const d=dist(me,o); if(d<CFG.KILL_RANGE && d<best){ best=d; victim=o; } }
    if(!victim) return;
    victim.alive=false; g.bodies.push({ id:'b_'+victim.id, x:victim.x, y:victim.y, color:victim.color });
    me.x=victim.x; me.y=victim.y; me.killReadyAt=Date.now()+CFG.KILL_COOLDOWN*1000; checkWin(g);
  });
  socket.on('completeTask',({taskId})=>{
    const g=gameOfSocket(socket.id); if(!g||g.phase!=='PLAYING')return;
    const me=g.players.get(socket.id); if(!me)return;
    const t=me.tasks.find(t=>t.id===taskId&&!t.done); if(!t||dist(me,t)>CFG.INTERACT_RANGE) return;
    t.done=true; if(!t.fake&&me.role==='CREW'){ g.doneRealTasks++; checkWin(g); }
  });
  socket.on('report',()=>{
    const g=gameOfSocket(socket.id); if(!g||g.phase!=='PLAYING')return;
    const me=g.players.get(socket.id); if(!me||!me.alive)return;
    const near=g.bodies.some(b=> dist(me,b)<CFG.INTERACT_RANGE && sameCompartment(me,b));
    if(near) startMeeting(g,me.name,'Cadavere segnalato');
  });
  socket.on('emergency',()=>{
    const g=gameOfSocket(socket.id); if(!g||g.phase!=='PLAYING')return;
    const me=g.players.get(socket.id); if(!me||!me.alive||me.emergencyLeft<=0)return;
    const a=areaAt(me.x,me.y);            // riunione d'emergenza solo da Via Nova
    if(!a || a.id!=='vianova') return;
    me.emergencyLeft--; startMeeting(g,me.name,"Riunione d'emergenza");
  });
  socket.on('vote',({target})=>{
    const g=gameOfSocket(socket.id); if(!g||g.phase!=='MEETING'||!g.meeting)return;
    const me=g.players.get(socket.id); if(!me||!me.alive)return;
    if(g.meeting.votes[me.id]!==undefined) return;
    if(target!=='skip'&&!g.players.has(target)) return;
    g.meeting.votes[me.id]=target;
  });
  socket.on('restart',()=>{
    const g=gameOfSocket(socket.id); if(!g)return;
    const p=g.players.get(socket.id); if(!p||!p.isHost)return;
    g.phase='LOBBY'; g.bodies=[]; g.meeting=null; g.winner=null;
    for(const pl of g.players.values()){ pl.role=null; pl.alive=true; pl.tasks=[]; }
    broadcastPhase(g);
  });
  socket.on('disconnect',()=>{
    const g=gameOfSocket(socket.id); socketRoom.delete(socket.id);
    if(!g)return;
    g.players.delete(socket.id); g.bodies=g.bodies.filter(b=>b.id!=='b_'+socket.id);
    if(g.players.size===0){ rooms.delete(g.code); return; }
    reassignHost(g);
    if(g.phase==='LOBBY') broadcastPhase(g);
    else if(g.phase==='PLAYING'||g.phase==='MEETING'){ if(!checkWin(g)) broadcastPhase(g); }
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`DUS in ascolto su http://localhost:${PORT}`));
