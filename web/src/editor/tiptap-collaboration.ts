/**
 * src/editor/tiptap-collaboration.ts
 * Daylight Writer - Yjs CRDT Collaboration Engine for TipTap
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 * Sol:OS 8-bit Grayscale Design Tokens (--os-0 to --os-1000)
 */

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';

export interface CollaboratorUser {
  name: string;
  color: string;
  clientId?: number;
  initials?: string;
}

export type CollaborationProviderType = 'hocuspocus' | 'webrtc' | 'websocket' | 'offline';

export interface CollaborationOptions {
  documentId: string;
  roomPrefix?: string;
  user?: Partial<CollaboratorUser>;
  signalingServers?: string[];
  websocketUrl?: string;
  enableWebRtc?: boolean;
  enableWebSocket?: boolean;
}

export interface PeerState {
  clientId: number;
  user: CollaboratorUser;
}

export interface CollaborationEvents {
  onStatusChange?: (status: {
    connected: boolean;
    provider: CollaborationProviderType;
    roomName: string;
  }) => void;
  onPeersChange?: (peers: PeerState[]) => void;
  onDocUpdate?: (update: Uint8Array, origin: unknown) => void;
}

/**
 * Daylight Sol:OS Neutral & Calibrated Grayscale Cursors
 * High contrast on 8-bit reflective LivePaper panel
 */
export const SOL_OS_PEER_COLORS = [
  '#343434', // --os-800 (Dark field ink)
  '#1A1A1A', // --os-900 (Headline black)
  '#535353', // --os-400 (Secondary ink)
  '#6C6C6D', // Daylight Calibrated Orange-Gray
  '#9D9D9E', // Daylight Calibrated Amber-Gray
  '#858585', // --os-300 (Tertiary ink)
];

export class CollaborationManager {
  public ydoc: Y.Doc;
  public documentId: string;
  public roomName: string;
  public hocuspocusProvider: HocuspocusProvider | null = null;
  public webrtcProvider: WebrtcProvider | null = null;
  public websocketProvider: WebsocketProvider | null = null;
  public activeProviderType: CollaborationProviderType = 'offline';
  public localUser: CollaboratorUser;

  private events: CollaborationEvents;
  private isDestroyed = false;

  constructor(options: CollaborationOptions, events: CollaborationEvents = {}) {
    this.documentId = options.documentId;
    this.roomName = `${options.roomPrefix || 'daylight-writer-'}${options.documentId}`;
    this.ydoc = new Y.Doc();
    this.events = events;

    // Pick deterministic default user based on random ID or provided info
    const randomColor = SOL_OS_PEER_COLORS[Math.floor(Math.random() * SOL_OS_PEER_COLORS.length)];
    const defaultName = `Daylight User ${Math.floor(Math.random() * 900 + 100)}`;
    this.localUser = {
      name: options.user?.name || defaultName,
      color: options.user?.color || randomColor,
      initials: (options.user?.name || defaultName)
        .split(/\s+/)
        .map((s) => s[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    };

    // Listen to Y.Doc updates for local persistence hooks
    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (this.events.onDocUpdate) {
        this.events.onDocUpdate(update, origin);
      }
    });

    if (options.enableWebRtc && typeof window !== 'undefined' && typeof window.RTCPeerConnection !== 'undefined') {
      this.connectWebRtc(options.signalingServers);
    } else if (options.enableWebSocket && options.websocketUrl) {
      this.connectWebSocket(options.websocketUrl);
    }
  }

  // --------------------------------------------------------------------------
  // WebRTC Peer-to-Peer Provider
  // --------------------------------------------------------------------------
  public connectWebRtc(signalingServers?: string[]): WebrtcProvider | null {
    if (typeof window === 'undefined' || typeof window.RTCPeerConnection === 'undefined') {
      this.activeProviderType = 'offline';
      this.notifyStatus(false);
      return null;
    }

    this.disconnect();

    try {
      this.webrtcProvider = new WebrtcProvider(this.roomName, this.ydoc, {
        signaling: signalingServers || [
          'wss://signaling.yjs.dev',
          'wss://y-webrtc-signaling-eu.herokuapp.com',
          'wss://y-webrtc-signaling-us.herokuapp.com',
        ],
        awareness: undefined, // Let provider instantiate awareness
      });

      this.activeProviderType = 'webrtc';
      this.setupAwareness(this.webrtcProvider.awareness);

      this.webrtcProvider.on('status', (event: { connected: boolean }) => {
        this.notifyStatus(event.connected);
      });

      return this.webrtcProvider;
    } catch (err) {
      console.warn('[CollaborationManager] Failed to connect WebRTC:', err);
      this.activeProviderType = 'offline';
      this.notifyStatus(false);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // WebSocket Server Provider
  // --------------------------------------------------------------------------
  public connectWebSocket(serverUrl: string): WebsocketProvider | null {
    if (typeof window === 'undefined') {
      this.activeProviderType = 'offline';
      this.notifyStatus(false);
      return null;
    }

    this.disconnect();

    try {
      this.websocketProvider = new WebsocketProvider(serverUrl, this.roomName, this.ydoc);
      this.activeProviderType = 'websocket';
      this.setupAwareness(this.websocketProvider.awareness);

      this.websocketProvider.on('status', (event: { status: 'connected' | 'connecting' | 'disconnected' }) => {
        this.notifyStatus(event.status === 'connected');
      });

      return this.websocketProvider;
    } catch (err) {
      console.warn('[CollaborationManager] Failed to connect WebSocket:', err);
      this.activeProviderType = 'offline';
      this.notifyStatus(false);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Hocuspocus CRDT Server Provider (Tiptap Official Backend)
  // --------------------------------------------------------------------------
  public connectHocuspocus(serverUrl?: string, webSocketPolyfill?: any): HocuspocusProvider | null {
    this.disconnect();

    try {
      const websocketProvider = new HocuspocusProviderWebsocket({
        url: serverUrl || 'ws://127.0.0.1:1234',
        WebSocketPolyfill: webSocketPolyfill,
      });

      this.hocuspocusProvider = new HocuspocusProvider({
        websocketProvider,
        name: this.roomName,
        document: this.ydoc,
      });

      this.activeProviderType = 'hocuspocus';
      this.setupAwareness(this.hocuspocusProvider.awareness);

      this.hocuspocusProvider.on('status', (event: { status: string }) => {
        this.notifyStatus(event.status === 'connected');
      });

      return this.hocuspocusProvider;
    } catch (err) {
      console.warn('[CollaborationManager] Failed to connect Hocuspocus:', err);
      this.activeProviderType = 'offline';
      this.notifyStatus(false);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Awareness & User Identity
  // --------------------------------------------------------------------------
  private setupAwareness(awareness: any): void {
    if (!awareness) return;

    // Set our local user state
    awareness.setLocalStateField('user', {
      name: this.localUser.name,
      color: this.localUser.color,
      initials: this.localUser.initials,
    });

    // Listen to changes in peer awareness
    awareness.on('change', () => {
      if (this.isDestroyed) return;
      const states = awareness.getStates();
      const peers: PeerState[] = [];

      states.forEach((state: any, clientId: number) => {
        if (state.user) {
          peers.push({
            clientId,
            user: {
              name: state.user.name || `User ${clientId}`,
              color: state.user.color || '#343434',
              clientId,
              initials: (state.user.name || 'U').slice(0, 2).toUpperCase(),
            },
          });
        }
      });

      if (this.events.onPeersChange) {
        this.events.onPeersChange(peers);
      }
    });
  }

  public setLocalUser(user: Partial<CollaboratorUser>): void {
    const nameToUse = user.name || this.localUser.name;
    const computedInitials = nameToUse
      .split(/\s+/)
      .map((s) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    this.localUser = {
      ...this.localUser,
      ...user,
      initials: user.initials || computedInitials,
    };

    const awareness = this.activeAwareness;
    if (awareness) {
      awareness.setLocalStateField('user', {
        name: this.localUser.name,
        color: this.localUser.color,
        initials: this.localUser.initials,
      });
    }
  }

  public get activeAwareness(): any {
    if (this.hocuspocusProvider) return this.hocuspocusProvider.awareness;
    if (this.webrtcProvider) return this.webrtcProvider.awareness;
    if (this.websocketProvider) return this.websocketProvider.awareness;
    return null;
  }

  public get activeProvider(): HocuspocusProvider | WebrtcProvider | WebsocketProvider | null {
    return this.hocuspocusProvider || this.webrtcProvider || this.websocketProvider || null;
  }

  // --------------------------------------------------------------------------
  // CRDT Snapshot & SQLite Persistence
  // --------------------------------------------------------------------------
  public getBinarySnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  public applyBinaryUpdate(update: Uint8Array, origin?: unknown): void {
    Y.applyUpdate(this.ydoc, update, origin);
  }

  public getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }

  // --------------------------------------------------------------------------
  // Teardown & Lifecycle
  // --------------------------------------------------------------------------
  public disconnect(): void {
    if (this.hocuspocusProvider) {
      this.hocuspocusProvider.destroy();
      this.hocuspocusProvider = null;
    }
    if (this.webrtcProvider) {
      this.webrtcProvider.destroy();
      this.webrtcProvider = null;
    }
    if (this.websocketProvider) {
      this.websocketProvider.destroy();
      this.websocketProvider = null;
    }
    this.activeProviderType = 'offline';
    this.notifyStatus(false);
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.disconnect();
    this.ydoc.destroy();
  }

  private notifyStatus(connected: boolean): void {
    if (this.events.onStatusChange) {
      this.events.onStatusChange({
        connected,
        provider: this.activeProviderType,
        roomName: this.roomName,
      });
    }
  }
}
