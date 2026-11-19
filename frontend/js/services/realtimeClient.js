/**
 * realtimeClient.js - Universal Frontend WebSocket Synchronization Client
 * Used by Virtex Admin Console (/admin) and Member Kiosk (/kiosk.html)
 * 
 * Capabilities:
 * - Automatic protocol selection (ws: or wss:) based on window.location
 * - Automatic exponential backoff reconnection with jitter
 * - Sliding-window duplicate event protection
 * - Fine-grained event subscriptions and wildcard handler
 * - Active connection health monitoring and ping keepalives
 */

export class RealtimeClient {
  constructor({ channel = 'kiosk', token = null, autoConnect = true, onStatusChange = null } = {}) {
    this.channel = channel;
    this.token = token;
    this.onStatusChange = onStatusChange;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    this.ws = null;
    this.listeners = new Map();
    this.processedEventIds = new Set();
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.maxReconnectDelay = 30000;
    this.isExplicitDisconnect = false;
    this.isPageFrozen = false;

    this.bindLifecycleListeners();

    if (autoConnect) {
      this.connect();
    }
  }

  bindLifecycleListeners() {
    if (typeof window === 'undefined') return;

    // Handle Page Entering Back-Forward Cache (bfcache) or Navigating Away
    window.addEventListener('pagehide', () => {
      this.isPageFrozen = true;
      this.stopPingKeepalive();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.ws) {
        this.ws.onerror = null;
        this.ws.onclose = null;
        try {
          this.ws.close(1000, 'Page entered Back-Forward Cache');
        } catch (_) {}
        this.ws = null;
      }
      this.setStatus('disconnected');
    });

    // Handle Page Restored from Back-Forward Cache
    window.addEventListener('pageshow', (event) => {
      this.isPageFrozen = false;
      if (!this.isExplicitDisconnect && (event.persisted || !this.ws || this.ws.readyState !== WebSocket.OPEN)) {
        this.reconnectAttempts = 0;
        this.connect();
      }
    });

    // Page Lifecycle API: freeze / resume (Chromium bfcache optimization)
    if (typeof document !== 'undefined') {
      document.addEventListener('freeze', () => {
        this.isPageFrozen = true;
        this.stopPingKeepalive();
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        if (this.ws) {
          this.ws.onerror = null;
          this.ws.onclose = null;
          try {
            this.ws.close(1000, 'Page frozen');
          } catch (_) {}
          this.ws = null;
        }
        this.setStatus('disconnected');
      });

      document.addEventListener('resume', () => {
        this.isPageFrozen = false;
        if (!this.isExplicitDisconnect) {
          this.reconnectAttempts = 0;
          this.connect();
        }
      });

      // Background tab optimization: pause keepalive when tab is hidden, resume when visible
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.stopPingKeepalive();
        } else if (document.visibilityState === 'visible') {
          this.isPageFrozen = false;
          if (!this.isExplicitDisconnect) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
              this.reconnectAttempts = 0;
              this.connect();
            } else {
              this.startPingKeepalive();
            }
          }
        }
      });
    }

    window.addEventListener('beforeunload', () => {
      this.isPageFrozen = true;
      this.disconnect();
    });
  }

  setToken(token) {
    this.token = token;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && token) {
      this.send('auth', { token });
    }
  }

  setStatus(newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      if (this.onStatusChange) {
        this.onStatusChange(newStatus);
      }
      this.emit('STATUS_CHANGED', { status: newStatus });
    }
  }

  getWsUrl() {
    const isHttps = window.location.protocol === 'https:';
    const protocol = isHttps ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:3000';
    let url = `${protocol}//${host}/ws?channel=${encodeURIComponent(this.channel)}`;
    if (this.token) {
      url += `&token=${encodeURIComponent(this.token)}`;
    }
    return url;
  }

  connect() {
    if (this.isPageFrozen) {
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isExplicitDisconnect = false;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      const url = this.getWsUrl();
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.setStatus('connected');
        const wasReconnecting = this.reconnectAttempts > 0;
        this.reconnectAttempts = 0;

        // Start ping keepalive
        this.startPingKeepalive();

        // If authenticating after open
        if (this.token) {
          this.send('auth', { token: this.token });
        }

        if (wasReconnecting) {
          this.emit('RECONNECTED', { timestamp: new Date().toISOString() });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data);
          this.handleIncomingMessage(envelope);
        } catch (err) {
          console.warn('[RealtimeClient] Unparseable message frame:', err);
        }
      };

      this.ws.onclose = () => {
        this.stopPingKeepalive();
        if (this.isPageFrozen || this.isExplicitDisconnect) {
          this.setStatus('disconnected');
          return;
        }
        this.setStatus('reconnecting');
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        if (this.isPageFrozen || this.isExplicitDisconnect || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
          return;
        }
        if (this.reconnectAttempts === 0) {
          console.debug('[RealtimeClient] WebSocket link interrupted; reconnecting...');
        }
      };
    } catch (err) {
      if (!this.isPageFrozen && !this.isExplicitDisconnect) {
        console.debug('[RealtimeClient] Connection creation attempt paused:', err?.message || err);
        this.scheduleReconnect();
      }
    }
  }

  handleIncomingMessage(envelope) {
    if (!envelope || !envelope.type) return;

    // Duplicate event protection: ignore if eventId already processed
    if (envelope.eventId) {
      if (this.processedEventIds.has(envelope.eventId)) {
        return;
      }
      this.processedEventIds.add(envelope.eventId);
      if (this.processedEventIds.size > 500) {
        // Trim oldest half
        const arr = Array.from(this.processedEventIds);
        this.processedEventIds = new Set(arr.slice(250));
      }
    }

    // Trigger specific listeners
    this.emit(envelope.type, envelope.data || envelope, envelope);

    // Trigger wildcard listeners
    this.emit('*', envelope.data || envelope, envelope);
  }

  startPingKeepalive() {
    this.stopPingKeepalive();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('ping', { time: Date.now() });
      }
    }, 25000);
  }

  stopPingKeepalive() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.isExplicitDisconnect) return;

    this.reconnectAttempts++;
    // Exponential backoff with jitter: min 1.5s, max 30s
    const baseDelay = Math.min(1500 * Math.pow(1.4, this.reconnectAttempts - 1), this.maxReconnectDelay);
    const jitter = Math.random() * 500;
    const delay = Math.round(baseDelay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(type, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  on(eventType, handler) {
    if (typeof handler !== 'function') return;
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(handler);
  }

  off(eventType, handler) {
    if (this.listeners.has(eventType)) {
      this.listeners.get(eventType).delete(handler);
    }
  }

  emit(eventType, data, envelope = {}) {
    if (this.listeners.has(eventType)) {
      for (const handler of this.listeners.get(eventType)) {
        try {
          handler(data, envelope);
        } catch (err) {
          console.error(`[RealtimeClient] Error in handler for event '${eventType}':`, err);
        }
      }
    }
  }

  disconnect() {
    this.isExplicitDisconnect = true;
    this.stopPingKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close(1000, 'Explicit disconnect');
      } catch (_) {}
      this.ws = null;
    }
    this.setStatus('disconnected');
  }
}

