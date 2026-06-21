const EventEmitter = require('events');
const { isExpired } = require('./relayJob');

class RelayQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxSize = Number(options.maxSize || 120);
    this.globalConcurrency = Number(options.globalConcurrency || 3);
    this.runningGlobal = 0;
    this.roomQueues = new Map();
    this.roomRunning = new Map();
  }

  ensureRoom(roomCode) {
    const key = String(roomCode || 'unknown');
    if (!this.roomQueues.has(key)) this.roomQueues.set(key, []);
    return this.roomQueues.get(key);
  }

  enqueue(job) {
    const q = this.ensureRoom(job.roomCode);
    if (q.length >= this.maxSize) return { ok: false, reason: 'queue_full' };
    q.push(job);
    this.emit('queued', { roomCode: job.roomCode, jobId: job.id, size: q.length });
    return { ok: true };
  }

  markRoomRunning(roomCode, running) {
    this.roomRunning.set(String(roomCode || 'unknown'), !!running);
  }

  canRun(roomCode) {
    if (this.runningGlobal >= this.globalConcurrency) return false;
    return !this.roomRunning.get(String(roomCode || 'unknown'));
  }

  nextRunnable() {
    for (const [roomCode, q] of this.roomQueues.entries()) {
      while (q.length && isExpired(q[0])) {
        const dropped = q.shift();
        this.emit('dropped', { roomCode, jobId: dropped.id, reason: 'ttl_expired' });
      }
      if (!q.length) continue;
      if (!this.canRun(roomCode)) continue;
      const job = q.shift();
      this.runningGlobal += 1;
      this.markRoomRunning(roomCode, true);
      return job;
    }
    return null;
  }

  complete(job, status = 'succeeded') {
    this.runningGlobal = Math.max(0, this.runningGlobal - 1);
    this.markRoomRunning(job.roomCode, false);
    this.emit('completed', { roomCode: job.roomCode, jobId: job.id, status });
  }

  removeRoomJobs(roomCode, reason = 'room_reset') {
    const key = String(roomCode || 'unknown');
    const q = this.roomQueues.get(key) || [];
    this.roomQueues.set(key, []);
    q.forEach((job) => this.emit('dropped', { roomCode: key, jobId: job.id, reason }));
    return q.length;
  }

  snapshot() {
    const rooms = [];
    for (const [roomCode, q] of this.roomQueues.entries()) {
      rooms.push({ roomCode, queued: q.length, running: !!this.roomRunning.get(roomCode) });
    }
    return {
      runningGlobal: this.runningGlobal,
      globalConcurrency: this.globalConcurrency,
      rooms,
    };
  }
}

module.exports = {
  RelayQueue,
};
