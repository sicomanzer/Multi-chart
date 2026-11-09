import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';

const RESOLUTIONS = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': '1D', '1w': '1W', '1M': '1M' };

/** Read a complete SET OHLC series; daily Yahoo SET history contains only a snapshot. */
export function getSetHistory(timeframe) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', {
      origin: 'https://www.tradingview.com', handshakeTimeout: 10000,
    });
    const session = `cs_${randomBytes(6).toString('hex')}`;
    const bars = new Map();
    let buffer = '';
    let finished = false;
    const timer = setTimeout(() => finish(new Error('SET history timed out')), 20000);
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ws.close();
      if (error) reject(error);
      else if (!bars.size) reject(new Error('SET history returned no candles'));
      else resolve([...bars.values()].sort((a, b) => a.time - b.time));
    }
    function send(m, p) {
      const body = JSON.stringify({ m, p });
      ws.send(`~m~${Buffer.byteLength(body)}~m~${body}`);
    }
    ws.on('open', () => {
      send('set_auth_token', ['unauthorized_user_token']);
      send('chart_create_session', [session, '']);
      send('resolve_symbol', [session, 'symbol_1', '=' + JSON.stringify({ symbol: 'SET:SET', adjustment: 'splits', session: 'regular' })]);
      send('create_series', [session, 's1', 's1', 'symbol_1', RESOLUTIONS[timeframe], 1000, '']);
    });
    ws.on('message', (data) => {
      buffer += data.toString();
      while (buffer.startsWith('~m~')) {
        const end = buffer.indexOf('~m~', 3);
        if (end < 0) break;
        const length = Number(buffer.slice(3, end));
        if (!Number.isInteger(length) || length < 0) return finish(new Error('Invalid SET history frame'));
        const start = end + 3;
        if (buffer.length < start + length) break;
        const body = buffer.slice(start, start + length);
        buffer = buffer.slice(start + length);
        if (body.startsWith('~h~')) { ws.send(`~m~${length}~m~${body}`); continue; }
        let message;
        try { message = JSON.parse(body); } catch { continue; }
        if (message.m === 'timescale_update') {
          for (const row of message.p?.[1]?.s1?.s ?? []) {
            const [time, open, high, low, close, volume] = row.v ?? [];
            if (![time, open, high, low, close].every(Number.isFinite)) continue;
            bars.set(time, { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0, adjClose: close });
          }
        }
        if (['critical_error', 'symbol_error', 'series_error'].includes(message.m)) return finish(new Error(`SET history: ${message.m}`));
        if (message.m === 'series_completed') return finish();
      }
    });
    ws.on('error', error => finish(error));
    ws.on('close', () => { if (!finished) finish(new Error('SET history connection closed before completion')); });
  });
}
