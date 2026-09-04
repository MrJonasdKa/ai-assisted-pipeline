import { Server } from 'socket.io';
import { config } from '../config/env.js';

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.server.corsOrigin },
  });

  io.on('connection', (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`[ws] client disconnected: ${socket.id}`);
    });
  });

  return io;
}
