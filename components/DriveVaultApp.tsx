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
  Image as ImageIcon,
  Layers3,
  Loader2,
  Moon,
  Pencil,
  Pin,
  PinOff,
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
  Trash2,
  Undo2,
  WifiOff,
  X,
} from "lucide-react";
import type { BackupSnapshot, CreateVaultItem, ImportReport, StorageType, SyncState, VaultItem } from "@/lib/types";

const CACHE_KEY = "drivevault-v160-items";
const QUEUE_KEY = "drivevault-v160-sync-queue";
const LEGACY_CACHE_KEY = "drivevault-v150-items";
const LEGACY_QUEUE_KEY = "drivevault-v150-sync-queue";
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
};

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
  const headers = ["id","type","name","detail","url","createdAt","updatedAt","tags","pinned","useCount","lastUsedAt","collection","archived","deleted","deletedAt"];
  const rows = items.map((item) => headers.map((key) => csvCell((exportableItem(item) as Record<string, unknown>)[key])).join(","));
  return `\uFEFF${headers.join(",")}\n${rows.join("\n")}`;
}

function normalizedDuplicateKey(item: VaultItem) {
  const url = item.url.trim().toLowerCase();
  if (url) return `url:${url}`;
  const text = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return `text:${text(item.name)}|${text(item.detail)}`;
}

type LinkIntel = {
  kind: "none" | "drive-file" | "drive-folder" | "youtube" | "direct-image" | "web" | "invalid";
  provider: string;
  label: string;
  fileId?: string;
  thumbnailUrl?: string;
  embedUrl?: string;
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
      if (id) return {
        kind: "drive-file",
        provider: "Google Drive",
        label: "Tệp Google Drive",
        fileId: id,
        thumbnailUrl: `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200`,
        embedUrl: `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`,
      };
      return { kind: "web", provider: "Google Drive", label: "Liên kết Drive" };
    }

    if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com") {
      const id = host === "youtu.be" ? path.split("/").filter(Boolean)[0] : (url.searchParams.get("v") || path.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1]);
      if (id) return {
        kind: "youtube", provider: "YouTube", label: "Video YouTube", fileId: id,
        thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
      };
    }

    if (/\.(?:png|jpe?g|gif|webp|avif)(?:$|\?)/i.test(url.href)) return { kind: "direct-image", provider: host, label: "Ảnh trực tiếp", thumbnailUrl: url.href };
    return { kind: "web", provider: host, label: "Liên kết web" };
  } catch {
    return { kind: "invalid", provider: "", label: "Link không hợp lệ" };
  }
}

function isSuspiciousDriveLink(item: VaultItem) {
  if (!item.url) return false;
  const intel = analyzeLink(item.url);
  return intel.kind === "invalid" || (item.type === "media" && intel.kind === "web");
}

function MediaThumbnail({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const intel = analyzeLink(url);
  if (!intel.thumbnailUrl || failed) return null;
  return <div className="media-thumbnail"><img src={intel.thumbnailUrl} alt="" loading="lazy" onError={() => setFailed(true)} /></div>;
}

function MediaDetailPreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const intel = analyzeLink(url);
  if (!url) return null;
  if (intel.embedUrl && !failed) {
    return <div className="media-preview-frame"><iframe src={intel.embedUrl} title="Xem trước media" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" onError={() => setFailed(true)} /></div>;
  }
  if (intel.thumbnailUrl && !failed) return <div className="media-preview-image"><img src={intel.thumbnailUrl} alt="Xem trước media" onError={() => setFailed(true)} /></div>;
  return null;
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
  const actionsVisible = !selectionMode && offset < -2;

  useEffect(() => { if (selectionMode) setOffset(0); }, [selectionMode]);

  function pointerDown(e: React.PointerEvent) {
    if (selectionMode) return;
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
            {item.archived && <span className="archive-label"><Archive size={12} /> Lưu trữ</span>}{item.deleted && <span className="trash-label"><Trash2 size={12} /> Thùng rác</span>}
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
        {item.type === "media" && item.url && <MediaThumbnail url={item.url} />}
        {item.url && <div className={`link-intel-row ${intel.kind === "invalid" ? "invalid" : ""}`}><Link2 size={12}/><span>{intel.label}</span>{intel.provider && <small>{intel.provider}</small>}</div>}
        {item.detail && <p className="detail">{item.detail}</p>}
        {item.tags.length > 0 && <div className="tag-row">{item.tags.slice(0, 3).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}{item.tags.length > 3 && <span className="tag more">+{item.tags.length - 3}</span>}</div>}

        <div className="card-status-row">
          <SyncBadge state={item.syncState} />
          {item.lastUsedAt && <span className="last-used">{formatRelative(item.lastUsedAt)}</span>}
        </div>

        {!selectionMode && !item.deleted && <div className="actions" onClick={(e) => e.stopPropagation()}>
          {item.detail && <button className="secondary" onClick={onCopy}><Clipboard size={17} /> Sao chép</button>}
          {item.url && <a className="primary" href={item.url} target="_blank" rel="noreferrer" onClick={onOpenUrl}><ExternalLink size={17} /> Truy cập</a>}
        </div>}
      </article>
    </div>
  );
}

export default function DriveVaultApp() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | StorageType>("all");
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
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const scrollIdleTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const queueRef = useRef<QueueOperation[]>([]);
  const itemsRef = useRef<VaultItem[]>([]);
  const flushingRef = useRef(false);

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
    queueRef.current = readQueue();
    setPendingCount(queueRef.current.length);
    const cached = readLocalItems();
    if (cached.length) setItems(applyQueueToItems(cached, queueRef.current));
    // Migrate cache/queue V1.5 sang namespace V1.6 trước khi xóa key cũ.
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
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 180);
      setFloatingActive(true);
      if (scrollIdleTimer.current) clearTimeout(scrollIdleTimer.current);
      scrollIdleTimer.current = window.setTimeout(() => setFloatingActive(false), 500);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (scrollIdleTimer.current) clearTimeout(scrollIdleTimer.current); };
  }, []);

  useEffect(() => {
    if (!showForm && !selected && !showDataTools && !advancedOpen) return;
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
  }, [showForm, selected, showDataTools, advancedOpen]);

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

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, collection: selectedCollection !== "all" ? selectedCollection : "Chưa phân loại" });
    setTagText("");
    setError("");
    setShowForm(true);
  }

  function openEdit(item: VaultItem) {
    setEditingId(item.id);
    setForm({ type: item.type, name: item.name, detail: item.detail, url: item.url, tags: item.tags, pinned: item.pinned, collection: item.collection, archived: item.archived });
    setTagText(item.tags.join(", "));
    setSelectedId(null);
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
    if (form.type === "media" && !url) return setError("Ảnh / Video cần link Google Drive hợp lệ.");
    if (form.type === "content" && !detail) return setError("Vui lòng nhập nội dung chi tiết.");
    if (form.type === "other" && !detail && !url) return setError("Loại Khác cần ít nhất nội dung hoặc đường link.");

    setError("");
    const now = new Date().toISOString();
    if (!editingId) {
      const optimisticItem: VaultItem = {
        id: createClientId(), type: form.type, name, detail, url, tags, collection,
        pinned: Boolean(form.pinned), archived: false, deleted: false, deletedAt: "", useCount: 0, lastUsedAt: "",
        createdAt: now, updatedAt: now, syncState: "pending",
      };
      setItems((current) => [optimisticItem, ...current]);
      setForm(emptyForm); setTagText(""); setShowForm(false);
      enqueue({ opId: createClientId(), type: "create", targetId: optimisticItem.id, item: optimisticItem });
      notify(online ? "Đã thêm · đang đồng bộ" : "Đã lưu offline · chờ đồng bộ");
      return;
    }

    const current = items.find((item) => item.id === editingId);
    if (!current) return setError("Không tìm thấy dữ liệu cần sửa.");
    const updated: VaultItem = { ...current, type: form.type, name, detail, url, tags, collection, updatedAt: now, syncState: "pending" };
    setSaving(true);
    setItems((list) => list.map((item) => item.id === editingId ? updated : item));
    setForm(emptyForm); setTagText(""); setEditingId(null); setShowForm(false);
    enqueue({ opId: createClientId(), type: "update", targetId: updated.id, item: updated });
    setSaving(false);
    notify(online ? "Đã cập nhật · đang đồng bộ" : "Đã cập nhật offline");
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
      version: "1.6.0",
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
    setSearch(""); setTypeFilter("all"); setLibraryMode("all"); setSelectedTag("all"); setSelectedCollection("all");
    setSortMode("smart"); setDateFrom(""); setDateTo(""); setLinkFilter("all");
    setSearchFields({ name: true, detail: true, url: true, tags: true, collection: true });
    setAdvancedOpen(false); exitSelection();
    window.scrollTo({ top: 0, behavior: "smooth" });
    void flushQueue().then(() => loadItems(true));
  }

  const activeFilterCount = [
    libraryMode !== "all", sortMode !== "smart", selectedTag !== "all", selectedCollection !== "all",
    Boolean(dateFrom), Boolean(dateTo), linkFilter !== "all", selectionMode,
    Object.values(searchFields).some((value) => !value),
  ].filter(Boolean).length;

  const visibleSelectedCount = filtered.filter((item) => selectedIds.has(item.id)).length;
  const allVisibleSelected = filtered.length > 0 && visibleSelectedCount === filtered.length;

  return (
    <main className="shell">
      <header className="topbar compact-topbar">
        <button className="brand-button" onClick={resetDashboard} aria-label="DriveVault · làm mới và xóa bộ lọc">
          <span className="brand-mark"><Database size={21}/></span>
          <span className="brand-copy">
            <span className="eyebrow">DRIVEVAULT · V1.6.0</span>
            <strong>Kho dùng nhanh</strong>
            <small>Media intelligence · phân loại thông minh</small>
          </span>
        </button>
        <div className="top-actions">
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

      <section className="toolbar compact-toolbar">
        <div className="search-row">
          <label className="searchbox"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Tìm kiếm... dùng "cụm từ" để khớp chính xác' /></label>
          <button className={`filter-toggle ${activeFilterCount ? "active" : ""}`} onClick={() => setAdvancedOpen(true)} aria-label="Mở bộ lọc">
            <SlidersHorizontal size={18} />
            {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
          </button>
        </div>

        <div className="chips storage-type-chips" role="tablist" aria-label="Lọc loại lưu trữ">
          {(["all", "media", "content", "other"] as const).map((key) => <button key={key} className={`chip ${typeFilter === key ? "active" : ""}`} onClick={() => setTypeFilter(key)}>{key === "all" ? "Tất cả loại" : typeMeta[key].label}</button>)}
        </div>
      </section>

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

      {error && <div className="alert">{error}</div>}

      <section className="list" aria-live="polite">
        {loading && items.length === 0 ? (
          <div className="state"><Loader2 className="spin" /><span>Đang tải dữ liệu...</span></div>
        ) : filtered.length === 0 ? (
          <div className="empty"><Layers3 size={34} /><strong>Chưa có dữ liệu phù hợp</strong><span>Thử đổi bộ lọc hoặc bấm + để tạo mục mới.</span></div>
        ) : filtered.map((item) => (
          <SwipeCard
            key={item.id}
            item={item}
            onOpen={() => setSelectedId(item.id)}
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
              <div><div className="eyebrow">V1.6 · DATA & LINK INTELLIGENCE</div><h2 id="data-tools-title">Backup & dữ liệu</h2></div>
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

      {showForm && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setShowForm(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title">
            <div className="sheet-handle" />
            <div className="modal-head">
              <div><div className="eyebrow">{editingId ? "CHỈNH SỬA" : "MỤC LƯU TRỮ MỚI"}</div><h2 id="form-title">{editingId ? "Cập nhật dữ liệu" : "Thêm mới"}</h2></div>
              <button className="icon-button" onClick={() => setShowForm(false)} disabled={saving}><X size={20}/></button>
            </div>
            <form onSubmit={saveItem}>
              <label>Loại lưu trữ<select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as StorageType }))}><option value="media">Ảnh / Video</option><option value="content">Nội dung</option><option value="other">Khác</option></select></label>
              <label>Tên<input maxLength={120} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="VD: Bộ ảnh sự kiện tháng 9" /></label>
              <label>Phân loại<input list="collection-options" maxLength={80} value={form.collection || ""} onChange={(e) => setForm((f) => ({ ...f, collection: e.target.value }))} placeholder="VD: Shopee" /><datalist id="collection-options">{collections.map((name) => <option key={name} value={name}/>)}</datalist></label>
              <label>Tag <small>(phân cách bằng dấu phẩy)</small><input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="VD: công việc, email, mẫu" /></label>
              <label>Nội dung chi tiết {form.type === "media" && <small>(không bắt buộc)</small>}{form.type === "other" && <small>(không bắt buộc nếu có link)</small>}<textarea rows={7} value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} placeholder={form.type === "media" ? "Mô tả ảnh/video, ghi chú, nội dung liên quan..." : "Nhập nội dung cần lưu để sao chép nhanh..."} /></label>
              {(form.type === "media" || form.type === "other") && <label>Đường link Google Drive {form.type === "other" && <small>(không bắt buộc)</small>}<input inputMode="url" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://drive.google.com/..." /></label>}
              <button className="save" disabled={saving}>{saving ? <Loader2 size={18} className="spin" /> : editingId ? <Pencil size={18}/> : <Plus size={18}/>} {saving ? "Đang lưu..." : editingId ? "Lưu thay đổi" : "Lưu mục"}</button>
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
              <div className="collection-label detail-collection"><Folder size={14}/>{selected.collection}{selected.archived && <span><Archive size={13}/> Đã lưu trữ</span>}{selected.deleted && <span className="trash-inline"><Trash2 size={13}/> Thùng rác {selected.deletedAt ? `· ${formatDate(selected.deletedAt)}` : ""}</span>}</div>
              <div className="detail-date">Đã lưu {formatDate(selected.createdAt)} · đã dùng {selected.useCount} lần{selected.lastUsedAt ? ` · ${formatRelative(selected.lastUsedAt)}` : ""}</div>
              <SyncBadge state={selected.syncState} />
              {selected.type === "media" && selected.url && <MediaDetailPreview url={selected.url} />}
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
                {selected.url && <a className="primary" href={selected.url} target="_blank" rel="noreferrer" onClick={() => recordUsage(selected)}><ExternalLink size={18}/> Truy cập Drive</a>}
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
