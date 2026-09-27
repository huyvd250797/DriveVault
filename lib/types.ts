export type StorageType = "media" | "content" | "other";
export type SyncState = "synced" | "pending" | "syncing" | "error";

export interface VaultItem {
  id: string;
  type: StorageType;
  name: string;
  detail: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
  tags: string[];
  pinned: boolean;
  useCount: number;
  lastUsedAt: string;
  syncState?: SyncState;
}

export interface CreateVaultItem {
  type: StorageType;
  name: string;
  detail?: string;
  url?: string;
  tags?: string[];
  pinned?: boolean;
}
