import { WebSocket, WebSocketServer } from 'ws';
import http from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    ok: true,
    service: 'sidecar-coop-relay',
    rooms: rooms.size,
  }));
});
const wss = new WebSocketServer({ server });
const rooms = new Map();

const makeRoomCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? makeRoomCode() : code;
};

const send = (socket, payload) => {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
};

const broadcast = (room, sender, payload) => {
  for (const peer of room.peers) {
    if (peer !== sender && peer.readyState === WebSocket.OPEN) {
      peer.send(JSON.stringify(payload));
    }
  }
};

const attachPeer = (socket, room, role) => {
  socket.roomCode = room.code;
  socket.role = role;
  room.peers.add(socket);
  room.roles.set(socket, role);
};

const detachPeer = (socket) => {
  if (!socket.roomCode) {
    return;
  }

  const room = rooms.get(socket.roomCode);
  if (!room) {
    return;
  }

  room.peers.delete(socket);
  room.roles.delete(socket);
  broadcast(room, socket, { type: 'peerLeft' });

  if (room.peers.size === 0) {
    rooms.delete(room.code);
  }
};

wss.on('connection', (socket) => {
  socket.on('message', (rawData) => {
    let message;
    try {
      message = JSON.parse(String(rawData));
    } catch {
      send(socket, { type: 'error', message: 'Invalid relay message.' });
      return;
    }

    if (message.type === 'ping') {
      send(socket, { type: 'pong' });
      return;
    }

    if (message.type === 'create') {
      detachPeer(socket);
      const room = {
        code: makeRoomCode(),
        seed: Date.now() ^ Math.floor(Math.random() * 0xffffffff),
        peers: new Set(),
        roles: new Map(),
      };
      rooms.set(room.code, room);
      attachPeer(socket, room, message.role === 'gunner' ? 'gunner' : 'driver');
      send(socket, {
        type: 'created',
        roomCode: room.code,
        role: socket.role,
        seed: room.seed,
      });
      return;
    }

    if (message.type === 'join') {
      const roomCode = String(message.roomCode ?? '').trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) {
        send(socket, { type: 'error', message: `Room ${roomCode} not found.` });
        return;
      }
      if (room.peers.size >= 2 && !room.peers.has(socket)) {
        send(socket, { type: 'error', message: `Room ${roomCode} is full.` });
        return;
      }

      detachPeer(socket);
      const requestedRole = message.role === 'driver' ? 'driver' : 'gunner';
      const occupiedRoles = new Set(room.roles.values());
      const resolvedRole = occupiedRoles.has(requestedRole)
        ? requestedRole === 'driver' ? 'gunner' : 'driver'
        : requestedRole;
      attachPeer(socket, room, resolvedRole);
      send(socket, {
        type: 'joined',
        roomCode: room.code,
        role: resolvedRole,
        seed: room.seed,
      });
      broadcast(room, socket, { type: 'peerJoined', role: resolvedRole });
      return;
    }

    if (!socket.roomCode) {
      send(socket, { type: 'error', message: 'Join or create a room first.' });
      return;
    }

    const room = rooms.get(socket.roomCode);
    if (!room) {
      send(socket, { type: 'error', message: 'Room expired.' });
      return;
    }

    if (message.type === 'input' || message.type === 'snapshot' || message.type === 'control') {
      broadcast(room, socket, message);
      return;
    }

    send(socket, { type: 'error', message: 'Unknown relay message.' });
  });

  socket.on('close', () => {
    detachPeer(socket);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Sidecar co-op relay listening on 0.0.0.0:${port}`);
});
