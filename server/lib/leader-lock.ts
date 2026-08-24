export type LeaderLease = {
  release: () => Promise<void>;
};

export const acquireLeaderLease = async (
  key: number,
  onLost?: () => void,
): Promise<LeaderLease | null> => {
  const { pool } = await import("../db/client.js");
  const client = await pool.connect();
  let released = false;

  const handleError = () => {
    if (!released) onLost?.();
  };

  client.on("error", handleError);

  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [key],
    );
    if (!result.rows[0]?.locked) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release(error instanceof Error ? error : undefined);
    throw error;
  }

  return {
    release: async () => {
      if (released) return;
      released = true;
      client.off("error", handleError);
      try {
        await client.query("select pg_advisory_unlock($1)", [key]);
      } catch {
        // Closing the connection also releases the session-level advisory lock.
      } finally {
        client.release();
      }
    },
  };
};

export const LEADER_KEYS = {
  radar: 0x534f5244, // SORD
  outbox: 0x534f4f55, // SOOU
  imap: 0x534f494d, // SOIM
  backup: 0x534f424b, // SOBK
} as const;

