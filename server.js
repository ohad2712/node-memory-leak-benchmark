import http from 'node:http';
import v8 from 'node:v8';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const leakingCache = new Set();

const server = http.createServer(async (req, res) => {
  // 1. LEAKING ENDPOINT
  if (req.url === '/leak' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      leakingCache.add({
        timestamp: Date.now(),
        payload: chunks,
      });

      if (!res.headersSent) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', bytes: chunks.length }));
      }
    });
  } 

  // 2. FIXED STREAMING ENDPOINT
  else if (req.url === '/fixed' && req.method === 'POST') {
    const metricsTransform = new Transform({
      transform(chunk, encoding, callback) {
        this.bytesProcessed = (this.bytesProcessed || 0) + chunk.length;
        
        callback(null, chunk);
      }
    });

    try {
      await pipeline(req, metricsTransform, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Stream error');
      }
    }
  } 

  // 3. STATS ENDPOINT
  else if (req.url === '/stats') {
    const mem = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      rssMB: (mem.rss / 1024 / 1024).toFixed(2),
      heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(2),
    }));
  } 

  // 4. HEAP SNAPSHOT ENDPOINT
  else if (req.url === '/admin/heap-snapshot') {
    const fileName = `./snapshot-${Date.now()}.heapsnapshot`;
    const snapshotStream = v8.getHeapSnapshot();
    const fileStream = fs.createWriteStream(fileName);
    snapshotStream.pipe(fileStream);
    fileStream.on('finish', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'snapshot_created', path: fileName }));
    });
  } 

  else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});