type Events = {
  onLog?: (msg: string) => void;
  onTrack?: (stream: MediaStream) => void;
  onStatus?: (payload: Record<string, unknown>) => void;
  onTaskEvent?: (payload: Record<string, unknown>) => void;
};

type ConnectOptions = {
  agentId: string;
  wsBase: string;
  stunServers?: string[];
  events?: Events;
};

export class SignalingClient {
  private agentId: string;
  private wsBase: string;
  private stunServers: string[];
  private events: Events;
  private ws?: WebSocket;
  private pc?: RTCPeerConnection;
  private control?: RTCDataChannel;
  private clientId: string;
  private remoteStream?: MediaStream;

  constructor(opts: ConnectOptions) {
    this.agentId = opts.agentId;
    this.wsBase = opts.wsBase.replace(/\/+$/, "");
    this.stunServers = opts.stunServers?.length ? opts.stunServers : ["stun:stun.l.google.com:19302"];
    this.events = opts.events || {};
    this.clientId = crypto.randomUUID();
  }

  private log(msg: string) {
    this.events.onLog?.(msg);
  }

  async connect() {
    const wsUrl = `${this.wsBase}/ws/ui/${this.clientId}?agent_id=${this.agentId}`;
    this.log(`Connecting WS ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.log("WebSocket connected");
      this.startPeer().catch((err) => this.log(`Peer init failed: ${err}`));
    };
    this.ws.onmessage = (evt) => this.handleWsMessage(evt.data);
    this.ws.onclose = () => this.log("WebSocket closed");
    this.ws.onerror = (evt) => this.log(`WebSocket error: ${evt}`);
  }

  private async startPeer() {
    this.pc?.close();
    this.remoteStream = new MediaStream();
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: this.stunServers }],
    });
    this.control = this.pc.createDataChannel("control");
    this.control.onopen = () => this.log("Control channel ready");
    this.control.onclose = () => this.log("Control channel closed");

    this.pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        this.sendSignaling({
          type: "candidate",
          candidate: evt.candidate.candidate,
          sdpMid: evt.candidate.sdpMid,
          sdpMLineIndex: evt.candidate.sdpMLineIndex,
        });
      }
    };
    this.pc.ontrack = (evt) => {
      evt.streams[0].getTracks().forEach((t) => this.remoteStream?.addTrack(t));
      this.events.onTrack?.(this.remoteStream as MediaStream);
    };
    this.pc.onconnectionstatechange = () => this.log(`RTC state: ${this.pc?.connectionState}`);
    this.pc.addTransceiver("video", { direction: "recvonly" });

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignaling({ type: "offer", sdp: offer.sdp });
  }

  private sendSignaling(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "signaling", payload }));
  }

  private async handleSignaling(payload: any) {
    if (!this.pc) return;
    if (payload.type === "answer") {
        await this.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
    } else if (payload.type === "candidate") {
      if (payload.candidate) {
        await this.pc.addIceCandidate({
          candidate: payload.candidate,
          sdpMid: payload.sdpMid ?? undefined,
          sdpMLineIndex: payload.sdpMLineIndex ?? undefined,
        });
      }
    }
  }

  private handleWsMessage(raw: string) {
    try {
      const message = JSON.parse(raw);
      if (message.type === "signaling") {
        this.handleSignaling(message.payload);
      } else if (message.type === "agent_status") {
        this.events.onStatus?.(message);
      } else if (message.type === "task_result" || message.type === "task_created") {
        this.events.onTaskEvent?.(message);
      } else if (message.type === "log") {
        this.events.onLog?.(message.message || "");
      }
    } catch (err) {
      this.log(`Bad WS message: ${err}`);
    }
  }

  sendControl(command: string, args: Record<string, unknown>) {
    const payload = JSON.stringify({ command, args });
    if (this.control && this.control.readyState === "open") {
      this.control.send(payload);
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "control", command, args }));
    } else {
      this.log("Control channel not ready");
    }
  }

  attachVideo(element: HTMLVideoElement | null) {
    if (element && this.remoteStream) {
      element.srcObject = this.remoteStream;
    }
  }

  disconnect() {
    this.control?.close();
    this.pc?.close();
    this.ws?.close();
  }
}
