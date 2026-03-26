export interface DaemonStats {
  channelsWatched: number;
  hookErrors: number;
  hooksExecuted: number;
  lastEventTime: string | null;
  messagesReceived: number;
  repliesSent: number;
}

export class StatsTracker {
  private messagesReceived = 0;
  private hooksExecuted = 0;
  private hookErrors = 0;
  private repliesSent = 0;
  private lastEventTime: string | null = null;
  private readonly channelsWatched: number;

  constructor(channelsWatched: number) {
    this.channelsWatched = channelsWatched;
  }

  recordMessageReceived(): void {
    this.messagesReceived++;
    this.touch();
  }

  recordHookExecuted(): void {
    this.hooksExecuted++;
    this.touch();
  }

  recordHookError(): void {
    this.hookErrors++;
    this.touch();
  }

  recordReplySent(): void {
    this.repliesSent++;
    this.touch();
  }

  getStats(): DaemonStats {
    return {
      messagesReceived: this.messagesReceived,
      hooksExecuted: this.hooksExecuted,
      hookErrors: this.hookErrors,
      repliesSent: this.repliesSent,
      lastEventTime: this.lastEventTime,
      channelsWatched: this.channelsWatched,
    };
  }

  private touch(): void {
    this.lastEventTime = new Date().toISOString();
  }
}
