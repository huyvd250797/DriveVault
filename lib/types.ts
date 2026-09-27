export type StorageType = "media" | "content" | "other";

export interface VaultItem {
  id: string;
  type: StorageType;
  name: string;
  detail: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateVaultItem {
  type: StorageType;
  name: string;
  detail?: string;
  url?: string;
}
