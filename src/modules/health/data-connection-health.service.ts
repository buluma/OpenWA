import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createLogger } from '../../common/services/logger.service';

const PROBE_INTERVAL_MS = 30_000;
const MAX_CONSECUTIVE_RECONNECT_ATTEMPTS = 5;

export interface DataConnectionHealthStatus {
  healthy: boolean;
  lastError: string | null;
  lastCheckedAt: Date | null;
  reconnectAttempts: number;
  lastReconnectAt: Date | null;
}

/**
 * Periodically probes the `data` DataSource and, when it's down, attempts to reconnect it —
 * TypeORM's `destroy()` + `initialize()` re-runs the driver's `connect()`, which replaces its
 * underlying connection handle in place. The DataSource/EntityManager object identity never
 * changes, so every already-injected `@InjectRepository()` consumer picks up the new connection
 * automatically; nothing needs to be re-injected.
 *
 * Exists because a prior SQLite `SQLITE_CANTOPEN` incident on the data connection (webhook
 * dispatch and message persistence silently failing on every request) went unnoticed until someone
 * happened to query the API directly — `/health/ready` already reported it as down, but nothing
 * was polling that endpoint on this single-instance, non-orchestrated deployment, and there was no
 * recovery path short of restarting the whole process by hand.
 */
@Injectable()
export class DataConnectionHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('DataConnectionHealthService');
  private probeTimer?: ReturnType<typeof setInterval>;
  private status: DataConnectionHealthStatus = {
    healthy: true,
    lastError: null,
    lastCheckedAt: null,
    reconnectAttempts: 0,
    lastReconnectAt: null,
  };

  constructor(@InjectDataSource('data') private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.probeTimer = setInterval(() => {
      void this.probeAndHeal();
    }, PROBE_INTERVAL_MS);
    this.probeTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
    }
  }

  getStatus(): DataConnectionHealthStatus {
    return { ...this.status };
  }

  private async probeAndHeal(): Promise<void> {
    try {
      await this.dataSource.query('SELECT 1');
      if (!this.status.healthy) {
        this.logger.log(`Data connection recovered after ${this.status.reconnectAttempts} reconnect attempt(s)`);
      }
      this.status = {
        healthy: true,
        lastError: null,
        lastCheckedAt: new Date(),
        reconnectAttempts: 0,
        lastReconnectAt: this.status.lastReconnectAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { ...this.status, healthy: false, lastError: message, lastCheckedAt: new Date() };
      this.logger.error(`Data connection probe failed: ${message}`);
      await this.attemptReconnect(message);
    }
  }

  private async attemptReconnect(reason: string): Promise<void> {
    if (this.status.reconnectAttempts >= MAX_CONSECUTIVE_RECONNECT_ATTEMPTS) {
      // Fail loud, not silent-forever: stop retrying so a permanently broken disk/permission issue
      // doesn't spin every 30s indefinitely — but leave `healthy: false` in place so /health/ready
      // keeps reporting it down until a human intervenes.
      this.logger.error(
        `Data connection reconnect abandoned after ${MAX_CONSECUTIVE_RECONNECT_ATTEMPTS} consecutive failed attempts (${reason}) — manual intervention required`,
      );
      return;
    }

    this.status.reconnectAttempts += 1;
    this.logger.warn(
      `Attempting data connection reconnect ${this.status.reconnectAttempts}/${MAX_CONSECUTIVE_RECONNECT_ATTEMPTS}`,
    );

    try {
      if (this.dataSource.isInitialized) {
        // A driver that failed with CANTOPEN may already be effectively disconnected; destroy()
        // throwing here shouldn't block the initialize() attempt below.
        await this.dataSource.destroy().catch(err => {
          this.logger.warn(`Data connection destroy() before reconnect failed (continuing): ${String(err)}`);
        });
      }
      await this.dataSource.initialize();
      await this.dataSource.query('SELECT 1');
      this.logger.log(`Data connection reconnected after ${this.status.reconnectAttempts} attempt(s)`);
      this.status = {
        healthy: true,
        lastError: null,
        lastCheckedAt: new Date(),
        reconnectAttempts: 0,
        lastReconnectAt: new Date(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Data connection reconnect attempt ${this.status.reconnectAttempts} failed: ${message}`);
    }
  }
}
