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
  collection: string;
  archived: boolean;
  deleted: boolean;
  deletedAt: string;
  thumbnail: string;
  protected: boolean;
  syncState?: SyncState;
}

export interface CreateVaultItem {
  type: StorageType;
  name: string;
  detail?: string;
  url?: string;
  tags?: string[];
  pinned?: boolean;
  collection?: string;
  archived?: boolean;
  deleted?: boolean;
  deletedAt?: string;
  thumbnail?: string;
  protected?: boolean;
}

export interface BackupSnapshot {
  id: string;
  createdAt: string;
  itemCount: number;
  note: string;
}

export interface ImportReport {
  received: number;
  added: number;
  updated: number;
  skipped: number;
  total: number;
}
