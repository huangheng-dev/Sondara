export type LeaderLease = {
  release: () => Promise<void>;
};

const activeLeases = new Set<number>();

export const acquireLeaderLease = async (
  key: number,
  onLost?: () => void,
): Promise<LeaderLease | null> => {
  void onLost;
  if (activeLeases.has(key)) return null;
  activeLeases.add(key);
  let released = false;

  return {
    release: async () => {
      if (released) return;
      released = true;
      activeLeases.delete(key);
    },
  };
};

export const LEADER_KEYS = {
  radar: 0x534f5244, // SORD
  outbox: 0x534f4f55, // SOOU
  imap: 0x534f494d, // SOIM
  backup: 0x534f424b, // SOBK
  externalConnectors: 0x534f4558, // SOEX
  salesGuardian: 0x534f5347, // SOSG
} as const;
