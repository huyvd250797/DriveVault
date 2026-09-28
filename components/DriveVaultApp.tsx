"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowDownAZ,
  ArrowUp,
  Check,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Cloud,
  CloudOff,
  Database,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderInput,
  Grid3X3,
  Image as ImageIcon,
  Layers3,
  List,
  Loader2,
  Moon,
  Pencil,
  Pin,
  PinOff,
  Play,
  Pause,
  Plus,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Square,
  Star,
  Sun,
  Upload,
  History,
  Link2,
  Lock,
  Unlock,
  ShieldCheck,
  Maximize2,
  ImagePlus,
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  Undo2,
  WifiOff,
  Zap,
  X,
} from "lucide-react";
import type { BackupSnapshot, CreateVaultItem, ImportReport, StorageType, SyncState, VaultItem } from "@/lib/types";

const CACHE_KEY = "drivevault-v200-items";
const QUEUE_KEY = "drivevault-v200-sync-queue";
const LEGACY_CACHE_KEY = "drivevault-v170-items";
const LEGACY_QUEUE_KEY = "drivevault-v170-sync-queue";
const SECURITY_KEY = "drivevault-v170-security";
const QUICK_PREFS_KEY = "drivevault-v200-quick-prefs";
const QUICK_TEMPLATES_KEY = "drivevault-v200-quick-templates";
const HOME_CONFIG_KEY = "drivevault-v200-home-config";
const MEDIA_PROGRESS_KEY = "drivevault-v210-media-progress";
const MEDIA_KIND_CACHE_KEY = "drivevault-v210-media-kind-cache";
const SMART_RULES_KEY = "drivevault-v220-smart-rules";
const DELETE_UNDO_MS = 5000;

const typeMeta: Record<StorageType, { label: string; icon: typeof ImageIcon; className: string }> = {
  media: { label: "Ảnh / Video", icon: ImageIcon, className: "badge-media" },
  content: { label: "Nội dung", icon: FileText, className: "badge-content" },
  other: { label: "Khác", icon: Layers3, className: "badge-other" },
};

type LibraryMode = "all" | "pinned" | "recent" | "frequent" | "archive" | "trash";
type SortMode = "smart" | "newest" | "oldest" | "name-az" | "name-za" | "recent" | "frequent";
type SearchField = "name" | "detail" | "url" | "tags" | "collection";
type BulkMode = "archive" | "restore" | "pin" | "unpin" | "move" | "delete" | "restoreTrash" | "purge";
type LinkFilter = "all" | "with" | "without";
type DensityMode = "compact" | "comfortable";
type MediaKind = "image" | "video" | "unknown";
type MediaKindFilter = "all" | "image" | "video";
type MediaViewMode = "grid" | "list";
type SmartRuleField = "url" | "name" | "detail" | "any";
type SmartRuleOperator = "contains" | "startsWith" | "endsWith" | "equals";

type SmartRule = {
  id: string;
  name: string;
  enabled: boolean;
  field: SmartRuleField;
  operator: SmartRuleOperator;
  value: string;
  setType?: StorageType | "";
  collection?: string;
  tags: string[];
  pinned?: boolean;
  archived?: boolean;
  protected?: boolean;
};

type QuickTemplate = {
  id: string;
  name: string;
  type: StorageType;
  detail: string;
  url: string;
  tags: string[];
  collection: string;
};

type QuickPrefs = { type: StorageType; collection: string; tags: string[] };
type HomeConfig = {
  showPinned: boolean;
  showRecent: boolean;
  showFrequent: boolean;
  favoriteCollections: string[];
  density: DensityMode;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type QueueOperation = {
  opId: string;
  type: "create" | "update" | "delete" | "pin" | "use" | "bulk";
  targetId: string;
  targetIds?: string[];
  item?: VaultItem;
  pinned?: boolean;
  useCount?: number;
  lastUsedAt?: string;
  bulkMode?: BulkMode;
  collection?: string;
  notBefore?: number;
  error?: string;
};

type UndoDeleteState = { item: VaultItem; previousOps: QueueOperation[] };

const emptyForm: CreateVaultItem = {
  type: "content",
  name: "",
  detail: "",
  url: "",
  tags: [],
  collection: "Chưa phân loại",
  thumbnail: "",
  protected: false,
};

const defaultHomeConfig: HomeConfig = {
  showPinned: true,
  showRecent: true,
  showFrequent: false,
  favoriteCollections: [],
  density: "comfortable",
};

const defaultSmartRules: SmartRule[] = [
  { id: "builtin-shopee", name: "Shopee → phân loại Shopee", enabled: true, field: "url", operator: "contains", value: "shopee.", setType: "other", collection: "Shopee", tags: ["shopee", "mua sắm"] },
  { id: "builtin-youtube", name: "YouTube → Media", enabled: true, field: "url", operator: "contains", value: "youtu", setType: "media", collection: "Media", tags: ["video", "youtube"] },
  { id: "builtin-drive", name: "Google Drive → Media", enabled: true, field: "url", operator: "contains", value: "drive.google.com", setType: "media", collection: "Media", tags: ["google drive"] },
  { id: "builtin-tiktok", name: "TikTok → Media", enabled: true, field: "url", operator: "contains", value: "tiktok.", setType: "media", collection: "Media", tags: ["video", "tiktok"] },
];

const emptySmartRule: Omit<SmartRule, "id"> = {
  name: "", enabled: true, field: "url", operator: "contains", value: "", setType: "", collection: "", tags: [], pinned: false, archived: false, protected: false,
};

function readSmartRules(): SmartRule[] {
  if (typeof window === "undefined") return defaultSmartRules;
  try {
    const raw = window.localStorage.getItem(SMART_RULES_KEY);
    if (!raw) return defaultSmartRules;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((rule) => ({ ...emptySmartRule, ...rule, id: String(rule.id || createClientId()), tags: normalizeTags(Array.isArray(rule.tags) ? rule.tags : []) })) : defaultSmartRules;
  } catch { return defaultSmartRules; }
}

function smartRuleMatches(rule: SmartRule, draft: Pick<CreateVaultItem, "name" | "detail" | "url">) {
  if (!rule.enabled || !rule.value.trim()) return false;
  const source = rule.field === "url" ? String(draft.url || "") : rule.field === "name" ? String(draft.name || "") : rule.field === "detail" ? String(draft.detail || "") : `${draft.name || ""} ${draft.detail || ""} ${draft.url || ""}`;
  const haystack = source.toLocaleLowerCase("vi").trim();
  const needle = rule.value.toLocaleLowerCase("vi").trim();
  if (!needle) return false;
  if (rule.operator === "equals") return haystack === needle;
  if (rule.operator === "startsWith") return haystack.startsWith(needle);
  if (rule.operator === "endsWith") return haystack.endsWith(needle);
  return haystack.includes(needle);
}

function applySmartRulesToDraft<T extends CreateVaultItem>(draft: T, rules: SmartRule[], allowProtected = true): { draft: T; matched: SmartRule[] } {
  const matched = rules.filter((rule) => smartRuleMatches(rule, draft));
  if (!matched.length) return { draft, matched };
  const next = { ...draft } as T;
  let tags = normalizeTags(next.tags || []);
  for (const rule of matched) {
    if (rule.setType) next.type = rule.setType;
    if (rule.collection?.trim()) next.collection = normalizeCollection(rule.collection);
    if (rule.tags.length) tags = normalizeTags([...tags, ...rule.tags]);
    if (rule.pinned) next.pinned = true;
    if (rule.archived) next.archived = true;
    if (allowProtected && rule.protected) next.protected = true;
  }
  next.tags = tags;
  return { draft: next, matched };
}

function readQuickPrefs(): QuickPrefs {
  if (typeof window === "undefined") return { type: "content", collection: "Chưa phân loại", tags: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUICK_PREFS_KEY) || "null") as Partial<QuickPrefs> | null;
    return {
      type: (["media", "content", "other"].includes(String(parsed?.type || "")) ? parsed?.type : "content") as StorageType,
      collection: normalizeCollection(parsed?.collection),
      tags: normalizeTags(Array.isArray(parsed?.tags) ? parsed.tags : []),
    };
  } catch {
    return { type: "content", collection: "Chưa phân loại", tags: [] };
  }
}

function extractFirstUrl(value: string) {
  const match = value.match(/https?:\/\/[^\s]+/i);
  return match?.[0]?.replace(/[),.;!?]+$/, "") || "";
}

function normalizeUrl(value: string) {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeTags(value: string | string[]) {
  const source = Array.isArray(value) ? value : value.split(",");
  const seen = new Set<string>();
  return source
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function normalizeCollection(value?: string) {
  return (value || "").trim().slice(0, 80) || "Chưa phân loại";
}

function formatDate(value: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatRelative(value: string) {
  if (!value) return "Chưa dùng";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Chưa dùng";
  const diff = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Vừa dùng";
  if (diff < hour) return `${Math.floor(diff / minute)} phút trước`;
  if (diff < day) return `${Math.floor(diff / hour)} giờ trước`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} ngày trước`;
  return formatDate(value);
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 140);
    throw new Error(`API không trả JSON hợp lệ${preview ? `: ${preview}` : "."}`);
  }
}

function createClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `dv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function withDefaults(item: Partial<VaultItem>): VaultItem {
  return {
    id: String(item.id || ""),
    type: (item.type || "other") as StorageType,
    name: String(item.name || ""),
    detail: String(item.detail || ""),
    url: String(item.url || ""),
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: String(item.updatedAt || item.createdAt || ""),
    tags: Array.isArray(item.tags) ? normalizeTags(item.tags) : [],
    pinned: Boolean(item.pinned),
    useCount: Math.max(0, Number(item.useCount || 0)),
    lastUsedAt: String(item.lastUsedAt || ""),
    collection: normalizeCollection(item.collection),
    archived: Boolean(item.archived),
    deleted: Boolean(item.deleted),
    deletedAt: String(item.deletedAt || ""),
    thumbnail: String(item.thumbnail || ""),
    protected: Boolean(item.protected),
    syncState: item.syncState || "synced",
  };
}

function readLocalItems(): VaultItem[] {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY) || window.localStorage.getItem(LEGACY_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(withDefaults) : [];
  } catch {
    return [];
  }
}

function readQueue(): QueueOperation[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY) || window.localStorage.getItem(LEGACY_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function applyBulkToMap(map: Map<string, VaultItem>, op: QueueOperation, state: SyncState) {
  const ids = op.targetIds || [];
  if (op.bulkMode === "purge") {
    ids.forEach((id) => map.delete(id));
    return;
  }
  ids.forEach((id) => {
    const current = map.get(id);
    if (!current) return;
    const next = { ...current, syncState: state };
    if (op.bulkMode === "archive") next.archived = true;
    if (op.bulkMode === "restore") next.archived = false;
    if (op.bulkMode === "pin") next.pinned = true;
    if (op.bulkMode === "unpin") next.pinned = false;
    if (op.bulkMode === "move") next.collection = normalizeCollection(op.collection);
    if (op.bulkMode === "delete") { next.deleted = true; next.deletedAt = new Date().toISOString(); next.archived = false; }
    if (op.bulkMode === "restoreTrash") { next.deleted = false; next.deletedAt = ""; }
    map.set(id, next);
  });
}

function applyQueueToItems(remoteItems: VaultItem[], queue: QueueOperation[]) {
  const map = new Map(remoteItems.map((item) => [item.id, { ...withDefaults(item), syncState: "synced" as SyncState }]));
  for (const op of queue) {
    const state: SyncState = op.error ? "error" : "pending";
    if (op.type === "bulk") {
      applyBulkToMap(map, op, state);
      continue;
    }
    if ((op.type === "create" || op.type === "update") && op.item) {
      map.set(op.targetId, { ...withDefaults(op.item), syncState: state });
      continue;
    }
    if (op.type === "delete") {
      const current = map.get(op.targetId);
      if (current) map.set(op.targetId, { ...current, deleted: true, deletedAt: current.deletedAt || new Date().toISOString(), archived: false, syncState: state });
      continue;
    }
    const current = map.get(op.targetId);
    if (!current) continue;
    if (op.type === "pin") current.pinned = Boolean(op.pinned);
    if (op.type === "use") {
      current.useCount = Math.max(current.useCount, Number(op.useCount || current.useCount));
      current.lastUsedAt = op.lastUsedAt || current.lastUsedAt;
    }
    current.syncState = state;
    map.set(op.targetId, current);
  }
  return Array.from(map.values());
}

function parseSearchTerms(query: string) {
  const terms: string[] = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(query.trim()))) terms.push((match[1] || match[2]).toLowerCase());
  return terms;
}


function exportableItem(item: VaultItem) {
  const { syncState: _syncState, ...clean } = item;
  return clean;
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function itemsToCsv(items: VaultItem[]) {
  const headers = ["id","type","name","detail","url","createdAt","updatedAt","tags","pinned","useCount","lastUsedAt","collection","archived","deleted","deletedAt","thumbnail","protected"];
  const rows = items.map((item) => headers.map((key) => csvCell((exportableItem(item) as Record<string, unknown>)[key])).join(","));
  return `\uFEFF${headers.join(",")}\n${rows.join("\n")}`;
}

function normalizedDuplicateKey(item: VaultItem) {
  const url = item.url.trim().toLowerCase();
  if (url) return `url:${url}`;
  const text = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return `text:${text(item.name)}|${text(item.detail)}`;
}

type SecurityConfig = {
  enabled: boolean;
  salt: string;
  hash: string;
  autoLockMinutes: number;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function derivePinHash(pin: string, saltBase64: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: base64ToBytes(saltBase64), iterations: 120_000, hash: "SHA-256" }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

function createSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

type LinkIntel = {
  kind: "none" | "drive-file" | "drive-folder" | "youtube" | "direct-image" | "direct-video" | "web" | "invalid";
  provider: string;
  label: string;
  fileId?: string;
  thumbnailUrl?: string;
  embedUrl?: string;
  streamUrl?: string;
  resourceKey?: string;
};

function analyzeLink(value: string): LinkIntel {
  if (!value.trim()) return { kind: "none", provider: "", label: "Không có link" };
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return { kind: "invalid", provider: "", label: "Link không hợp lệ" };
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname;

    if (host === "drive.google.com" || host === "docs.google.com") {
      const folderMatch = path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
      if (folderMatch) return { kind: "drive-folder", provider: "Google Drive", label: "Thư mục Drive", fileId: folderMatch[1] };
      const fileMatch = path.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([a-zA-Z0-9_-]+)/);
      const id = fileMatch?.[1] || url.searchParams.get("id") || undefined;
      const resourceKey = url.searchParams.get("resourcekey") || undefined;
      if (id) {
        const rk = resourceKey ? `&resourceKey=${encodeURIComponent(resourceKey)}` : "";
        const previewQuery = resourceKey ? `?resourcekey=${encodeURIComponent(resourceKey)}` : "";
        return {
          kind: "drive-file",
          provider: "Google Drive",
          label: "Tệp Google Drive",
          fileId: id,
          resourceKey,
          thumbnailUrl: `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600${rk}`,
          embedUrl: `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview${previewQuery}`,
          streamUrl: `/api/media?fileId=${encodeURIComponent(id)}${rk}`,
        };
      }
      return { kind: "web", provider: "Google Drive", label: "Liên kết Drive" };
    }

    if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com") {
      const id = host === "youtu.be" ? path.split("/").filter(Boolean)[0] : (url.searchParams.get("v") || path.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1]);
      if (id) return {
        kind: "youtube", provider: "YouTube", label: "Video YouTube", fileId: id,
        thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&rel=0`,
      };
    }

    if (/\.(?:png|jpe?g|gif|webp|avif)(?:$|\?)/i.test(url.href)) return { kind: "direct-image", provider: host, label: "Ảnh trực tiếp", thumbnailUrl: url.href };
    if (/\.(?:mp4|webm|mov|m4v|ogv)(?:$|\?)/i.test(url.href)) return { kind: "direct-video", provider: host, label: "Video trực tiếp", streamUrl: url.href };
    return { kind: "web", provider: host, label: "Liên kết web" };
  } catch {
    return { kind: "invalid", provider: "", label: "Link không hợp lệ" };
  }
}

function inferMediaKind(item: VaultItem): MediaKind {
  const intel = analyzeLink(item.url);
  const text = `${item.name} ${item.detail} ${item.tags.join(" ")}`.toLowerCase();
  if (intel.kind === "direct-image" || /(^|\s)(ảnh|image|photo|picture)(\s|$)/i.test(text)) return "image";
  if (intel.kind === "youtube" || intel.kind === "direct-video" || /(^|\s)(video|clip|youtube|tiktok)(\s|$)/i.test(text)) return "video";
  if (/\.(png|jpe?g|gif|webp|avif)\b/i.test(item.name) || /\.(png|jpe?g|gif|webp|avif)(?:$|\?)/i.test(item.url)) return "image";
  if (/\.(mp4|webm|mov|m4v|ogv)\b/i.test(item.name) || /\.(mp4|webm|mov|m4v|ogv)(?:$|\?)/i.test(item.url)) return "video";
  return "unknown";
}

function mediaThumbSource(item: VaultItem) {
  const intel = analyzeLink(item.url);
  return item.thumbnail || intel.thumbnailUrl || "";
}

function readMediaProgress(itemId: string) {
  if (typeof window === "undefined") return 0;
  try {
    const raw = JSON.parse(window.localStorage.getItem(MEDIA_PROGRESS_KEY) || "{}") as Record<string, number>;
    const value = Number(raw[itemId] || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

function writeMediaProgress(itemId: string, seconds: number) {
  if (typeof window === "undefined" || !Number.isFinite(seconds) || seconds < 0) return;
  try {
    const raw = JSON.parse(window.localStorage.getItem(MEDIA_PROGRESS_KEY) || "{}") as Record<string, number>;
    raw[itemId] = Math.round(seconds * 10) / 10;
    window.localStorage.setItem(MEDIA_PROGRESS_KEY, JSON.stringify(raw));
  } catch {}
}

function readMediaKindCache(): Record<string, MediaKind> {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(window.localStorage.getItem(MEDIA_KIND_CACHE_KEY) || "{}") as Record<string, MediaKind>;
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

function writeMediaKindCache(value: Record<string, MediaKind>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(MEDIA_KIND_CACHE_KEY, JSON.stringify(value)); } catch {}
}

function inferQuickCapture(value: string): { type: StorageType; collection: string; tags: string[]; label: string } {
  const normalized = normalizeUrl(value);
  if (!normalized) return { type: "content", collection: "Chưa phân loại", tags: [], label: "Nội dung" };
  const intel = analyzeLink(normalized);
  let host = "";
  try { host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, ""); } catch {}

  if (host.includes("shopee.")) return { type: "other", collection: "Shopee", tags: ["shopee", "mua sắm"], label: "Shopee" };
  if (host.includes("lazada.")) return { type: "other", collection: "Mua sắm", tags: ["lazada", "mua sắm"], label: "Lazada" };
  if (host.includes("tiktok.")) return { type: "media", collection: "Media", tags: ["video", "tiktok"], label: "TikTok" };
  if (intel.kind === "youtube") return { type: "media", collection: "Media", tags: ["video", "youtube"], label: "YouTube" };
  if (intel.kind === "drive-file") return { type: "media", collection: "Media", tags: ["google drive"], label: "Google Drive" };
  if (intel.kind === "direct-image") return { type: "media", collection: "Media", tags: ["ảnh"], label: "Ảnh" };
  if (intel.kind === "direct-video") return { type: "media", collection: "Media", tags: ["video"], label: "Video" };
  if (intel.kind === "drive-folder") return { type: "other", collection: "Google Drive", tags: ["google drive", "folder"], label: "Thư mục Drive" };
  return { type: "other", collection: "Liên kết", tags: ["link"], label: intel.provider || "Liên kết" };
}

function isSuspiciousDriveLink(item: VaultItem) {
  if (!item.url) return false;
  const intel = analyzeLink(item.url);
  return intel.kind === "invalid" || (item.type === "media" && intel.kind === "web");
}

function MediaThumbnail({ item }: { item: VaultItem }) {
  const [failed, setFailed] = useState(false);
  if (item.protected) return <div className="protected-media-placeholder"><Lock size={18}/><span>Media được bảo vệ</span></div>;
  const intel = analyzeLink(item.url);
  const source = item.thumbnail || intel.thumbnailUrl;
  if (!source || failed) return null;
  return <div className="media-thumbnail"><img src={source} alt={`Thumbnail ${item.name}`} loading="lazy" onError={() => setFailed(true)} /></div>;
}

function formatMediaTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type IOSVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

function InAppVideoPlayer({ item, src, poster, fallbackEmbedUrl = "" }: { item: VaultItem; src: string; poster?: string; fallbackEmbedUrl?: string }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<IOSVideoElement | null>(null);
  const pictureTimerRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [compatibilityMode, setCompatibilityMode] = useState(false);
  const [appFullscreen, setAppFullscreen] = useState(false);

  useEffect(() => () => {
    if (pictureTimerRef.current !== null) window.clearTimeout(pictureTimerRef.current);
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      if (!document.fullscreenElement) setAppFullscreen(false);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  function switchToCompatibilityMode() {
    if (!fallbackEmbedUrl) {
      setFailed(true);
      return;
    }
    if (pictureTimerRef.current !== null) window.clearTimeout(pictureTimerRef.current);
    setCompatibilityMode(true);
    setPlaying(false);
  }

  function verifyPicture(video: HTMLVideoElement) {
    if (!fallbackEmbedUrl || video.videoWidth > 0 || video.videoHeight > 0) return;
    if (pictureTimerRef.current !== null) window.clearTimeout(pictureTimerRef.current);
    pictureTimerRef.current = window.setTimeout(() => {
      const current = videoRef.current;
      if (current && current.videoWidth === 0 && current.videoHeight === 0) switchToCompatibilityMode();
    }, 1200);
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {
      switchToCompatibilityMode();
    }
  }

  async function toggleFullscreen() {
    const stage = stageRef.current;
    const video = videoRef.current;

    if (appFullscreen) {
      setAppFullscreen(false);
      return;
    }
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
      return;
    }

    // iPhone/iOS Safari does not reliably support Element.requestFullscreen().
    // Native video fullscreen is the most stable path there.
    if (video?.webkitEnterFullscreen && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      try { video.webkitEnterFullscreen(); return; } catch {}
    }

    if (stage?.requestFullscreen) {
      try { await stage.requestFullscreen(); return; } catch {}
    }
    if (video?.webkitEnterFullscreen) {
      try { video.webkitEnterFullscreen(); return; } catch {}
    }
    setAppFullscreen(true);
  }

  if (compatibilityMode && fallbackEmbedUrl) {
    return <div className="media-compatibility-wrap">
      <div className="media-compatibility-label">Chế độ tương thích Google Drive</div>
      <div className="media-viewer-shell video-shell drive-preview-shell compatibility-player">
        <iframe
          src={fallbackEmbedUrl}
          title={`Xem video ${item.name}`}
          loading="eager"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <div className="media-compatibility-note">DriveVault chỉ chuyển sang player Google Drive khi trình duyệt không giải mã được video gốc.</div>
    </div>;
  }

  return <div className={`media-viewer-shell video-shell dv-video-player ${appFullscreen ? "app-fullscreen" : ""}`} ref={stageRef}>
    <video
      ref={videoRef}
      className="inapp-video dv-video-element"
      playsInline
      preload="metadata"
      poster={poster}
      src={src}
      onClick={() => void togglePlayback()}
      onLoadedMetadata={(e) => {
        const video = e.currentTarget;
        setDuration(Number.isFinite(video.duration) ? video.duration : 0);
        const saved = readMediaProgress(item.id);
        if (saved > 2 && saved < Math.max(0, video.duration - 5)) {
          try { video.currentTime = saved; } catch {}
        }
      }}
      onLoadedData={(e) => {
        setReady(true);
        verifyPicture(e.currentTarget);
      }}
      onCanPlay={(e) => {
        setReady(true);
        verifyPicture(e.currentTarget);
      }}
      onPlaying={(e) => {
        setPlaying(true);
        verifyPicture(e.currentTarget);
        window.dispatchEvent(new Event("drivevault-activity"));
      }}
      onPause={() => setPlaying(false)}
      onTimeUpdate={(e) => {
        const value = e.currentTarget.currentTime;
        setCurrentTime(value);
        writeMediaProgress(item.id, value);
        window.dispatchEvent(new Event("drivevault-activity"));
      }}
      onEnded={() => {
        setPlaying(false);
        setCurrentTime(0);
        writeMediaProgress(item.id, 0);
      }}
      onError={() => switchToCompatibilityMode()}
    />

    {!ready && !failed && <div className="dv-video-loading"><Loader2 size={22} className="spin"/><span>Đang chuẩn bị video…</span></div>}
    {failed && <div className="media-player-error">Không phát được video. Hãy kiểm tra quyền chia sẻ Google Drive hoặc định dạng file.</div>}

    <div className="dv-video-controls" onClick={(e) => e.stopPropagation()}>
      <button className="dv-video-play" onClick={() => void togglePlayback()} aria-label={playing ? "Tạm dừng" : "Phát video"}>
        {playing ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}
      </button>
      <input
        className="dv-video-progress"
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step="0.1"
        value={Math.min(currentTime, Math.max(duration, 0.01))}
        onChange={(e) => {
          const value = Number(e.target.value);
          setCurrentTime(value);
          if (videoRef.current) videoRef.current.currentTime = value;
        }}
        aria-label="Tiến trình video"
      />
      <span className="dv-video-time">{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
      <button className="dv-video-fullscreen" onClick={() => void toggleFullscreen()} aria-label="Xem video toàn màn hình">
        <Maximize2 size={18}/>
      </button>
    </div>
  </div>;
}

function MediaDetailPreview({ item }: { item: VaultItem }) {
  const intel = analyzeLink(item.url);
  const [driveImageFailed, setDriveImageFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [appFullscreen, setAppFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const resolvedKind = (typeof window !== "undefined" ? readMediaKindCache()[item.id] : undefined) || inferMediaKind(item);
  if (!item.url) return null;

  async function toggleImageFullscreen() {
    if (appFullscreen) {
      setAppFullscreen(false);
      return;
    }
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
      return;
    }
    if (stageRef.current?.requestFullscreen) {
      try { await stageRef.current.requestFullscreen(); return; } catch {}
    }
    setAppFullscreen(true);
  }

  const shellClass = `media-viewer-shell ${appFullscreen ? "app-fullscreen" : ""}`;
  const imageFullButton = <button className="media-fullscreen" onClick={() => void toggleImageFullscreen()} aria-label={appFullscreen ? "Thoát toàn màn hình" : "Xem toàn màn hình"}><Maximize2 size={17}/></button>;

  if (intel.kind === "direct-image") {
    return <div className={shellClass} ref={stageRef}>
      {imageFullButton}
      <img className="inapp-image" src={intel.thumbnailUrl} alt={item.name} onError={() => setImageFailed(true)} />
      {imageFailed && <div className="media-player-error">Không tải được ảnh. Hãy kiểm tra quyền truy cập link.</div>}
    </div>;
  }

  if (intel.kind === "drive-file" && intel.streamUrl && resolvedKind === "image" && !driveImageFailed) {
    return <div className={shellClass} ref={stageRef}>
      {imageFullButton}
      <img className="inapp-image" src={intel.streamUrl} alt={item.name} onError={() => setDriveImageFailed(true)} />
    </div>;
  }

  // V2.2.0 Media Fix 1: khôi phục HTML5 player làm player chính như các bản cũ.
  // Google Drive Preview chỉ là fallback khi browser thật sự không giải mã được track video.
  // Nhờ vậy không còn 2 nút fullscreen chồng nhau và control luôn thao tác được trên iPhone.
  if (intel.kind === "drive-file" && intel.streamUrl && resolvedKind !== "image") {
    return <InAppVideoPlayer item={item} src={intel.streamUrl} poster={item.thumbnail || intel.thumbnailUrl} fallbackEmbedUrl={intel.embedUrl || ""}/>;
  }

  if (intel.kind === "direct-video" && intel.streamUrl) {
    return <InAppVideoPlayer item={item} src={intel.streamUrl} poster={item.thumbnail || intel.thumbnailUrl}/>;
  }

  if (intel.embedUrl) {
    return <div className="media-viewer-shell video-shell drive-preview-shell compatibility-player">
      <iframe src={intel.embedUrl} title={`Xem ${item.name}`} loading="eager" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
    </div>;
  }

  if (intel.thumbnailUrl && !imageFailed) {
    return <div className={shellClass} ref={stageRef}>
      {imageFullButton}
      <img className="inapp-image" src={item.thumbnail || intel.thumbnailUrl} alt={item.name} onError={() => setImageFailed(true)} />
    </div>;
  }
  return <div className="media-player-error">Không xác định được định dạng media để xem trực tiếp.</div>;
}

function compressVideoFrame(video: HTMLVideoElement) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("Video chưa sẵn sàng để lấy thumbnail.");
  const targets = [480, 420, 360, 300];
  for (const maxWidth of targets) {
    const scale = Math.min(1, maxWidth / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.68, 0.56, 0.46, 0.36]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= 45_000) return data;
    }
  }
  throw new Error("Khung hình quá lớn để lưu vào Google Sheet.");
}

function VideoThumbnailPicker({ url, value, onChange }: { url: string; value: string; onChange: (value: string) => void }) {
  const intel = analyzeLink(url);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const streamUrl = intel.kind === "drive-file" ? intel.streamUrl : intel.kind === "direct-video" ? intel.streamUrl : "";
  if (!streamUrl) {
    if (intel.thumbnailUrl) return <div className="thumbnail-picker static"><img src={value || intel.thumbnailUrl} alt="Thumbnail"/><div><strong>Thumbnail tự động</strong><span>Link này không hỗ trợ kéo chọn khung hình trong trình duyệt.</span></div></div>;
    return null;
  }

  function seek(next: number) {
    setTime(next);
    if (videoRef.current && Number.isFinite(next)) videoRef.current.currentTime = next;
  }

  function capture() {
    try {
      if (!videoRef.current) return;
      const data = compressVideoFrame(videoRef.current);
      onChange(data);
      setMessage("Đã chọn khung hình hiện tại làm thumbnail.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lấy được thumbnail.");
    }
  }

  return <div className="thumbnail-picker">
    <div className="thumbnail-picker-head"><div><ImagePlus size={17}/><span><strong>Thumbnail video</strong><small>Kéo thanh thời gian → chọn khung hình</small></span></div>{value && <button type="button" onClick={() => onChange("")}>Dùng tự động</button>}</div>
    <div className="thumbnail-video-wrap">
      <video ref={videoRef} muted playsInline preload="metadata" src={streamUrl} poster={value || intel.thumbnailUrl} onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuration(d); }} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onError={() => setFailed(true)} />
      {failed && <div className="thumbnail-video-error">Không đọc được video trực tiếp. Hãy kiểm tra quyền chia sẻ Drive là “Bất kỳ ai có liên kết”.</div>}
    </div>
    {!failed && <><input className="thumbnail-range" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(time, duration || 1)} onChange={(e) => seek(Number(e.target.value))}/><div className="thumbnail-picker-actions"><span>{Math.floor(time)}s / {duration ? Math.floor(duration) : 0}s</span><button type="button" onClick={capture}><ImagePlus size={15}/> Dùng khung hình này</button></div></>}
    {value && <img className="thumbnail-selected-preview" src={value} alt="Thumbnail đã chọn"/>}
    {message && <div className="thumbnail-message">{message}</div>}
  </div>;
}

function SyncBadge({ state }: { state?: SyncState }) {
  if (state === "pending") return <span className="sync-badge pending"><CloudOff size={12} /> Chờ đồng bộ</span>;
  if (state === "syncing") return <span className="sync-badge syncing"><Loader2 className="spin" size={12} /> Đang đồng bộ</span>;
  if (state === "error") return <span className="sync-badge error"><AlertCircle size={12} /> Lỗi đồng bộ</span>;
  return <span className="sync-badge synced"><Cloud size={12} /> Đã đồng bộ</span>;
}

function SwipeCard({
  item,
  onOpen,
  onEdit,
  onDelete,
  onCopy,
  onOpenUrl,
  onTogglePin,
  selectionMode,
  checked,
  onSelect,
  trashed,
}: {
  item: VaultItem;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onOpenUrl: () => void;
  onTogglePin: () => void;
  selectionMode: boolean;
  checked: boolean;
  onSelect: () => void;
  trashed?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef<number | null>(null);
  const startOffset = useRef(0);
  const moved = useRef(false);
  const meta = typeMeta[item.type] || typeMeta.other;
  const Icon = meta.icon;
  const intel = analyzeLink(item.url);
  const actionsVisible = !selectionMode && !item.protected && offset < -2;

  useEffect(() => { if (selectionMode) setOffset(0); }, [selectionMode]);

  function pointerDown(e: React.PointerEvent) {
    if (selectionMode || item.protected) return;
    startX.current = e.clientX;
    startOffset.current = offset;
    moved.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function pointerMove(e: React.PointerEvent) {
    if (selectionMode || startX.current === null) return;
    const delta = e.clientX - startX.current;
    if (Math.abs(delta) > 7) moved.current = true;
    setOffset(Math.max(-142, Math.min(0, startOffset.current + delta)));
  }

  function pointerUp() {
    if (selectionMode || startX.current === null) return;
    setOffset(offset < -48 ? -132 : 0);
    startX.current = null;
  }

  return (
    <div className={`swipe-row ${checked ? "selected-row" : ""}`}>
      <div className={`swipe-actions ${actionsVisible ? "visible" : ""}`} aria-hidden={!actionsVisible}>
        <button className="swipe-edit" tabIndex={actionsVisible ? 0 : -1} aria-label={trashed ? `Khôi phục ${item.name}` : `Sửa ${item.name}`} onClick={() => { setOffset(0); onEdit(); }}>
          {trashed ? <ArchiveRestore size={19} /> : <Pencil size={19} />}<span>{trashed ? "Khôi phục" : "Sửa"}</span>
        </button>
        <button className="swipe-delete" tabIndex={actionsVisible ? 0 : -1} aria-label={trashed ? `Xóa vĩnh viễn ${item.name}` : `Xóa ${item.name}`} onClick={() => { setOffset(0); onDelete(); }}>
          <Trash2 size={19} /><span>{trashed ? "Xóa hẳn" : "Xóa"}</span>
        </button>
      </div>

      <article
        className={`card swipe-card ${item.pinned ? "is-pinned" : ""} ${item.archived ? "is-archived" : ""} ${item.deleted ? "is-deleted" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onClick={() => {
          if (selectionMode) return onSelect();
          if (moved.current) return;
          if (offset !== 0) return setOffset(0);
          onOpen();
        }}
      >
        {selectionMode && (
          <button className={`select-check ${checked ? "checked" : ""}`} onClick={(e) => { e.stopPropagation(); onSelect(); }} aria-label={checked ? "Bỏ chọn" : "Chọn mục"}>
            {checked ? <Check size={16} /> : <Square size={16} />}
          </button>
        )}
        <div className="card-head">
          <div className="card-head-left">
            <span className={`badge ${meta.className}`}><Icon size={14} />{meta.label}</span>
            {item.pinned && <span className="pin-label"><Pin size={12} /> Ghim</span>}
            {item.archived && <span className="archive-label"><Archive size={12} /> Lưu trữ</span>}{item.protected && <span className="protected-label"><Lock size={12}/> Bảo vệ</span>}{item.deleted && <span className="trash-label"><Trash2 size={12} /> Thùng rác</span>}
          </div>
          {!selectionMode && !item.deleted && <button className={`pin-button ${item.pinned ? "active" : ""}`} onClick={(e) => { e.stopPropagation(); onTogglePin(); }} aria-label={item.pinned ? "Bỏ ghim" : "Ghim mục này"}>{item.pinned ? <PinOff size={17} /> : <Pin size={17} />}</button>}
        </div>

        <div className="card-title-row">
          <div>
            <h2>{item.name}</h2>
            {item.useCount > 0 && <div className="card-meta"><span>Đã dùng {item.useCount} lần</span></div>}
          </div>
          {!selectionMode && <ChevronRight className="card-chevron" size={19} />}
        </div>

        <div className="collection-label"><Folder size={13} /> {item.collection}</div>
        {item.type === "media" && item.url && <MediaThumbnail item={item} />}
        {!item.protected && item.url && <div className={`link-intel-row ${intel.kind === "invalid" ? "invalid" : ""}`}><Link2 size={12}/><span>{intel.label}</span>{intel.provider && <small>{intel.provider}</small>}</div>}
        {item.protected ? <p className="detail protected-detail"><Lock size={13}/> Nội dung được bảo vệ · chạm block để xác thực</p> : item.detail && <p className="detail">{item.detail}</p>}
        {item.tags.length > 0 && <div className="tag-row">{item.tags.slice(0, 3).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}{item.tags.length > 3 && <span className="tag more">+{item.tags.length - 3}</span>}</div>}

        <div className="card-status-row">
          <SyncBadge state={item.syncState} />
          {item.lastUsedAt && <span className="last-used">{formatRelative(item.lastUsedAt)}</span>}
        </div>

        {!selectionMode && !item.deleted && !item.protected && <div className="actions" onClick={(e) => e.stopPropagation()}>
          {item.detail && <button className="secondary" onClick={onCopy}><Clipboard size={17} /> Sao chép</button>}
          {item.url && <a className="primary" href={item.url} target="_blank" rel="noreferrer" onClick={onOpenUrl}><ExternalLink size={17} /> Truy cập</a>}
        </div>}
      </article>
    </div>
  );
}


function MediaLibraryTile({ item, kind, selectionMode, checked, onSelect, onOpenGallery, onOpenDetail }: {
  item: VaultItem;
  kind: MediaKind;
  selectionMode: boolean;
  checked: boolean;
  onSelect: () => void;
  onOpenGallery: () => void;
  onOpenDetail: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const source = mediaThumbSource(item);
  const open = () => {
    if (selectionMode) return onSelect();
    if (item.protected || item.deleted || item.archived) return onOpenDetail();
    onOpenGallery();
  };
  return <article className={`media-library-tile ${checked ? "selected" : ""} ${item.protected ? "protected" : ""}`} onClick={open}>
    <div className="media-library-cover">
      {!item.protected && source && !failed ? <img src={source} alt={item.name} loading="lazy" onError={() => setFailed(true)} /> : <div className="media-library-placeholder">{item.protected ? <Lock size={24}/> : <ImageIcon size={25}/>}<span>{item.protected ? "Được bảo vệ" : "Chưa có thumbnail"}</span></div>}
      {kind === "video" && !item.protected && <span className="media-play-badge"><Play size={18} fill="currentColor"/></span>}
      <span className="media-kind-badge">{kind === "image" ? "Ảnh" : kind === "video" ? "Video" : "Media"}</span>
      {item.pinned && <span className="media-pin-badge"><Pin size={13}/></span>}
      {selectionMode && <button className={`media-select ${checked ? "checked" : ""}`} onClick={(e) => { e.stopPropagation(); onSelect(); }} aria-label={checked ? "Bỏ chọn" : "Chọn media"}>{checked ? <Check size={16}/> : <Square size={16}/>}</button>}
    </div>
    <div className="media-library-info">
      <div><strong>{item.name}</strong><span><Folder size={11}/>{item.collection}</span></div>
      {!selectionMode && <button onClick={(e) => { e.stopPropagation(); onOpenDetail(); }} aria-label="Xem chi tiết"><ChevronRight size={18}/></button>}
    </div>
  </article>;
}

function MediaGallery({ items, activeId, onChange, onClose, onDetail }: {
  items: VaultItem[];
  activeId: string;
  onChange: (id: string) => void;
  onClose: () => void;
  onDetail: (item: VaultItem) => void;
}) {
  const index = Math.max(0, items.findIndex((item) => item.id === activeId));
  const item = items[index];
  const startX = useRef<number | null>(null);
  const next = useCallback((delta: number) => {
    if (!items.length) return;
    const target = (index + delta + items.length) % items.length;
    onChange(items[target].id);
  }, [index, items, onChange]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") next(-1);
      if (event.key === "ArrowRight") next(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, onClose]);

  if (!item) return null;
  return <div className="media-gallery-backdrop" role="dialog" aria-modal="true" aria-label={`Gallery ${item.name}`}
    onPointerDown={(e) => { startX.current = e.clientX; }}
    onPointerUp={(e) => { if (startX.current === null) return; const dx = e.clientX - startX.current; startX.current = null; if (Math.abs(dx) > 55) next(dx < 0 ? 1 : -1); }}>
    <header className="media-gallery-head">
      <div><span>{index + 1}/{items.length}</span><strong>{item.name}</strong><small>{item.collection}</small></div>
      <div><button onClick={() => onDetail(item)} aria-label="Chi tiết"><FileText size={19}/></button><button onClick={onClose} aria-label="Đóng gallery"><X size={21}/></button></div>
    </header>
    <div className="media-gallery-stage">
      <MediaDetailPreview key={item.id} item={item}/>
    </div>
    {items.length > 1 && <><button className="gallery-nav gallery-prev" onClick={(e) => { e.stopPropagation(); next(-1); }} aria-label="Media trước"><ChevronLeft size={25}/></button><button className="gallery-nav gallery-next" onClick={(e) => { e.stopPropagation(); next(1); }} aria-label="Media sau"><ChevronRight size={25}/></button></>}
    <footer className="media-gallery-footer"><span>Vuốt ngang để chuyển media</span><a href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Mở link gốc</a></footer>
  </div>;
}

export default function DriveVaultApp() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | StorageType>("all");
  const [mediaKindFilter, setMediaKindFilter] = useState<MediaKindFilter>("all");
  const [mediaViewMode, setMediaViewMode] = useState<MediaViewMode>("grid");
  const [mediaGalleryId, setMediaGalleryId] = useState<string | null>(null);
  const [mediaKindCache, setMediaKindCache] = useState<Record<string, MediaKind>>({});
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("all");
  const [selectedTag, setSelectedTag] = useState("all");
  const [selectedCollection, setSelectedCollection] = useState("all");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("smart");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [searchFields, setSearchFields] = useState<Record<SearchField, boolean>>({ name: true, detail: true, url: true, tags: true, collection: true });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [form, setForm] = useState<CreateVaultItem>(emptyForm);
  const [tagText, setTagText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [floatingActive, setFloatingActive] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [searchStickyActive, setSearchStickyActive] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [undoDelete, setUndoDelete] = useState<UndoDeleteState | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCollection, setBulkCollection] = useState("Chưa phân loại");
  const [showDataTools, setShowDataTools] = useState(false);
  const [backups, setBackups] = useState<BackupSnapshot[]>([]);
  const [dataBusy, setDataBusy] = useState(false);
  const [backupNote, setBackupNote] = useState("");
  const [importItems, setImportItems] = useState<VaultItem[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importMode, setImportMode] = useState<"skip" | "merge" | "replace">("skip");
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [classifications, setClassifications] = useState<string[]>([]);
  const [newClassification, setNewClassification] = useState("");
  const [classificationBusy, setClassificationBusy] = useState(false);
  const [securityReady, setSecurityReady] = useState(false);
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig | null>(null);
  const [locked, setLocked] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [securityPin, setSecurityPin] = useState("");
  const [securityPinConfirm, setSecurityPinConfirm] = useState("");
  const [securityOldPin, setSecurityOldPin] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [protectedTargetId, setProtectedTargetId] = useState<string | null>(null);
  const [protectedPin, setProtectedPin] = useState("");
  const [protectedError, setProtectedError] = useState("");
  const [templates, setTemplates] = useState<QuickTemplate[]>([]);
  const [homeConfig, setHomeConfig] = useState<HomeConfig>(defaultHomeConfig);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [duplicateCandidate, setDuplicateCandidate] = useState<VaultItem | null>(null);
  const [duplicateOverride, setDuplicateOverride] = useState(false);
  const [smartRules, setSmartRules] = useState<SmartRule[]>(defaultSmartRules);
  const [showRules, setShowRules] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<Omit<SmartRule, "id">>(emptySmartRule);
  const [ruleTagText, setRuleTagText] = useState("");
  const [runningRules, setRunningRules] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const scrollIdleTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const queueRef = useRef<QueueOperation[]>([]);
  const itemsRef = useRef<VaultItem[]>([]);
  const flushingRef = useRef(false);
  const autoLockTimer = useRef<number | null>(null);

  const selected = selectedId ? items.find((item) => item.id === selectedId) || null : null;

  function writeQueue(queue: QueueOperation[]) {
    queueRef.current = queue;
    setPendingCount(queue.length);
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1900);
  }

  function persistHomeConfig(next: HomeConfig) {
    setHomeConfig(next);
    try { window.localStorage.setItem(HOME_CONFIG_KEY, JSON.stringify(next)); } catch {}
  }

  function toggleFavoriteCollection(name: string) {
    const exists = homeConfig.favoriteCollections.includes(name);
    persistHomeConfig({
      ...homeConfig,
      favoriteCollections: exists
        ? homeConfig.favoriteCollections.filter((value) => value !== name)
        : [...homeConfig.favoriteCollections, name].slice(0, 8),
    });
  }

  function writeTemplates(next: QuickTemplate[]) {
    setTemplates(next);
    try { window.localStorage.setItem(QUICK_TEMPLATES_KEY, JSON.stringify(next)); } catch {}
  }

  function persistSmartRules(next: SmartRule[]) {
    setSmartRules(next);
    try { window.localStorage.setItem(SMART_RULES_KEY, JSON.stringify(next)); } catch {}
  }

  function addSmartRule() {
    const value = ruleDraft.value.trim();
    const name = ruleDraft.name.trim() || `Rule ${smartRules.length + 1}`;
    if (!value) return notify("Nhập điều kiện cho rule trước");
    const next: SmartRule = {
      ...ruleDraft,
      id: createClientId(),
      name: name.slice(0, 80),
      value: value.slice(0, 200),
      collection: ruleDraft.collection?.trim() ? normalizeCollection(ruleDraft.collection) : "",
      tags: normalizeTags(ruleTagText),
    };
    persistSmartRules([next, ...smartRules]);
    setRuleDraft(emptySmartRule);
    setRuleTagText("");
    notify("Đã tạo Smart Rule");
  }

  function toggleSmartRule(id: string) {
    persistSmartRules(smartRules.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule));
  }

  function removeSmartRule(id: string) {
    persistSmartRules(smartRules.filter((rule) => rule.id !== id));
    notify("Đã xóa rule");
  }

  async function runRulesOnExistingData() {
    const candidates = itemsRef.current.filter((item) => !item.deleted);
    const updates: VaultItem[] = [];
    for (const item of candidates) {
      const applied = applySmartRulesToDraft({ ...item }, smartRules, Boolean(securityConfig?.enabled));
      if (!applied.matched.length) continue;
      const next = withDefaults({ ...item, ...applied.draft, protected: Boolean(applied.draft.protected && securityConfig?.enabled), updatedAt: new Date().toISOString(), syncState: "pending" });
      const changed = next.type !== item.type || next.collection !== item.collection || next.pinned !== item.pinned || next.archived !== item.archived || next.protected !== item.protected || next.tags.join("|") !== item.tags.join("|");
      if (changed) updates.push(next);
    }
    if (!updates.length) return notify("Không có dữ liệu nào cần cập nhật theo rule");
    if (!window.confirm(`Áp dụng Smart Rules cho ${updates.length} mục hiện có?`)) return;
    setRunningRules(true);
    const updateMap = new Map(updates.map((item) => [item.id, item]));
    setItems((current) => current.map((item) => updateMap.get(item.id) || item));
    for (const item of updates) enqueue({ opId: createClientId(), type: "update", targetId: item.id, item });
    setRunningRules(false);
    notify(`Đã áp dụng rule cho ${updates.length} mục`);
  }

  function saveCurrentAsTemplate() {
    const templateName = form.name.trim();
    if (!templateName) return notify("Nhập tên trước khi lưu thành mẫu");
    const next: QuickTemplate = {
      id: createClientId(),
      name: templateName.slice(0, 80),
      type: form.type,
      detail: String(form.detail || ""),
      url: String(form.url || ""),
      tags: normalizeTags(tagText),
      collection: normalizeCollection(form.collection),
    };
    writeTemplates([next, ...templates].slice(0, 20));
    notify("Đã lưu mẫu Quick Capture");
  }

  function applyTemplate(template: QuickTemplate) {
    setForm((current) => ({
      ...current,
      type: template.type,
      name: template.name,
      detail: template.detail,
      url: template.url,
      tags: template.tags,
      collection: template.collection,
      thumbnail: "",
    }));
    setTagText(template.tags.join(", "));
    notify(`Đã áp dụng mẫu ${template.name}`);
  }

  function removeTemplate(id: string) {
    writeTemplates(templates.filter((template) => template.id !== id));
  }

  async function installApp() {
    if (!installPrompt) return notify("Trình duyệt chưa cung cấp tùy chọn cài đặt");
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") notify("Đã bắt đầu cài DriveVault");
    setInstallPrompt(null);
  }

  async function verifyPin(pin: string, config = securityConfig) {
    if (!config?.enabled || !config.salt || !config.hash) return false;
    if (!/^\d{4,8}$/.test(pin)) return false;
    return (await derivePinHash(pin, config.salt)) === config.hash;
  }

  async function saveSecurity() {
    setSecurityError("");
    if (!/^\d{4,8}$/.test(securityPin)) return setSecurityError("PIN cần từ 4–8 chữ số.");
    if (securityPin !== securityPinConfirm) return setSecurityError("Xác nhận PIN chưa khớp.");
    setSecurityBusy(true);
    try {
      if (securityConfig?.enabled && !(await verifyPin(securityOldPin))) {
        setSecurityError("PIN hiện tại không đúng.");
        return;
      }
      const salt = createSalt();
      const next: SecurityConfig = {
        enabled: true,
        salt,
        hash: await derivePinHash(securityPin, salt),
        autoLockMinutes: securityConfig?.autoLockMinutes || 5,
      };
      window.localStorage.setItem(SECURITY_KEY, JSON.stringify(next));
      setSecurityConfig(next);
      setLocked(false);
      setSecurityPin(""); setSecurityPinConfirm(""); setSecurityOldPin("");
      notify(securityConfig?.enabled ? "Đã đổi PIN" : "Đã bật App Lock");
    } finally { setSecurityBusy(false); }
  }

  async function disableSecurity() {
    setSecurityError("");
    if (!securityConfig?.enabled) return;
    setSecurityBusy(true);
    try {
      if (!(await verifyPin(securityOldPin))) return setSecurityError("PIN hiện tại không đúng.");
      window.localStorage.removeItem(SECURITY_KEY);
      setSecurityConfig(null);
      setLocked(false);
      setSecurityOldPin(""); setSecurityPin(""); setSecurityPinConfirm("");
      setItems((current) => current.map((item) => item.protected ? { ...item, protected: false, syncState: "pending" } : item));
      itemsRef.current.filter((item) => item.protected).forEach((item) => {
        const updated = { ...item, protected: false, syncState: "pending" as SyncState };
        enqueue({ opId: createClientId(), type: "update", targetId: item.id, item: updated });
      });
      notify("Đã tắt App Lock");
    } finally { setSecurityBusy(false); }
  }

  function updateAutoLock(minutes: number) {
    if (!securityConfig) return;
    const next = { ...securityConfig, autoLockMinutes: minutes };
    setSecurityConfig(next);
    window.localStorage.setItem(SECURITY_KEY, JSON.stringify(next));
    notify("Đã cập nhật thời gian tự khóa");
  }

  async function unlockWithPin(pin: string) {
    if (!(await verifyPin(pin))) return false;
    setLocked(false);
    setSecurityError("");
    return true;
  }

  function lockNow() {
    if (!securityConfig?.enabled) return setShowSecurity(true);
    setShowSecurity(false);
    setSelectedId(null);
    setShowForm(false);
    setShowDataTools(false);
    setAdvancedOpen(false);
    setLocked(true);
  }

  function openItem(item: VaultItem) {
    if (item.protected && !securityConfig?.enabled) {
      openSecuritySettings();
      notify("Mục này được bảo vệ · hãy bật App Lock trên thiết bị này");
      return;
    }
    if (item.protected && securityConfig?.enabled) {
      setProtectedTargetId(item.id);
      setProtectedPin("");
      setProtectedError("");
      return;
    }
    setSelectedId(item.id);
  }

  async function verifyProtectedItem() {
    if (!(await verifyPin(protectedPin))) return setProtectedError("PIN không đúng.");
    const id = protectedTargetId;
    setProtectedTargetId(null);
    setProtectedPin("");
    setProtectedError("");
    if (id) setSelectedId(id);
  }

  const loadItems = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/items", { cache: "no-store" });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || "Không tải được dữ liệu.");
      const remote = Array.isArray(data.items) ? data.items.map(withDefaults) : [];
      setItems(applyQueueToItems(remote, queueRef.current));
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : "Không tải được dữ liệu.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushingRef.current || typeof navigator === "undefined" || !navigator.onLine) return;
    flushingRef.current = true;
    try {
      while (true) {
        const op = queueRef.current.find((candidate) => !candidate.notBefore || Date.now() >= candidate.notBefore);
        if (!op) break;
        const affectedIds = op.type === "bulk" ? (op.targetIds || []) : [op.targetId];
        setItems((current) => current.map((item) => affectedIds.includes(item.id) ? { ...item, syncState: "syncing" } : item));
        try {
          let response: Response;
          if (op.type === "create") {
            response = await fetch("/api/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item: op.item }) });
          } else if (op.type === "update") {
            response = await fetch("/api/items", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(op.item) });
          } else if (op.type === "delete") {
            response = await fetch("/api/items", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: op.targetId }) });
          } else if (op.type === "pin") {
            response = await fetch("/api/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pin", id: op.targetId, pinned: op.pinned }) });
          } else if (op.type === "use") {
            response = await fetch("/api/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "use", id: op.targetId, useCount: op.useCount, lastUsedAt: op.lastUsedAt }) });
          } else {
            response = await fetch("/api/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "bulk", mode: op.bulkMode, ids: op.targetIds, collection: op.collection }) });
          }
          const data = await readJsonResponse(response);
          if (!response.ok || !data.ok) throw new Error(data.error || "Đồng bộ thất bại.");

          const nextQueue = queueRef.current.filter((x) => x.opId !== op.opId);
          writeQueue(nextQueue);
          if (op.type === "bulk") {
            const returned = Array.isArray(data.items) ? data.items.map(withDefaults) : [];
            const returnedMap = new Map<string, VaultItem>(returned.map((item: VaultItem) => [item.id, item]));
            setItems((current) => current.map((item) => {
              if (!affectedIds.includes(item.id)) return item;
              const newerPending = nextQueue.some((x) => x.targetId === item.id || x.targetIds?.includes(item.id));
              const server = returnedMap.get(item.id);
              return server ? { ...server, syncState: newerPending ? "pending" : "synced" } : { ...item, syncState: newerPending ? "pending" : "synced" };
            }));
          } else {
            const stillPending = nextQueue.some((x) => x.targetId === op.targetId || x.targetIds?.includes(op.targetId));
            if ((op.type === "create" || op.type === "update") && data.item) {
              setItems((current) => current.map((item) => {
                if (item.id !== op.targetId) return item;
                const serverItem = withDefaults(data.item);
                return stillPending
                  ? { ...serverItem, pinned: item.pinned, useCount: item.useCount, lastUsedAt: item.lastUsedAt, collection: item.collection, archived: item.archived, syncState: "pending" }
                  : { ...serverItem, syncState: "synced" };
              }));
            } else if (op.type === "delete" && data.item) {
              setItems((current) => current.map((item) => item.id === op.targetId ? { ...withDefaults(data.item), syncState: stillPending ? "pending" : "synced" } : item));
            } else {
              setItems((current) => current.map((item) => item.id === op.targetId ? { ...item, syncState: stillPending ? "pending" : "synced" } : item));
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Không đồng bộ được dữ liệu.";
          const failedQueue = queueRef.current.map((x) => x.opId === op.opId ? { ...x, error: message } : x);
          writeQueue(failedQueue);
          setItems((current) => current.map((item) => affectedIds.includes(item.id) ? { ...item, syncState: "error" } : item));
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, []);

  function enqueue(op: QueueOperation) {
    writeQueue([...queueRef.current, op]);
    void flushQueue();
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SECURITY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SecurityConfig;
        if (parsed?.enabled && parsed.salt && parsed.hash) {
          const normalized: SecurityConfig = { ...parsed, autoLockMinutes: Math.max(1, Number(parsed.autoLockMinutes || 5)) };
          setSecurityConfig(normalized);
          setLocked(true);
        }
      }
    } catch {
      window.localStorage.removeItem(SECURITY_KEY);
    } finally {
      setSecurityReady(true);
    }
  }, []);

  useEffect(() => {
    if (!securityReady || locked || !securityConfig?.enabled) return;
    const timeoutMs = Math.max(1, securityConfig.autoLockMinutes) * 60_000;
    const arm = () => {
      if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
      autoLockTimer.current = window.setTimeout(() => setLocked(true), timeoutMs);
    };
    const activity = () => arm();
    arm();
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    window.addEventListener("touchstart", activity, { passive: true });
    window.addEventListener("scroll", activity, { passive: true });
    window.addEventListener("drivevault-activity", activity);
    return () => {
      if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("touchstart", activity);
      window.removeEventListener("scroll", activity);
      window.removeEventListener("drivevault-activity", activity);
    };
  }, [securityReady, locked, securityConfig]);

  useEffect(() => {
    queueRef.current = readQueue();
    setPendingCount(queueRef.current.length);
    const cached = readLocalItems();
    if (cached.length) {
      setItems(applyQueueToItems(cached, queueRef.current));
      setLoading(false);
    }
    // V2.0 cache-first: migrate nguyên cache/queue V1.7 để mở app gần như tức thì.
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queueRef.current));
    if (cached.length) window.localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
    setOnline(navigator.onLine);
    setStorageReady(true);
    window.localStorage.removeItem(LEGACY_CACHE_KEY);
    window.localStorage.removeItem(LEGACY_QUEUE_KEY);
    void flushQueue().then(() => loadItems(Boolean(cached.length)));
  }, [flushQueue, loadItems]);

  useEffect(() => {
    itemsRef.current = items;
    if (!storageReady) return;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  }, [items, storageReady]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); notify("Đã có mạng · đang đồng bộ"); void flushQueue().then(() => loadItems(true)); };
    const onOffline = () => { setOnline(false); notify("Đang offline · dữ liệu sẽ được xếp hàng"); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [flushQueue, loadItems]);

  useEffect(() => {
    const saved = window.localStorage.getItem("drivevault-theme") as "light" | "dark" | null;
    const preferred = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
    setTheme(saved || preferred);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("drivevault-theme", theme);
  }, [theme]);

  useEffect(() => {
    try {
      const loadedRules = readSmartRules();
      setSmartRules(loadedRules);
      if (!window.localStorage.getItem(SMART_RULES_KEY)) window.localStorage.setItem(SMART_RULES_KEY, JSON.stringify(loadedRules));
      const savedTemplates = JSON.parse(window.localStorage.getItem(QUICK_TEMPLATES_KEY) || "[]");
      if (Array.isArray(savedTemplates)) setTemplates(savedTemplates.slice(0, 20));
      const savedHome = JSON.parse(window.localStorage.getItem(HOME_CONFIG_KEY) || "null") as Partial<HomeConfig> | null;
      if (savedHome) setHomeConfig({
        ...defaultHomeConfig,
        ...savedHome,
        favoriteCollections: Array.isArray(savedHome.favoriteCollections) ? savedHome.favoriteCollections.map(String).slice(0, 8) : [],
        density: savedHome.density === "compact" ? "compact" : "comfortable",
      });
    } catch {}

    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);

    const params = new URLSearchParams(window.location.search);
    const shouldQuickOpen = params.get("quick") === "1" || params.has("shareTitle") || params.has("shareText") || params.has("shareUrl");
    if (shouldQuickOpen) {
      const prefs = readQuickPrefs();
      const sharedText = params.get("shareText") || "";
      const sharedUrl = normalizeUrl(params.get("shareUrl") || extractFirstUrl(sharedText));
      const suggestion = inferQuickCapture(sharedUrl);
      const detail = sharedUrl ? sharedText.replace(sharedUrl, "").trim() : sharedText.trim();
      const incomingTags = sharedUrl ? suggestion.tags : prefs.tags;
      setEditingId(null);
      setForm({
        ...emptyForm,
        type: sharedUrl ? suggestion.type : prefs.type,
        name: (params.get("shareTitle") || detail.slice(0, 80) || (sharedUrl ? suggestion.label : "")).trim(),
        detail,
        url: sharedUrl,
        tags: incomingTags,
        collection: sharedUrl ? suggestion.collection : prefs.collection,
      });
      setTagText(incomingTags.join(", "));
      setShowForm(true);
      window.history.replaceState({}, "", window.location.pathname);
    }

    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(() => {
    setDuplicateCandidate(null);
    setDuplicateOverride(false);
  }, [form.name, form.detail, form.url]);


  useEffect(() => { setMediaKindCache(readMediaKindCache()); }, []);

  useEffect(() => {
    if (typeFilter !== "media") return;
    const unresolved = items.filter((item) => item.type === "media" && !item.deleted && inferMediaKind(item) === "unknown" && analyzeLink(item.url).kind === "drive-file" && !mediaKindCache[item.id]);
    if (!unresolved.length) return;
    let cancelled = false;
    const run = async () => {
      const next: Record<string, MediaKind> = {};
      for (const item of unresolved.slice(0, 24)) {
        const intel = analyzeLink(item.url);
        if (!intel.fileId) continue;
        try {
          const response = await fetch(`/api/media?fileId=${encodeURIComponent(intel.fileId)}&meta=1`, { cache: "no-store" });
          if (!response.ok) continue;
          const data = await response.json() as { kind?: MediaKind };
          if (data.kind === "image" || data.kind === "video") next[item.id] = data.kind;
        } catch {}
      }
      if (!cancelled && Object.keys(next).length) setMediaKindCache((current) => { const merged = { ...current, ...next }; writeMediaKindCache(merged); return merged; });
    };
    void run();
    return () => { cancelled = true; };
  }, [typeFilter, items, mediaKindCache]);

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 180);
      setSearchStickyActive(window.scrollY > 28);
      setFloatingActive(true);
      if (scrollIdleTimer.current) clearTimeout(scrollIdleTimer.current);
      scrollIdleTimer.current = window.setTimeout(() => setFloatingActive(false), 500);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (scrollIdleTimer.current) clearTimeout(scrollIdleTimer.current); };
  }, []);

  useEffect(() => {
    if (!showForm && !selected && !showDataTools && !advancedOpen && !showSecurity && !showRules && !protectedTargetId && !mediaGalleryId) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width, overflow: body.style.overflow };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => { Object.assign(body.style, previous); window.scrollTo(0, scrollY); };
  }, [showForm, selected, showDataTools, advancedOpen, showSecurity, showRules, protectedTargetId, mediaGalleryId]);

  const liveItems = useMemo(() => items.filter((item) => !item.deleted), [items]);
  const allTags = useMemo(() => Array.from(new Set(liveItems.flatMap((item) => item.tags))).sort((a, b) => a.localeCompare(b, "vi")), [liveItems]);
  const collections = useMemo(() => {
    const values = new Set<string>();
    classifications.forEach((name) => { if (name.trim()) values.add(name.trim()); });
    liveItems.forEach((item) => {
      const name = normalizeCollection(item.collection);
      if (name && name !== "Chưa phân loại") values.add(name);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, "vi"));
  }, [liveItems, classifications]);
  const duplicateCount = useMemo(() => {
    const seen = new Set<string>();
    let duplicates = 0;
    for (const item of items.filter((x) => !x.deleted)) {
      const key = normalizedDuplicateKey(item);
      if (seen.has(key)) duplicates += 1; else seen.add(key);
    }
    return duplicates;
  }, [items]);
  const suspiciousLinks = useMemo(() => items.filter((item) => !item.deleted && isSuspiciousDriveLink(item)), [items]);
  const trashCount = useMemo(() => items.filter((item) => item.deleted).length, [items]);

  const filtered = useMemo(() => {
    const terms = parseSearchTerms(search);
    const result = items.filter((item) => {
      if (libraryMode === "trash") {
        if (!item.deleted) return false;
      } else {
        if (item.deleted) return false;
        if (libraryMode === "archive") {
          if (!item.archived) return false;
        } else if (item.archived) return false;
      }
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (libraryMode === "pinned" && !item.pinned) return false;
      if (selectedTag !== "all" && !item.tags.includes(selectedTag)) return false;
      if (selectedCollection !== "all" && item.collection !== selectedCollection) return false;
      if (linkFilter === "with" && !item.url) return false;
      if (linkFilter === "without" && item.url) return false;
      if (dateFrom) {
        const from = new Date(`${dateFrom}T00:00:00`).getTime();
        if (new Date(item.createdAt).getTime() < from) return false;
      }
      if (dateTo) {
        const to = new Date(`${dateTo}T23:59:59.999`).getTime();
        if (new Date(item.createdAt).getTime() > to) return false;
      }
      if (!terms.length) return true;
      const segments: string[] = [];
      if (searchFields.name) segments.push(item.name);
      if (searchFields.detail) segments.push(item.detail);
      if (searchFields.url) segments.push(item.url);
      if (searchFields.tags) segments.push(item.tags.join(" "));
      if (searchFields.collection) segments.push(item.collection);
      const blob = segments.join(" ").toLowerCase();
      return terms.every((term) => blob.includes(term));
    });

    return result.sort((a, b) => {
      const sort = sortMode === "smart"
        ? (libraryMode === "recent" ? "recent" : libraryMode === "frequent" ? "frequent" : "smart")
        : sortMode;
      if (sort === "recent") return String(b.lastUsedAt || b.createdAt).localeCompare(String(a.lastUsedAt || a.createdAt));
      if (sort === "frequent") return (b.useCount - a.useCount) || String(b.lastUsedAt || b.createdAt).localeCompare(String(a.lastUsedAt || a.createdAt));
      if (sort === "oldest") return String(a.createdAt).localeCompare(String(b.createdAt));
      if (sort === "name-az") return a.name.localeCompare(b.name, "vi", { sensitivity: "base" });
      if (sort === "name-za") return b.name.localeCompare(a.name, "vi", { sensitivity: "base" });
      if (sort === "newest") return String(b.createdAt).localeCompare(String(a.createdAt));
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }, [items, typeFilter, libraryMode, selectedTag, selectedCollection, search, sortMode, dateFrom, dateTo, linkFilter, searchFields]);

  const visibleItems = useMemo(() => {
    if (typeFilter !== "media" || mediaKindFilter === "all") return filtered;
    return filtered.filter((item) => (mediaKindCache[item.id] || inferMediaKind(item)) === mediaKindFilter);
  }, [filtered, mediaKindCache, mediaKindFilter, typeFilter]);
  const mediaGalleryItems = useMemo(() => visibleItems.filter((item) => item.type === "media" && !item.deleted && !item.archived && !item.protected), [visibleItems]);

  function handleSmartUrlChange(value: string) {
    const normalized = normalizeUrl(value);
    const suggestion = inferQuickCapture(normalized);
    const prefs = readQuickPrefs();
    let smartTags: string[] = [];
    setForm((current) => {
      let next: CreateVaultItem = { ...current, url: value, thumbnail: value === current.url ? current.thumbnail : "" };
      if (!editingId && normalized) {
        next.type = suggestion.type;
        const collectionUntouched = !current.collection || current.collection === "Chưa phân loại" || normalizeCollection(current.collection) === prefs.collection;
        if (collectionUntouched) next.collection = suggestion.collection;
      }
      const applied = applySmartRulesToDraft(next, smartRules, Boolean(securityConfig?.enabled));
      smartTags = normalizeTags(applied.draft.tags || []);
      return applied.draft;
    });
    if (!editingId && normalized) {
      const currentTags = normalizeTags(tagText);
      const remembered = normalizeTags(prefs.tags);
      const tagsUntouched = currentTags.join("|").toLowerCase() === remembered.join("|").toLowerCase();
      const ruleTags = smartRules.filter((rule) => smartRuleMatches(rule, { name: form.name, detail: form.detail, url: value })).flatMap((rule) => rule.tags);
      if (tagsUntouched || currentTags.length === 0 || ruleTags.length) {
        setTagText(normalizeTags([...currentTags, ...suggestion.tags, ...smartTags, ...ruleTags]).join(", "));
      }
    }
  }

  function openCreate() {
    const prefs = readQuickPrefs();
    const collection = selectedCollection !== "all" ? selectedCollection : prefs.collection;
    setEditingId(null);
    setForm({ ...emptyForm, type: prefs.type, collection, tags: prefs.tags });
    setTagText(prefs.tags.join(", "));
    setDuplicateCandidate(null);
    setDuplicateOverride(false);
    setError("");
    setShowForm(true);
  }

  function openEdit(item: VaultItem) {
    setEditingId(item.id);
    setForm({ type: item.type, name: item.name, detail: item.detail, url: item.url, tags: item.tags, pinned: item.pinned, collection: item.collection, archived: item.archived, thumbnail: item.thumbnail, protected: item.protected });
    setTagText(item.tags.join(", "));
    setSelectedId(null);
    setDuplicateCandidate(null);
    setDuplicateOverride(false);
    setError("");
    setShowForm(true);
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const detail = form.detail?.trim() || "";
    const url = normalizeUrl(form.url || "");
    const tags = normalizeTags(tagText);
    const collection = normalizeCollection(form.collection);
    if (!name) return setError("Vui lòng nhập tên.");

    const baseDraft: CreateVaultItem = {
      ...form, name, detail, url, tags, collection,
      pinned: Boolean(form.pinned),
      archived: Boolean(form.archived),
      protected: Boolean(form.protected && securityConfig?.enabled),
    };
    const applied = applySmartRulesToDraft(baseDraft, smartRules, Boolean(securityConfig?.enabled));
    const prepared = applied.draft;
    const preparedTags = normalizeTags(prepared.tags || []);
    const preparedCollection = normalizeCollection(prepared.collection);

    if (prepared.type === "media" && !url) return setError("Ảnh / Video cần link hợp lệ.");
    if (prepared.type === "content" && !detail) return setError("Vui lòng nhập nội dung chi tiết.");
    if (prepared.type === "other" && !detail && !url) return setError("Loại Khác cần ít nhất nội dung hoặc đường link.");

    const duplicateDraft = withDefaults({
      id: editingId || "draft", type: prepared.type, name, detail, url, tags: preparedTags, collection: preparedCollection,
      pinned: Boolean(prepared.pinned), archived: Boolean(prepared.archived), deleted: false, deletedAt: "", useCount: 0, lastUsedAt: "",
      thumbnail: String(prepared.thumbnail || ""), protected: Boolean(prepared.protected && securityConfig?.enabled), createdAt: new Date().toISOString(),
    });
    const duplicate = items.find((item) => item.id !== editingId && !item.deleted && normalizedDuplicateKey(item) === normalizedDuplicateKey(duplicateDraft));
    if (duplicate && !duplicateOverride) {
      setDuplicateCandidate(duplicate);
      setError("");
      return;
    }

    setError("");
    const now = new Date().toISOString();
    if (!editingId) {
      const optimisticItem: VaultItem = {
        id: createClientId(), type: prepared.type, name, detail, url, tags: preparedTags, collection: preparedCollection,
        pinned: Boolean(prepared.pinned), archived: Boolean(prepared.archived), deleted: false, deletedAt: "", useCount: 0, lastUsedAt: "",
        thumbnail: prepared.type === "media" ? String(prepared.thumbnail || "") : "",
        protected: Boolean(prepared.protected && securityConfig?.enabled),
        createdAt: now, updatedAt: now, syncState: "pending",
      };
      setItems((current) => [optimisticItem, ...current]);
      try { window.localStorage.setItem(QUICK_PREFS_KEY, JSON.stringify({ type: optimisticItem.type, collection: optimisticItem.collection, tags: optimisticItem.tags } satisfies QuickPrefs)); } catch {}
      setForm(emptyForm); setTagText(""); setDuplicateCandidate(null); setDuplicateOverride(false); setShowForm(false);
      enqueue({ opId: createClientId(), type: "create", targetId: optimisticItem.id, item: optimisticItem });
      notify(applied.matched.length ? `Đã thêm · áp dụng ${applied.matched.length} Smart Rule` : (online ? "Đã thêm · đang đồng bộ" : "Đã lưu offline · chờ đồng bộ"));
      return;
    }

    const current = items.find((item) => item.id === editingId);
    if (!current) return setError("Không tìm thấy dữ liệu cần sửa.");
    const updated: VaultItem = {
      ...current, type: prepared.type, name, detail, url, tags: preparedTags, collection: preparedCollection,
      pinned: Boolean(prepared.pinned ?? current.pinned), archived: Boolean(prepared.archived ?? current.archived),
      thumbnail: prepared.type === "media" ? String(prepared.thumbnail || "") : "",
      protected: Boolean(prepared.protected && securityConfig?.enabled), updatedAt: now, syncState: "pending",
    };
    setSaving(true);
    setItems((list) => list.map((item) => item.id === editingId ? updated : item));
    setForm(emptyForm); setTagText(""); setDuplicateCandidate(null); setDuplicateOverride(false); setEditingId(null); setShowForm(false);
    enqueue({ opId: createClientId(), type: "update", targetId: updated.id, item: updated });
    setSaving(false);
    notify(applied.matched.length ? `Đã cập nhật · áp dụng ${applied.matched.length} Smart Rule` : (online ? "Đã cập nhật · đang đồng bộ" : "Đã cập nhật offline"));
  }

  function togglePin(item: VaultItem) {
    const latest = itemsRef.current.find((x) => x.id === item.id) || item;
    const pinned = !latest.pinned;
    setItems((current) => current.map((x) => x.id === item.id ? { ...x, pinned, syncState: "pending" } : x));
    enqueue({ opId: createClientId(), type: "pin", targetId: item.id, pinned });
    notify(pinned ? "Đã ghim lên đầu" : "Đã bỏ ghim");
  }

  function recordUsage(item: VaultItem) {
    const latest = itemsRef.current.find((x) => x.id === item.id) || item;
    const now = new Date().toISOString();
    const useCount = latest.useCount + 1;
    setItems((current) => current.map((x) => x.id === item.id ? { ...x, useCount, lastUsedAt: now, syncState: "pending" } : x));
    enqueue({ opId: createClientId(), type: "use", targetId: item.id, useCount, lastUsedAt: now });
  }

  async function copyItem(item: VaultItem) {
    if (!item.detail) return;
    await navigator.clipboard.writeText(item.detail);
    recordUsage(item);
    notify("Đã sao chép nội dung");
  }

  function deleteItem(item: VaultItem) {
    const previousOps = queueRef.current.filter((op) => op.targetId === item.id || op.targetIds?.includes(item.id));
    const keepOther = queueRef.current.filter((op) => op.targetId !== item.id && !op.targetIds?.includes(item.id));
    const now = new Date().toISOString();
    const deleteOp: QueueOperation = { opId: createClientId(), type: "delete", targetId: item.id, notBefore: Date.now() + DELETE_UNDO_MS };
    writeQueue([...keepOther, deleteOp]);
    setItems((current) => current.map((x) => x.id === item.id ? { ...x, deleted: true, deletedAt: now, archived: false, syncState: "pending" } : x));
    if (selectedId === item.id) setSelectedId(null);
    setUndoDelete({ item, previousOps });
    window.setTimeout(() => { setUndoDelete((current) => current?.item.id === item.id ? null : current); void flushQueue(); }, DELETE_UNDO_MS + 120);
  }

  function undoDeleteItem() {
    if (!undoDelete) return;
    const targetId = undoDelete.item.id;
    const withoutDelete = queueRef.current.filter((op) => !(op.targetId === targetId && op.type === "delete"));
    writeQueue([...withoutDelete, ...undoDelete.previousOps]);
    setItems((current) => current.map((x) => x.id === targetId ? { ...undoDelete.item, deleted: false, deletedAt: "", syncState: undoDelete.previousOps.length ? "pending" : "synced" } : x));
    setUndoDelete(null);
    notify("Đã hoàn tác · mục đã trở lại thư viện");
    void flushQueue();
  }

  function restoreTrashItem(item: VaultItem) {
    applyBulkAction("restoreTrash", [item.id]);
    setSelectedId(null);
  }

  function purgeItem(item: VaultItem) {
    if (!window.confirm(`Xóa vĩnh viễn “${item.name}”? Thao tác này không thể hoàn tác.`)) return;
    applyBulkAction("purge", [item.id]);
    setSelectedId(null);
  }

  function archiveItem(item: VaultItem) {
    applyBulkAction(item.archived ? "restore" : "archive", [item.id]);
    setSelectedId(null);
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelection() { setSelectionMode(false); setSelectedIds(new Set()); }

  function applyBulkAction(mode: BulkMode, ids = Array.from(selectedIds), collection = bulkCollection) {
    if (!ids.length) return;
    if (mode === "purge" && !window.confirm(`Xóa vĩnh viễn ${ids.length} mục? Thao tác này không thể hoàn tác.`)) return;
    const normalizedCollection = normalizeCollection(collection);
    if (mode === "purge") {
      setItems((current) => current.filter((item) => !ids.includes(item.id)));
    } else {
      setItems((current) => current.map((item) => {
        if (!ids.includes(item.id)) return item;
        const next = { ...item, syncState: "pending" as SyncState };
        if (mode === "archive") next.archived = true;
        if (mode === "restore") next.archived = false;
        if (mode === "pin") next.pinned = true;
        if (mode === "unpin") next.pinned = false;
        if (mode === "move") next.collection = normalizedCollection;
        if (mode === "delete") { next.deleted = true; next.deletedAt = new Date().toISOString(); next.archived = false; }
        if (mode === "restoreTrash") { next.deleted = false; next.deletedAt = ""; }
        return next;
      }));
    }
    enqueue({ opId: createClientId(), type: "bulk", targetId: `bulk-${Date.now()}`, targetIds: ids, bulkMode: mode, collection: normalizedCollection });
    const labels: Record<BulkMode, string> = { archive: "Đã lưu trữ", restore: "Đã khôi phục", pin: "Đã ghim", unpin: "Đã bỏ ghim", move: `Đã chuyển vào ${normalizedCollection}`, delete: "Đã chuyển vào thùng rác", restoreTrash: "Đã khôi phục từ thùng rác", purge: "Đã xóa vĩnh viễn" };
    notify(`${labels[mode]} ${ids.length} mục`);
    exitSelection();
  }

  async function retrySync() {
    const cleared = queueRef.current.map((op) => ({ ...op, error: undefined }));
    writeQueue(cleared);
    setItems((current) => current.map((item) => cleared.some((op) => op.targetId === item.id || op.targetIds?.includes(item.id)) ? { ...item, syncState: "pending" } : item));
    await flushQueue();
    await loadItems(true);
    notify(queueRef.current.length ? "Vẫn còn mục chờ đồng bộ" : "Đã đồng bộ xong");
  }

  async function loadBackups() {
    if (!online) return;
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || "Không tải được backup.");
      setBackups(Array.isArray(data.backups) ? data.backups : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được lịch sử backup.");
    }
  }

  const loadClassifications = useCallback(async () => {
    try {
      const response = await fetch("/api/classifications", { cache: "no-store" });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || "Không tải được phân loại.");
      setClassifications(Array.isArray(data.classifications) ? data.classifications.map(String) : []);
    } catch (e) {
      if (online) setError(e instanceof Error ? e.message : "Không tải được phân loại.");
    }
  }, [online]);

  async function createClassification() {
    const name = newClassification.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!name) return notify("Nhập tên phân loại trước");
    if (!online) return notify("Cần kết nối mạng để tạo phân loại mới");
    setClassificationBusy(true);
    try {
      const response = await fetch("/api/classifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || "Không tạo được phân loại.");
      const saved = String(data.classification || name);
      setClassifications((current) => Array.from(new Set([...current, saved])).sort((a, b) => a.localeCompare(b, "vi")));
      setSelectedCollection(saved);
      setNewClassification("");
      notify(`Đã tạo phân loại ${saved}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Không tạo được phân loại."); }
    finally { setClassificationBusy(false); }
  }

  useEffect(() => { void loadClassifications(); }, [loadClassifications]);

  function openDataTools() {
    setShowDataTools(true);
    setImportReport(null);
    setError("");
    void loadBackups();
  }

  function exportJson() {
    const payload = {
      app: "DriveVault",
      version: "2.2.0",
      exportedAt: new Date().toISOString(),
      itemCount: items.length,
      items: items.map(exportableItem),
    };
    downloadTextFile(`drivevault-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    notify("Đã xuất JSON");
  }

  function exportCsv() {
    downloadTextFile(`drivevault-export-${new Date().toISOString().slice(0, 10)}.csv`, itemsToCsv(items), "text/csv;charset=utf-8");
    notify("Đã xuất CSV");
  }

  async function createBackupSnapshot() {
    if (!online) return notify("Cần kết nối mạng để tạo snapshot");
    if (pendingCount) return notify("Hãy đồng bộ hết thao tác đang chờ trước khi backup");
    setDataBusy(true);
    try {
      const response = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "backup", note: backupNote.trim() }) });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || "Không tạo được backup.");
      setBackupNote("");
      await loadBackups();
      notify("Đã tạo Backup Snapshot");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được backup.");
    } finally { setDataBusy(false); }
  }

  async function restoreSnapshot(snapshot: BackupSnapshot) {
    if (!online) return notify("Cần kết nối mạng để restore");
    if (pendingCount) return notify("Hãy đồng bộ hết thao tác đang chờ trước khi restore");
    if (!window.confirm(`Khôi phục snapshot ${formatDate(snapshot.createdAt)} (${snapshot.itemCount} mục)? Hệ thống sẽ tự backup dữ liệu hiện tại trước khi restore.`)) return;
    setDataBusy(true);
    try {
      const response = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "restoreBackup", backupId: snapshot.id }) });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || "Restore thất bại.");
      writeQueue([]);
      await loadItems(true);
      await loadBackups();
      notify(`Đã restore ${Number(data.report?.restored || snapshot.itemCount)} mục`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore thất bại.");
    } finally { setDataBusy(false); }
  }

  async function removeSnapshot(snapshot: BackupSnapshot) {
    if (!online) return notify("Cần kết nối mạng");
    if (!window.confirm("Xóa snapshot backup này?")) return;
    setDataBusy(true);
    try {
      const response = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "deleteBackup", backupId: snapshot.id }) });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || "Không xóa được snapshot.");
      await loadBackups();
      notify("Đã xóa snapshot");
    } catch (e) { setError(e instanceof Error ? e.message : "Không xóa được snapshot."); }
    finally { setDataBusy(false); }
  }

  async function handleImportFile(file?: File) {
    if (!file) return;
    setImportReport(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rawItems = Array.isArray(parsed) ? parsed : parsed?.items;
      if (!Array.isArray(rawItems)) throw new Error("File JSON không có mảng items hợp lệ.");
      const valid = rawItems
        .filter((item: any) => {
          if (!item || !["media", "content", "other"].includes(String(item.type || "")) || !String(item.name || "").trim()) return false;
          if (item.type === "media" && !normalizeUrl(String(item.url || ""))) return false;
          if (item.type === "content" && !String(item.detail || "").trim()) return false;
          if (item.type === "other" && !String(item.detail || "").trim() && !normalizeUrl(String(item.url || ""))) return false;
          return true;
        })
        .map((item: any) => withDefaults({ ...item, url: item.url ? normalizeUrl(String(item.url)) : "", syncState: "synced" }));
      if (!valid.length) throw new Error("Không tìm thấy bản ghi DriveVault hợp lệ trong file.");
      setImportItems(valid);
      setImportFileName(file.name);
      notify(`Đã đọc ${valid.length} mục từ file`);
    } catch (e) {
      setImportItems([]);
      setImportFileName("");
      setError(e instanceof Error ? e.message : "Không đọc được file import.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function executeImport() {
    if (!importItems.length) return;
    if (!online) return notify("Cần kết nối mạng để import");
    if (pendingCount) return notify("Hãy đồng bộ hết thao tác đang chờ trước khi import");
    if (importMode === "replace" && !window.confirm("Replace sẽ thay toàn bộ dữ liệu hiện tại bằng file import. Hệ thống sẽ tạo backup tự động trước khi thay thế. Tiếp tục?")) return;
    setDataBusy(true);
    setImportReport(null);
    try {
      const response = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "import", mode: importMode, items: importItems.map(exportableItem) }) });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || "Import thất bại.");
      setImportReport(data.report || null);
      writeQueue([]);
      await loadItems(true);
      await loadBackups();
      notify("Import hoàn tất");
    } catch (e) { setError(e instanceof Error ? e.message : "Import thất bại."); }
    finally { setDataBusy(false); }
  }

  async function emptyTrash() {
    if (!trashCount) return;
    if (!online) return notify("Cần kết nối mạng để xóa vĩnh viễn");
    if (pendingCount) return notify("Hãy đồng bộ hết thao tác đang chờ trước");
    if (!window.confirm(`Xóa vĩnh viễn toàn bộ ${trashCount} mục trong Thùng rác? Thao tác này không thể hoàn tác.`)) return;
    setDataBusy(true);
    try {
      const response = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "emptyTrash" }) });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || "Không dọn được thùng rác.");
      setItems((current) => current.filter((item) => !item.deleted));
      notify(`Đã xóa vĩnh viễn ${Number(data.removed || trashCount)} mục`);
    } catch (e) { setError(e instanceof Error ? e.message : "Không dọn được thùng rác."); }
    finally { setDataBusy(false); }
  }

  const importDuplicateCount = useMemo(() => {
    if (!importItems.length) return 0;
    const existingIds = new Set(items.map((item) => item.id));
    const existingKeys = new Set(items.map(normalizedDuplicateKey));
    let count = 0;
    for (const item of importItems) if (existingIds.has(item.id) || existingKeys.has(normalizedDuplicateKey(item))) count += 1;
    return count;
  }, [importItems, items]);

  function resetAdvanced() {
    setDateFrom(""); setDateTo(""); setLinkFilter("all");
    setSearchFields({ name: true, detail: true, url: true, tags: true, collection: true });
    setLibraryMode("all"); setSortMode("smart"); setSelectedTag("all"); setSelectedCollection("all");
  }

  function resetDashboard() {
    setSearch(""); setTypeFilter("all"); setMediaKindFilter("all"); setMediaViewMode("grid"); setMediaGalleryId(null); setLibraryMode("all"); setSelectedTag("all"); setSelectedCollection("all");
    setSortMode("smart"); setDateFrom(""); setDateTo(""); setLinkFilter("all");
    setSearchFields({ name: true, detail: true, url: true, tags: true, collection: true });
    setAdvancedOpen(false); exitSelection();
    window.scrollTo({ top: 0, behavior: "smooth" });
    void flushQueue().then(() => loadItems(true));
  }

  async function submitUnlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlockError("");
    if (!(await unlockWithPin(unlockPin))) {
      setUnlockError("PIN không đúng.");
      return;
    }
    setUnlockPin("");
  }

  function openSecuritySettings() {
    setSecurityOldPin("");
    setSecurityPin("");
    setSecurityPinConfirm("");
    setSecurityError("");
    setShowPin(false);
    setShowSecurity(true);
  }

  const activeFilterCount = [
    libraryMode !== "all", sortMode !== "smart", selectedTag !== "all", selectedCollection !== "all",
    Boolean(dateFrom), Boolean(dateTo), linkFilter !== "all", selectionMode,
    Object.values(searchFields).some((value) => !value), typeFilter === "media" && mediaKindFilter !== "all",
  ].filter(Boolean).length;

  const homeReady = !search.trim() && typeFilter === "all" && mediaKindFilter === "all" && libraryMode === "all" && selectedTag === "all" && selectedCollection === "all" && !dateFrom && !dateTo && linkFilter === "all" && !selectionMode;
  const homeSource = liveItems.filter((item) => !item.archived);
  const homePinned = homeSource.filter((item) => item.pinned).slice(0, 6);
  const homeRecent = [...homeSource].filter((item) => item.lastUsedAt).sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt))).slice(0, 6);
  const homeFrequent = [...homeSource].filter((item) => item.useCount > 0).sort((a, b) => b.useCount - a.useCount).slice(0, 6);
  const favoriteCollectionStats = homeConfig.favoriteCollections.map((name) => ({ name, count: homeSource.filter((item) => item.collection === name).length })).filter((entry) => entry.count > 0);

  const visibleSelectedCount = visibleItems.filter((item) => selectedIds.has(item.id)).length;
  const allVisibleSelected = visibleItems.length > 0 && visibleSelectedCount === visibleItems.length;

  if (!securityReady) {
    return <main className="lock-shell"><div className="lock-card"><div className="lock-logo app-lock-logo"><img src="/icons/icon-192.png" alt="" /></div><strong>DriveVault</strong><span>Đang khởi tạo bảo mật...</span></div></main>;
  }

  if (locked && securityConfig?.enabled) {
    return <main className="lock-shell">
      <section className="lock-card">
        <div className="lock-logo app-lock-logo"><img src="/icons/icon-192.png" alt="" /></div>
        <div className="eyebrow">DRIVEVAULT · V2.2.0</div>
        <h1>Ứng dụng đã khóa</h1>
        <p>Nhập PIN để mở kho dữ liệu trên thiết bị này.</p>
        <form className="unlock-form" onSubmit={submitUnlock}>
          <div className="pin-input-wrap"><KeyRound size={18}/><input autoFocus inputMode="numeric" pattern="[0-9]*" maxLength={8} type={showPin ? "text" : "password"} value={unlockPin} onChange={(e) => setUnlockPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN 4–8 số"/><button type="button" onClick={() => setShowPin((v) => !v)}>{showPin ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
          {unlockError && <div className="security-error">{unlockError}</div>}
          <button className="save" type="submit"><Unlock size={18}/> Mở khóa</button>
        </form>
        <small>PIN chỉ dùng cho App Lock trên thiết bị hiện tại.</small>
      </section>
    </main>;
  }

  return (
    <main className={`shell density-${homeConfig.density}`}>
      <header className="topbar compact-topbar">
        <button className="brand-button" onClick={resetDashboard} aria-label="DriveVault · làm mới và xóa bộ lọc">
          <span className="brand-mark brand-logo"><img src="/icons/icon-192.png" alt="" /></span>
          <span className="brand-copy">
            <span className="eyebrow">DRIVEVAULT · V2.2.0</span>
            <strong>Smart Rules & Automation</strong>
            <small>Automation · media player · fullscreen · quick capture</small>
          </span>
        </button>
        <div className="top-actions">
          <button className={`icon-button ${smartRules.some((rule) => rule.enabled) ? "automation-on" : ""}`} aria-label="Smart Rules & Automation" onClick={() => setShowRules(true)}><Zap size={19}/></button>
          <button className={`icon-button ${securityConfig?.enabled ? "security-on" : ""}`} aria-label="Security & App Lock" onClick={openSecuritySettings}>{securityConfig?.enabled ? <Lock size={19}/> : <ShieldCheck size={19}/>}</button>
          <button className="icon-button" aria-label="Backup & Data Portability" onClick={openDataTools}><Database size={19} /></button>
          <button className="icon-button" aria-label="Đổi giao diện sáng tối" onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button className="icon-button" aria-label="Tải lại và đồng bộ" onClick={resetDashboard} disabled={loading}><RefreshCcw size={19} className={loading ? "spin" : ""} /></button>
        </div>
      </header>

      <div className={`network-strip ${online ? "online" : "offline"}`}>
        {online ? <Cloud size={15} /> : <WifiOff size={15} />}
        <span>{online ? (pendingCount ? `${pendingCount} thao tác đang chờ đồng bộ` : "Đã kết nối · dữ liệu được đồng bộ") : `${pendingCount} thao tác lưu offline`}</span>
        {pendingCount > 0 && online && <button onClick={() => retrySync()}>Đồng bộ ngay</button>}
      </div>

      <div className={`search-sticky-bar ${searchStickyActive ? "is-scrolled" : ""}`}>
        <div className="search-row">
          <label className="searchbox"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Tìm kiếm... dùng "cụm từ" để khớp chính xác' /></label>
          <button className={`filter-toggle ${activeFilterCount ? "active" : ""}`} onClick={() => setAdvancedOpen(true)} aria-label="Mở bộ lọc">
            <SlidersHorizontal size={18} />
            {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
          </button>
        </div>
      </div>

      <section className="toolbar compact-toolbar toolbar-static">
        <div className="chips storage-type-chips" role="tablist" aria-label="Lọc loại lưu trữ">
          {(["all", "media", "content", "other"] as const).map((key) => <button key={key} className={`chip ${typeFilter === key ? "active" : ""}`} onClick={() => { setTypeFilter(key); if (key !== "media") setMediaKindFilter("all"); }}>{key === "all" ? "Tất cả loại" : typeMeta[key].label}</button>)}
        </div>
        {typeFilter === "media" && <div className="media-pro-toolbar">
          <div className="media-kind-tabs" aria-label="Lọc thư viện media">
            {([['all','Tất cả'],['image','Ảnh'],['video','Video']] as [MediaKindFilter,string][]).map(([key,label]) => <button key={key} className={mediaKindFilter === key ? "active" : ""} onClick={() => setMediaKindFilter(key)}>{label}</button>)}
          </div>
          <div className="media-view-switch" aria-label="Kiểu hiển thị media">
            <button className={mediaViewMode === "grid" ? "active" : ""} onClick={() => setMediaViewMode("grid")} aria-label="Dạng gallery"><Grid3X3 size={16}/></button>
            <button className={mediaViewMode === "list" ? "active" : ""} onClick={() => setMediaViewMode("list")} aria-label="Dạng danh sách"><List size={16}/></button>
          </div>
        </div>}
      </section>

      {homeReady && (homePinned.length > 0 || homeRecent.length > 0 || homeFrequent.length > 0 || favoriteCollectionStats.length > 0) && (
        <section className="personal-home" aria-label="Personal dashboard">
          {favoriteCollectionStats.length > 0 && <div className="home-lane favorite-lane">
            <div className="home-lane-head"><div><span className="eyebrow">PHÂN LOẠI YÊU THÍCH</span><strong>Truy cập nhanh</strong></div></div>
            <div className="favorite-collection-row">{favoriteCollectionStats.map((entry) => <button key={entry.name} onClick={() => setSelectedCollection(entry.name)}><Folder size={14}/><span>{entry.name}</span><small>{entry.count}</small></button>)}</div>
          </div>}

          {homeConfig.showPinned && homePinned.length > 0 && <div className="home-lane">
            <div className="home-lane-head"><div><span className="eyebrow">ĐÃ GHIM</span><strong>Dùng ngay</strong></div><button onClick={() => { setLibraryMode("pinned"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Xem tất cả</button></div>
            <div className="quick-item-row">{homePinned.map((item) => <button className="quick-item" key={item.id} onClick={() => openItem(item)}><span className={`quick-type ${typeMeta[item.type].className}`}>{typeMeta[item.type].label}</span><strong>{item.name}</strong><small>{item.collection}</small></button>)}</div>
          </div>}

          {homeConfig.showRecent && homeRecent.length > 0 && <div className="home-lane">
            <div className="home-lane-head"><div><span className="eyebrow">GẦN ĐÂY</span><strong>Vừa sử dụng</strong></div><button onClick={() => { setLibraryMode("recent"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Xem tất cả</button></div>
            <div className="quick-item-row">{homeRecent.map((item) => <button className="quick-item" key={item.id} onClick={() => openItem(item)}><span className={`quick-type ${typeMeta[item.type].className}`}>{typeMeta[item.type].label}</span><strong>{item.name}</strong><small>{formatRelative(item.lastUsedAt)}</small></button>)}</div>
          </div>}

          {homeConfig.showFrequent && homeFrequent.length > 0 && <div className="home-lane">
            <div className="home-lane-head"><div><span className="eyebrow">DÙNG NHIỀU</span><strong>Truy cập thường xuyên</strong></div><button onClick={() => { setLibraryMode("frequent"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Xem tất cả</button></div>
            <div className="quick-item-row">{homeFrequent.map((item) => <button className="quick-item" key={item.id} onClick={() => openItem(item)}><span className={`quick-type ${typeMeta[item.type].className}`}>{typeMeta[item.type].label}</span><strong>{item.name}</strong><small>Đã dùng {item.useCount} lần</small></button>)}</div>
          </div>}
        </section>
      )}

      {advancedOpen && (
        <div className="modal-backdrop filter-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setAdvancedOpen(false); }}>
          <section className="modal filter-sheet" role="dialog" aria-modal="true" aria-labelledby="filter-title">
            <div className="sheet-handle" />
            <div className="modal-head">
              <div><div className="eyebrow">SEARCH & ORGANIZATION</div><h2 id="filter-title">Bộ lọc</h2></div>
              <button className="icon-button" onClick={() => setAdvancedOpen(false)}><X size={20}/></button>
            </div>

            <div className="filter-content">
              <section className="filter-section">
                <div className="filter-section-title"><strong>Trạng thái thư viện</strong><span>Chọn vùng dữ liệu muốn xem</span></div>
                <div className="filter-option-grid">
                  {([['all','Tất cả'],['pinned','Đã ghim'],['recent','Gần đây'],['frequent','Dùng nhiều'],['archive','Lưu trữ'],['trash','Thùng rác']] as [LibraryMode,string][]).map(([key,label]) => <button key={key} className={libraryMode === key ? "active" : ""} onClick={() => { setLibraryMode(key); setSelectedIds(new Set()); }}>{key === "pinned" && <Star size={14} />}{key === "archive" && <Archive size={14} />}{key === "trash" && <Trash2 size={14} />}{label}</button>)}
                </div>
              </section>

              <section className="filter-section">
                <div className="filter-section-title"><strong>Tổ chức</strong><span>Sắp xếp và thao tác hàng loạt</span></div>
                <div className="organize-row filter-organize-row">
                  <label className="sort-select"><ArrowDownAZ size={16} /><select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}><option value="smart">Sắp xếp thông minh</option><option value="newest">Mới nhất</option><option value="oldest">Cũ nhất</option><option value="name-az">Tên A → Z</option><option value="name-za">Tên Z → A</option><option value="recent">Dùng gần đây</option><option value="frequent">Dùng nhiều nhất</option></select></label>
                  <button className={`selection-toggle ${selectionMode ? "active" : ""}`} onClick={() => selectionMode ? exitSelection() : setSelectionMode(true)}><CheckSquare2 size={16} />{selectionMode ? "Tắt chọn nhiều" : "Chọn nhiều"}</button>
                </div>
              </section>

              <section className="filter-section">
                <div className="filter-section-title"><strong>Phân loại</strong><span>Tạo trước như Shopee, Công việc, Template...</span></div>
                <div className="classification-create">
                  <input maxLength={80} value={newClassification} onChange={(e) => setNewClassification(e.target.value)} placeholder="Tên phân loại mới, VD: Shopee" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createClassification(); } }} />
                  <button onClick={() => void createClassification()} disabled={classificationBusy}>{classificationBusy ? <Loader2 size={15} className="spin"/> : <Plus size={15}/>} Tạo</button>
                </div>
                <div className="filter-chip-wrap">
                  <button className={selectedCollection === "all" ? "active" : ""} onClick={() => setSelectedCollection("all")}><Folder size={13}/> Tất cả phân loại</button>
                  <button className={selectedCollection === "Chưa phân loại" ? "active" : ""} onClick={() => setSelectedCollection("Chưa phân loại")}><Folder size={13}/> Chưa phân loại</button>
                  {collections.map((name) => <button key={name} className={selectedCollection === name ? "active" : ""} onClick={() => setSelectedCollection(name)}><Folder size={13}/>{name}</button>)}
                </div>
              </section>

              <section className="filter-section">
                <div className="filter-section-title"><strong>Tag</strong><span>Lọc nhanh theo nhãn nội dung</span></div>
                <div className="filter-chip-wrap">
                  <button className={selectedTag === "all" ? "active" : ""} onClick={() => setSelectedTag("all")}># Tất cả tag</button>
                  {allTags.map((tag) => <button key={tag} className={selectedTag === tag ? "active" : ""} onClick={() => setSelectedTag(tag)}>#{tag}</button>)}
                </div>
              </section>

              <section className="filter-section personal-dashboard-settings">
                <div className="filter-section-title"><strong>Dashboard cá nhân</strong><span>Tùy biến trang chủ và mật độ hiển thị</span></div>
                <div className="density-switch">
                  <button className={homeConfig.density === "compact" ? "active" : ""} onClick={() => persistHomeConfig({ ...homeConfig, density: "compact" })}><Layers3 size={14}/> Gọn</button>
                  <button className={homeConfig.density === "comfortable" ? "active" : ""} onClick={() => persistHomeConfig({ ...homeConfig, density: "comfortable" })}><FileText size={14}/> Thoải mái</button>
                </div>
                <div className="dashboard-toggle-grid">
                  <label><input type="checkbox" checked={homeConfig.showPinned} onChange={(e) => persistHomeConfig({ ...homeConfig, showPinned: e.target.checked })}/><span><strong>Đã ghim</strong><small>Hiện lane dùng nhanh</small></span></label>
                  <label><input type="checkbox" checked={homeConfig.showRecent} onChange={(e) => persistHomeConfig({ ...homeConfig, showRecent: e.target.checked })}/><span><strong>Gần đây</strong><small>Những mục vừa dùng</small></span></label>
                  <label><input type="checkbox" checked={homeConfig.showFrequent} onChange={(e) => persistHomeConfig({ ...homeConfig, showFrequent: e.target.checked })}/><span><strong>Dùng nhiều</strong><small>Theo số lần sử dụng</small></span></label>
                </div>
                {collections.length > 0 && <div className="favorite-picker"><span>Phân loại yêu thích</span><div className="filter-chip-wrap">{collections.map((name) => <button key={name} className={homeConfig.favoriteCollections.includes(name) ? "active" : ""} onClick={() => toggleFavoriteCollection(name)}><Star size={12}/>{name}</button>)}</div></div>}
                {installPrompt && <button className="install-app-button" onClick={() => void installApp()}><Download size={16}/> Cài DriveVault lên thiết bị</button>}
              </section>

              <section className="filter-section">
                <div className="filter-section-title"><strong>Tìm kiếm nâng cao</strong><span>Giới hạn trường, ngày và loại liên kết</span></div>
                <div className="field-grid">
                  {([['name','Tên'],['detail','Nội dung'],['url','Link'],['tags','Tag'],['collection','Phân loại']] as [SearchField,string][]).map(([key,label]) => (
                    <label key={key} className="check-pill"><input type="checkbox" checked={searchFields[key]} onChange={(e) => setSearchFields((current) => ({ ...current, [key]: e.target.checked }))} />{label}</label>
                  ))}
                </div>
                <div className="advanced-grid">
                  <label>Từ ngày<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
                  <label>Đến ngày<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
                  <label>Liên kết<select value={linkFilter} onChange={(e) => setLinkFilter(e.target.value as LinkFilter)}><option value="all">Tất cả</option><option value="with">Có link</option><option value="without">Không có link</option></select></label>
                </div>
              </section>
            </div>

            <div className="filter-footer">
              <button className="secondary" onClick={resetAdvanced}>Đặt lại</button>
              <button className="primary" onClick={() => setAdvancedOpen(false)}>Áp dụng {activeFilterCount > 0 ? `· ${activeFilterCount} bộ lọc` : ""}</button>
            </div>
          </section>
        </div>
      )}

      {showRules && (
        <div className="modal-backdrop automation-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !runningRules) setShowRules(false); }}>
          <section className="modal automation-sheet" role="dialog" aria-modal="true" aria-labelledby="automation-title">
            <div className="sheet-handle" />
            <div className="modal-head">
              <div><div className="eyebrow">V2.2 · SMART RULES</div><h2 id="automation-title">Tự động hóa</h2></div>
              <button className="icon-button" onClick={() => setShowRules(false)} disabled={runningRules}><X size={20}/></button>
            </div>
            <div className="automation-content">
              <section className="automation-summary">
                <div><Zap size={18}/><span><strong>{smartRules.filter((rule) => rule.enabled).length}</strong><small>rule đang bật</small></span></div>
                <button className="secondary" disabled={runningRules} onClick={() => void runRulesOnExistingData()}>{runningRules ? <Loader2 size={15} className="spin"/> : <RefreshCcw size={15}/>} Chạy trên dữ liệu cũ</button>
              </section>

              <section className="filter-section automation-builder">
                <div className="filter-section-title"><strong>Tạo rule mới</strong><span>Nếu điều kiện khớp → tự gắn loại, phân loại, tag...</span></div>
                <div className="automation-grid">
                  <label>Tên rule<input value={ruleDraft.name} maxLength={80} onChange={(e) => setRuleDraft((r) => ({ ...r, name: e.target.value }))} placeholder="VD: Shopee → Mua sắm"/></label>
                  <label>Kiểm tra<select value={ruleDraft.field} onChange={(e) => setRuleDraft((r) => ({ ...r, field: e.target.value as SmartRuleField }))}><option value="url">URL</option><option value="name">Tên</option><option value="detail">Nội dung</option><option value="any">Tên + Nội dung + URL</option></select></label>
                  <label>Điều kiện<select value={ruleDraft.operator} onChange={(e) => setRuleDraft((r) => ({ ...r, operator: e.target.value as SmartRuleOperator }))}><option value="contains">Chứa</option><option value="startsWith">Bắt đầu bằng</option><option value="endsWith">Kết thúc bằng</option><option value="equals">Bằng chính xác</option></select></label>
                  <label className="automation-value">Giá trị<input value={ruleDraft.value} maxLength={200} onChange={(e) => setRuleDraft((r) => ({ ...r, value: e.target.value }))} placeholder="shopee.vn hoặc SQL"/></label>
                  <label>Đổi loại<select value={ruleDraft.setType || ""} onChange={(e) => setRuleDraft((r) => ({ ...r, setType: e.target.value as StorageType | "" }))}><option value="">Giữ nguyên</option><option value="media">Ảnh / Video</option><option value="content">Nội dung</option><option value="other">Khác</option></select></label>
                  <label>Phân loại<input list="automation-collections" value={ruleDraft.collection || ""} onChange={(e) => setRuleDraft((r) => ({ ...r, collection: e.target.value }))} placeholder="Giữ nguyên"/><datalist id="automation-collections">{collections.map((name) => <option key={name} value={name}/>)}</datalist></label>
                  <label className="automation-tags">Tag<input value={ruleTagText} onChange={(e) => setRuleTagText(e.target.value)} placeholder="video, shopee, SQL"/></label>
                </div>
                <div className="automation-switches">
                  <label><input type="checkbox" checked={Boolean(ruleDraft.pinned)} onChange={(e) => setRuleDraft((r) => ({ ...r, pinned: e.target.checked }))}/><span>Ghim</span></label>
                  <label><input type="checkbox" checked={Boolean(ruleDraft.archived)} onChange={(e) => setRuleDraft((r) => ({ ...r, archived: e.target.checked }))}/><span>Lưu trữ</span></label>
                  <label className={!securityConfig?.enabled ? "disabled" : ""}><input type="checkbox" disabled={!securityConfig?.enabled} checked={Boolean(ruleDraft.protected)} onChange={(e) => setRuleDraft((r) => ({ ...r, protected: e.target.checked }))}/><span>Bảo vệ</span></label>
                </div>
                <button className="primary automation-add" onClick={addSmartRule}><Plus size={16}/> Thêm Smart Rule</button>
              </section>

              <section className="automation-list">
                <div className="filter-section-title"><strong>Rule hiện có</strong><span>Rule chạy theo thứ tự từ trên xuống; nhiều rule có thể cùng áp dụng.</span></div>
                {smartRules.length === 0 ? <div className="automation-empty">Chưa có Smart Rule.</div> : smartRules.map((rule) => (
                  <article className={`automation-rule ${rule.enabled ? "enabled" : ""}`} key={rule.id}>
                    <button className={`automation-toggle ${rule.enabled ? "on" : ""}`} onClick={() => toggleSmartRule(rule.id)} aria-label={rule.enabled ? "Tắt rule" : "Bật rule"}><span/></button>
                    <div className="automation-rule-copy">
                      <strong>{rule.name}</strong>
                      <span>Nếu {rule.field === "url" ? "URL" : rule.field === "name" ? "Tên" : rule.field === "detail" ? "Nội dung" : "bất kỳ trường"} {rule.operator === "contains" ? "chứa" : rule.operator === "startsWith" ? "bắt đầu bằng" : rule.operator === "endsWith" ? "kết thúc bằng" : "bằng"} “{rule.value}”</span>
                      <div>{rule.setType && <small>{typeMeta[rule.setType].label}</small>}{rule.collection && <small>{rule.collection}</small>}{rule.tags.map((tag) => <small key={tag}>#{tag}</small>)}{rule.pinned && <small>Ghim</small>}{rule.archived && <small>Lưu trữ</small>}{rule.protected && <small>Bảo vệ</small>}</div>
                    </div>
                    <button className="automation-delete" onClick={() => removeSmartRule(rule.id)} aria-label={`Xóa ${rule.name}`}><Trash2 size={16}/></button>
                  </article>
                ))}
              </section>
            </div>
          </section>
        </div>
      )}

      {error && <div className="alert">{error}</div>}

      <section className={`${typeFilter === "media" && mediaViewMode === "grid" ? "media-library-grid" : "list"}`} aria-live="polite">
        {loading && items.length === 0 ? (
          <div className="state media-library-state"><Loader2 className="spin" /><span>Đang tải dữ liệu...</span></div>
        ) : visibleItems.length === 0 ? (
          <div className="empty media-library-state"><Layers3 size={34} /><strong>Chưa có dữ liệu phù hợp</strong><span>Thử đổi bộ lọc hoặc bấm + để tạo mục mới.</span></div>
        ) : typeFilter === "media" && mediaViewMode === "grid" ? visibleItems.map((item) => (
          <MediaLibraryTile key={item.id} item={item} kind={mediaKindCache[item.id] || inferMediaKind(item)} selectionMode={selectionMode} checked={selectedIds.has(item.id)} onSelect={() => toggleSelection(item.id)} onOpenGallery={() => setMediaGalleryId(item.id)} onOpenDetail={() => openItem(item)} />
        )) : visibleItems.map((item) => (
          <SwipeCard
            key={item.id}
            item={item}
            onOpen={() => openItem(item)}
            onEdit={() => item.deleted ? restoreTrashItem(item) : openEdit(item)}
            onDelete={() => item.deleted ? purgeItem(item) : deleteItem(item)}
            onCopy={() => copyItem(item)}
            onOpenUrl={() => recordUsage(item)}
            onTogglePin={() => togglePin(item)}
            selectionMode={selectionMode}
            checked={selectedIds.has(item.id)}
            onSelect={() => toggleSelection(item.id)}
            trashed={item.deleted}
          />
        ))}
      </section>

      {!selectionMode && <div className={`floating-controls ${floatingActive ? "active" : "idle"}`}>
        {showScrollTop && <button className="scroll-top-button" aria-label="Lên đầu trang" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><ArrowUp size={20} /></button>}
        <button className="fab" onClick={openCreate} aria-label="Thêm mới"><Plus size={22} /></button>
      </div>}

      {selectionMode && selectedIds.size > 0 && <div className="bulk-bar">
        <div className="bulk-count"><strong>{selectedIds.size}</strong><span>mục</span></div>
        <div className="bulk-actions">
          {libraryMode === "trash" ? <>
            <button onClick={() => applyBulkAction("restoreTrash")}><ArchiveRestore size={16}/> Khôi phục</button>
            <button className="danger-action" onClick={() => applyBulkAction("purge")}><Trash2 size={16}/> Xóa vĩnh viễn</button>
          </> : <>
            <button onClick={() => applyBulkAction("pin")}><Pin size={16}/> Ghim</button>
            <button onClick={() => applyBulkAction("unpin")}><PinOff size={16}/> Bỏ ghim</button>
            {libraryMode === "archive" ? <button onClick={() => applyBulkAction("restore")}><ArchiveRestore size={16}/> Khôi phục</button> : <button onClick={() => applyBulkAction("archive")}><Archive size={16}/> Lưu trữ</button>}
            <label className="bulk-move"><FolderInput size={16}/><input list="bulk-collection-options" value={bulkCollection} onChange={(e) => setBulkCollection(e.target.value)} placeholder="Phân loại"/><datalist id="bulk-collection-options">{collections.map((name) => <option key={name} value={name}/>)}</datalist><button onClick={() => applyBulkAction("move")}>Chuyển</button></label>
            <button className="danger-action" onClick={() => applyBulkAction("delete")}><Trash2 size={16}/> Thùng rác</button>
          </>}
        </div>
      </div>}

      {showDataTools && (
        <div className="modal-backdrop data-tools-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !dataBusy) setShowDataTools(false); }}>
          <section className="modal data-tools-sheet" role="dialog" aria-modal="true" aria-labelledby="data-tools-title">
            <div className="sheet-handle" />
            <div className="modal-head">
              <div><div className="eyebrow">V2.0 · SECURITY & DATA</div><h2 id="data-tools-title">Backup & dữ liệu</h2></div>
              <button className="icon-button" onClick={() => setShowDataTools(false)} disabled={dataBusy}><X size={20}/></button>
            </div>

            <div className="data-tools-content">
              <section className="health-grid">
                <div><strong>{items.length}</strong><span>Tổng bản ghi</span></div>
                <div><strong>{duplicateCount}</strong><span>Nghi trùng</span></div>
                <div><strong>{suspiciousLinks.length}</strong><span>Link cần kiểm tra</span></div>
                <div><strong>{trashCount}</strong><span>Trong thùng rác</span></div>
              </section>

              <section className="tool-card">
                <div className="tool-card-head"><div><Download size={18}/><div><strong>Export dữ liệu</strong><span>Tải bản sao về thiết bị.</span></div></div></div>
                <div className="tool-button-grid">
                  <button className="secondary" onClick={exportJson}><Download size={16}/> Export JSON</button>
                  <button className="secondary" onClick={exportCsv}><Download size={16}/> Export CSV</button>
                </div>
              </section>

              <section className="tool-card">
                <div className="tool-card-head"><div><Upload size={18}/><div><strong>Import JSON</strong><span>Preview trước khi ghi vào Google Sheet.</span></div></div></div>
                <input ref={importInputRef} className="hidden-file-input" type="file" accept="application/json,.json" onChange={(e) => handleImportFile(e.target.files?.[0])} />
                <button className="file-picker" onClick={() => importInputRef.current?.click()}><Upload size={16}/>{importFileName || "Chọn file DriveVault JSON"}</button>
                {importItems.length > 0 && <div className="import-preview">
                  <div><strong>{importItems.length}</strong><span>Mục hợp lệ</span></div>
                  <div><strong>{importDuplicateCount}</strong><span>Có thể trùng</span></div>
                  <label>Chiến lược<select value={importMode} onChange={(e) => setImportMode(e.target.value as "skip" | "merge" | "replace")}><option value="skip">Skip dữ liệu trùng</option><option value="merge">Merge dữ liệu trùng</option><option value="replace">Replace toàn bộ</option></select></label>
                  <button className="primary data-action" disabled={dataBusy || !online} onClick={executeImport}>{dataBusy ? <Loader2 size={16} className="spin"/> : <Upload size={16}/>} Import</button>
                </div>}
                {importReport && <div className="report-strip"><span>Nhận <strong>{importReport.received}</strong></span><span>Thêm <strong>{importReport.added}</strong></span><span>Cập nhật <strong>{importReport.updated}</strong></span><span>Bỏ qua <strong>{importReport.skipped}</strong></span></div>}
              </section>

              <section className="tool-card">
                <div className="tool-card-head"><div><Database size={18}/><div><strong>Backup Snapshot</strong><span>Lưu snapshot trực tiếp trong sheet Backups.</span></div></div><button className="mini-refresh" onClick={() => loadBackups()} disabled={!online || dataBusy}><RefreshCcw size={15}/></button></div>
                <div className="backup-create"><input maxLength={160} value={backupNote} onChange={(e) => setBackupNote(e.target.value)} placeholder="Ghi chú backup (không bắt buộc)"/><button className="primary" onClick={createBackupSnapshot} disabled={!online || dataBusy}>{dataBusy ? <Loader2 size={16} className="spin"/> : <Database size={16}/>} Tạo snapshot</button></div>
                <div className="backup-list">
                  {backups.length === 0 ? <div className="backup-empty">Chưa có snapshot hoặc chưa tải được danh sách.</div> : backups.map((backup) => <div className="backup-row" key={backup.id}>
                    <div><strong>{formatDate(backup.createdAt)} · {new Date(backup.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</strong><span>{backup.itemCount} mục{backup.note ? ` · ${backup.note}` : ""}</span></div>
                    <div className="backup-row-actions"><button onClick={() => restoreSnapshot(backup)} disabled={dataBusy}><History size={15}/> Restore</button><button className="danger-text" onClick={() => removeSnapshot(backup)} disabled={dataBusy}><Trash2 size={15}/></button></div>
                  </div>)}
                </div>
              </section>

              <section className="tool-card diagnostic-card">
                <div className="tool-card-head"><div><Link2 size={18}/><div><strong>Kiểm tra dữ liệu</strong><span>Phát hiện dữ liệu trùng và link media không nhận diện được rõ ràng.</span></div></div></div>
                {duplicateCount === 0 && suspiciousLinks.length === 0 ? <div className="diagnostic-ok"><Check size={16}/> Chưa phát hiện vấn đề cơ bản.</div> : <div className="diagnostic-warn">
                  {duplicateCount > 0 && <span><AlertCircle size={15}/> Có {duplicateCount} mục nghi trùng theo URL hoặc Tên + Nội dung.</span>}
                  {suspiciousLinks.length > 0 && <span><AlertCircle size={15}/> Có {suspiciousLinks.length} link Ảnh/Video cần kiểm tra định dạng.</span>}
                </div>}
              </section>

              <section className="tool-card trash-tool-card">
                <div className="tool-card-head"><div><Trash2 size={18}/><div><strong>Thùng rác</strong><span>Xóa thường chỉ chuyển dữ liệu vào đây.</span></div></div></div>
                <button className="danger-outline" disabled={!trashCount || dataBusy || !online} onClick={emptyTrash}><Trash2 size={16}/> Xóa vĩnh viễn toàn bộ ({trashCount})</button>
              </section>
            </div>
          </section>
        </div>
      )}

      {showSecurity && (
        <div className="modal-backdrop security-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !securityBusy) setShowSecurity(false); }}>
          <section className="modal security-sheet" role="dialog" aria-modal="true" aria-labelledby="security-title">
            <div className="sheet-handle" />
            <div className="modal-head">
              <div><div className="eyebrow">V2.0 · SECURITY & APP LOCK</div><h2 id="security-title">Bảo mật ứng dụng</h2></div>
              <button className="icon-button" onClick={() => setShowSecurity(false)} disabled={securityBusy}><X size={20}/></button>
            </div>
            <div className="security-content">
              <div className={`security-status ${securityConfig?.enabled ? "enabled" : ""}`}>
                <span className="security-status-icon">{securityConfig?.enabled ? <Lock size={20}/> : <ShieldCheck size={20}/>}</span>
                <div><strong>{securityConfig?.enabled ? "App Lock đang bật" : "App Lock đang tắt"}</strong><span>{securityConfig?.enabled ? "PIN được băm bằng PBKDF2 và chỉ lưu trên thiết bị này." : "Tạo PIN để khóa app và bảo vệ từng block."}</span></div>
              </div>

              {securityConfig?.enabled && <section className="security-section">
                <div className="security-section-title"><strong>Tự động khóa</strong><span>Khóa lại khi không thao tác</span></div>
                <select value={securityConfig.autoLockMinutes} onChange={(e) => updateAutoLock(Number(e.target.value))}>
                  <option value={1}>Sau 1 phút</option><option value={5}>Sau 5 phút</option><option value={15}>Sau 15 phút</option><option value={30}>Sau 30 phút</option><option value={60}>Sau 60 phút</option>
                </select>
                <button className="secondary security-lock-now" onClick={lockNow}><Lock size={16}/> Khóa ngay</button>
              </section>}

              <section className="security-section">
                <div className="security-section-title"><strong>{securityConfig?.enabled ? "Đổi PIN" : "Tạo PIN"}</strong><span>PIN từ 4–8 chữ số</span></div>
                {securityConfig?.enabled && <div className="pin-input-wrap"><KeyRound size={17}/><input inputMode="numeric" pattern="[0-9]*" maxLength={8} type={showPin ? "text" : "password"} value={securityOldPin} onChange={(e) => setSecurityOldPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN hiện tại"/></div>}
                <div className="pin-input-wrap"><Lock size={17}/><input inputMode="numeric" pattern="[0-9]*" maxLength={8} type={showPin ? "text" : "password"} value={securityPin} onChange={(e) => setSecurityPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN mới"/><button type="button" onClick={() => setShowPin((v) => !v)}>{showPin ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
                <div className="pin-input-wrap"><Check size={17}/><input inputMode="numeric" pattern="[0-9]*" maxLength={8} type={showPin ? "text" : "password"} value={securityPinConfirm} onChange={(e) => setSecurityPinConfirm(e.target.value.replace(/\D/g, ""))} placeholder="Nhập lại PIN mới"/></div>
                {securityError && <div className="security-error">{securityError}</div>}
                <button className="save" onClick={() => void saveSecurity()} disabled={securityBusy}>{securityBusy ? <Loader2 size={17} className="spin"/> : <ShieldCheck size={17}/>} {securityConfig?.enabled ? "Đổi PIN" : "Bật App Lock"}</button>
              </section>

              {securityConfig?.enabled && <section className="security-section danger-security">
                <strong>Tắt App Lock</strong><span>Nhập PIN hiện tại ở trên rồi tắt. Các mục đang đánh dấu bảo vệ sẽ được bỏ bảo vệ.</span>
                <button className="danger-outline" onClick={() => void disableSecurity()} disabled={securityBusy}><Unlock size={16}/> Tắt App Lock</button>
              </section>}
            </div>
          </section>
        </div>
      )}

      {protectedTargetId && (
        <div className="modal-backdrop protected-verify-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setProtectedTargetId(null); }}>
          <section className="modal protected-verify-sheet" role="dialog" aria-modal="true" aria-labelledby="protected-verify-title">
            <div className="sheet-handle" />
            <div className="modal-head"><div><div className="eyebrow">PROTECTED ITEM</div><h2 id="protected-verify-title">Xác thực để xem</h2></div><button className="icon-button" onClick={() => setProtectedTargetId(null)}><X size={20}/></button></div>
            <div className="protected-verify-content">
              <div className="lock-logo small"><Lock size={22}/></div>
              <p>Block này được bảo vệ. Nhập PIN App Lock để mở nội dung.</p>
              <div className="pin-input-wrap"><KeyRound size={18}/><input autoFocus inputMode="numeric" pattern="[0-9]*" maxLength={8} type={showPin ? "text" : "password"} value={protectedPin} onChange={(e) => setProtectedPin(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void verifyProtectedItem(); } }} placeholder="PIN"/><button type="button" onClick={() => setShowPin((v) => !v)}>{showPin ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
              {protectedError && <div className="security-error">{protectedError}</div>}
              <button className="save" onClick={() => void verifyProtectedItem()}><Unlock size={18}/> Mở nội dung</button>
            </div>
          </section>
        </div>
      )}

      {mediaGalleryId && mediaGalleryItems.length > 0 && <MediaGallery items={mediaGalleryItems} activeId={mediaGalleryId} onChange={setMediaGalleryId} onClose={() => setMediaGalleryId(null)} onDetail={(item) => { setMediaGalleryId(null); window.setTimeout(() => openItem(item), 0); }} />}

      {showForm && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setShowForm(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title">
            <div className="sheet-handle" />
            <div className="modal-head">
              <div><div className="eyebrow">{editingId ? "CHỈNH SỬA" : "MỤC LƯU TRỮ MỚI"}</div><h2 id="form-title">{editingId ? "Cập nhật dữ liệu" : "Thêm mới"}</h2></div>
              <button className="icon-button" onClick={() => setShowForm(false)} disabled={saving}><X size={20}/></button>
            </div>
            <form onSubmit={saveItem}>
              {!editingId && <div className="quick-capture-box">
                <div className="quick-capture-head"><div><span className="eyebrow">QUICK CAPTURE</span><strong>Ghi nhanh với thiết lập gần nhất</strong></div><span>{readQuickPrefs().collection}</span></div>
                {templates.length > 0 ? <div className="template-row">{templates.map((template) => <div className="template-chip" key={template.id}><button type="button" onClick={() => applyTemplate(template)}><FileText size={13}/>{template.name}</button><button type="button" className="template-remove" aria-label={`Xóa mẫu ${template.name}`} onClick={() => removeTemplate(template.id)}><X size={12}/></button></div>)}</div> : <div className="template-empty">Chưa có mẫu. Điền form rồi bấm “Lưu thành mẫu” để dùng lại một chạm.</div>}
              </div>}
              {!editingId && form.type === "content" && <label className="quick-url-field">Dán link nhanh <small>DriveVault sẽ tự nhận diện loại/phân loại/tag</small><input inputMode="url" value={form.url || ""} onChange={(e) => handleSmartUrlChange(e.target.value)} placeholder="https://..." /></label>}
              <label>Loại lưu trữ<select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as StorageType }))}><option value="media">Ảnh / Video</option><option value="content">Nội dung</option><option value="other">Khác</option></select></label>
              <label>Tên<input maxLength={120} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="VD: Bộ ảnh sự kiện tháng 9" /></label>
              <label>Phân loại<input list="collection-options" maxLength={80} value={form.collection || ""} onChange={(e) => setForm((f) => ({ ...f, collection: e.target.value }))} placeholder="VD: Shopee" /><datalist id="collection-options">{collections.map((name) => <option key={name} value={name}/>)}</datalist></label>
              <label>Tag <small>(phân cách bằng dấu phẩy)</small><input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="VD: công việc, email, mẫu" /></label>
              <label>Nội dung chi tiết {form.type === "media" && <small>(không bắt buộc)</small>}{form.type === "other" && <small>(không bắt buộc nếu có link)</small>}<textarea rows={7} value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} placeholder={form.type === "media" ? "Mô tả ảnh/video, ghi chú, nội dung liên quan..." : "Nhập nội dung cần lưu để sao chép nhanh..."} /></label>
              {(form.type === "media" || form.type === "other") && <label>Đường link {form.type === "other" && <small>(không bắt buộc)</small>}<input inputMode="url" value={form.url} onChange={(e) => handleSmartUrlChange(e.target.value)} placeholder="Dán link Drive, YouTube, Shopee..." />{normalizeUrl(form.url || "") && !editingId && <span className="smart-link-hint"><Link2 size={13}/> Đã nhận diện: {inferQuickCapture(form.url || "").label} · gợi ý {inferQuickCapture(form.url || "").collection}</span>}</label>}
              {form.type === "media" && normalizeUrl(form.url || "") && <VideoThumbnailPicker url={form.url || ""} value={String(form.thumbnail || "")} onChange={(thumbnail) => setForm((f) => ({ ...f, thumbnail }))} />}
              {!editingId && <button type="button" className="save-template-button" onClick={saveCurrentAsTemplate}><Clipboard size={16}/> Lưu form hiện tại thành mẫu</button>}
              {duplicateCandidate && !duplicateOverride && <div className="duplicate-warning"><div><AlertCircle size={17}/><span><strong>Có thể bị trùng</strong><small>Đã có “{duplicateCandidate.name}” với cùng link/nội dung.</small></span></div><div><button type="button" onClick={() => { setShowForm(false); window.setTimeout(() => openItem(duplicateCandidate), 0); }}>Xem mục cũ</button><button type="button" className="duplicate-keep" onClick={() => setDuplicateOverride(true)}>Vẫn lưu</button></div></div>}
              <label className={`protected-toggle ${!securityConfig?.enabled ? "disabled" : ""}`}><span><Lock size={16}/><span><strong>Bảo vệ mục này</strong><small>{securityConfig?.enabled ? "Yêu cầu PIN khi mở block" : "Bật App Lock trước để sử dụng"}</small></span></span><input type="checkbox" checked={Boolean(form.protected && securityConfig?.enabled)} disabled={!securityConfig?.enabled} onChange={(e) => setForm((f) => ({ ...f, protected: e.target.checked }))}/></label>
              <button className="save" disabled={saving}>{saving ? <Loader2 size={18} className="spin" /> : editingId ? <Pencil size={18}/> : <Plus size={18}/>} {saving ? "Đang lưu..." : editingId ? "Lưu thay đổi" : duplicateOverride ? "Lưu dù trùng" : "Lưu mục"}</button>
            </form>
          </section>
        </div>
      )}

      {selected && (
        <div className="modal-backdrop detail-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}>
          <section className="modal detail-sheet" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <div className="sheet-handle" />
            <div className="modal-head detail-modal-head">
              <span className={`badge ${typeMeta[selected.type].className}`}>{(() => { const I = typeMeta[selected.type].icon; return <I size={14}/>; })()}{typeMeta[selected.type].label}</span>
              <div className="detail-head-actions">{!selected.deleted && <button className={`pin-button ${selected.pinned ? "active" : ""}`} onClick={() => togglePin(selected)} aria-label={selected.pinned ? "Bỏ ghim" : "Ghim"}>{selected.pinned ? <PinOff size={18}/> : <Pin size={18}/>}</button>}<button className="icon-button" onClick={() => setSelectedId(null)}><X size={20}/></button></div>
            </div>
            <div className="detail-content">
              <h2 id="detail-title">{selected.name}</h2>
              <div className="collection-label detail-collection"><Folder size={14}/>{selected.collection}{selected.archived && <span><Archive size={13}/> Đã lưu trữ</span>}{selected.protected && <span><Lock size={13}/> Được bảo vệ</span>}{selected.deleted && <span className="trash-inline"><Trash2 size={13}/> Thùng rác {selected.deletedAt ? `· ${formatDate(selected.deletedAt)}` : ""}</span>}</div>
              <div className="detail-date">Đã lưu {formatDate(selected.createdAt)} · đã dùng {selected.useCount} lần{selected.lastUsedAt ? ` · ${formatRelative(selected.lastUsedAt)}` : ""}</div>
              <SyncBadge state={selected.syncState} />
              {selected.type === "media" && selected.url && <MediaDetailPreview item={selected} />}
              {selected.url && (() => { const intel = analyzeLink(selected.url); return <div className={`link-intel-panel ${intel.kind === "invalid" ? "invalid" : ""}`}><div><Link2 size={15}/><strong>{intel.label}</strong></div><span>{intel.provider || "Không nhận diện"}{intel.fileId ? ` · ID: ${intel.fileId}` : ""}</span></div>; })()}
              {selected.tags.length > 0 && <div className="tag-row detail-tags">{selected.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</div>}
              {selected.detail ? <div className="full-detail">{selected.detail}</div> : <div className="no-detail">Không có nội dung chi tiết.</div>}
              {selected.url && <div className="url-preview">{selected.url}</div>}
            </div>
            <div className="detail-actions detail-actions-v14">
              {selected.deleted ? <>
                <button className="primary" onClick={() => restoreTrashItem(selected)}><ArchiveRestore size={18}/> Khôi phục</button>
                <button className="danger-button" onClick={() => purgeItem(selected)}><Trash2 size={18}/> Xóa vĩnh viễn</button>
              </> : <>
                {selected.detail && <button className="secondary" onClick={() => copyItem(selected)}><Clipboard size={18}/> Sao chép</button>}
                {selected.url && <a className="primary" href={selected.url} target="_blank" rel="noreferrer" onClick={() => recordUsage(selected)}><ExternalLink size={18}/> Truy cập</a>}
                <button className="secondary" onClick={() => openEdit(selected)}><Pencil size={18}/> Sửa</button>
                <button className="secondary" onClick={() => archiveItem(selected)}>{selected.archived ? <ArchiveRestore size={18}/> : <Archive size={18}/>} {selected.archived ? "Khôi phục" : "Lưu trữ"}</button>
              </>}
            </div>
          </section>
        </div>
      )}

      {undoDelete && <div className="undo-toast"><span>Đã chuyển “{undoDelete.item.name}” vào Thùng rác</span><button onClick={undoDeleteItem}><Undo2 size={16}/> Hoàn tác</button></div>}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
