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
  Trash2,
  Undo2,
  WifiOff,
  X,
} from "lucide-react";
import type { CreateVaultItem, StorageType, SyncState, VaultItem } from "@/lib/types";

const CACHE_KEY = "drivevault-v140-items";
const QUEUE_KEY = "drivevault-v140-sync-queue";
const LEGACY_CACHE_KEY = "drivevault-v130-items";
const LEGACY_QUEUE_KEY = "drivevault-v130-sync-queue";
const DELETE_UNDO_MS = 5000;

const typeMeta: Record<StorageType, { label: string; icon: typeof ImageIcon; className: string }> = {
  media: { label: "Ảnh / Video", icon: ImageIcon, className: "badge-media" },
  content: { label: "Nội dung", icon: FileText, className: "badge-content" },
  other: { label: "Khác", icon: Layers3, className: "badge-other" },
};

type LibraryMode = "all" | "pinned" | "recent" | "frequent" | "archive";
type SortMode = "smart" | "newest" | "oldest" | "name-az" | "name-za" | "recent" | "frequent";
type SearchField = "name" | "detail" | "url" | "tags" | "collection";
type BulkMode = "archive" | "restore" | "pin" | "unpin" | "move" | "delete";
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
  if (op.bulkMode === "delete") {
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
      map.delete(op.targetId);
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
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef<number | null>(null);
  const startOffset = useRef(0);
  const moved = useRef(false);
  const meta = typeMeta[item.type] || typeMeta.other;
  const Icon = meta.icon;
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
        <button className="swipe-edit" tabIndex={actionsVisible ? 0 : -1} aria-label={`Sửa ${item.name}`} onClick={() => { setOffset(0); onEdit(); }}>
          <Pencil size={19} /><span>Sửa</span>
        </button>
        <button className="swipe-delete" tabIndex={actionsVisible ? 0 : -1} aria-label={`Xóa ${item.name}`} onClick={() => { setOffset(0); onDelete(); }}>
          <Trash2 size={19} /><span>Xóa</span>
        </button>
      </div>

      <article
        className={`card swipe-card ${item.pinned ? "is-pinned" : ""} ${item.archived ? "is-archived" : ""}`}
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
            {item.archived && <span className="archive-label"><Archive size={12} /> Lưu trữ</span>}
          </div>
          {!selectionMode && <button className={`pin-button ${item.pinned ? "active" : ""}`} onClick={(e) => { e.stopPropagation(); onTogglePin(); }} aria-label={item.pinned ? "Bỏ ghim" : "Ghim mục này"}>{item.pinned ? <PinOff size={17} /> : <Pin size={17} />}</button>}
        </div>

        <div className="card-title-row">
          <div>
            <h2>{item.name}</h2>
            <div className="card-meta"><time>{formatDate(item.createdAt)}</time>{item.useCount > 0 && <span>· dùng {item.useCount} lần</span>}</div>
          </div>
          {!selectionMode && <ChevronRight className="card-chevron" size={19} />}
        </div>

        <div className="collection-label"><Folder size={13} /> {item.collection}</div>
        {item.detail && <p className="detail">{item.detail}</p>}
        {item.tags.length > 0 && <div className="tag-row">{item.tags.slice(0, 3).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}{item.tags.length > 3 && <span className="tag more">+{item.tags.length - 3}</span>}</div>}

        <div className="card-status-row">
          <SyncBadge state={item.syncState} />
          {item.lastUsedAt && <span className="last-used">{formatRelative(item.lastUsedAt)}</span>}
        </div>

        {!selectionMode && <div className="actions" onClick={(e) => e.stopPropagation()}>
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
    // Migrate cache/queue V1.3 sang namespace V1.4 trước khi xóa key cũ.
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
    if (!showForm && !selected) return;
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
  }, [showForm, selected]);

  const allTags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags))).sort((a, b) => a.localeCompare(b, "vi")), [items]);
  const collections = useMemo(() => Array.from(new Set(items.map((item) => normalizeCollection(item.collection)))).sort((a, b) => a.localeCompare(b, "vi")), [items]);

  const filtered = useMemo(() => {
    const terms = parseSearchTerms(search);
    const result = items.filter((item) => {
      if (libraryMode === "archive") {
        if (!item.archived) return false;
      } else if (item.archived) return false;
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
        pinned: Boolean(form.pinned), archived: false, useCount: 0, lastUsedAt: "",
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
    const deleteOp: QueueOperation = { opId: createClientId(), type: "delete", targetId: item.id, notBefore: Date.now() + DELETE_UNDO_MS };
    writeQueue([...keepOther, deleteOp]);
    setItems((current) => current.filter((x) => x.id !== item.id));
    if (selectedId === item.id) setSelectedId(null);
    setUndoDelete({ item, previousOps });
    window.setTimeout(() => { setUndoDelete((current) => current?.item.id === item.id ? null : current); void flushQueue(); }, DELETE_UNDO_MS + 120);
  }

  function undoDeleteItem() {
    if (!undoDelete) return;
    const targetId = undoDelete.item.id;
    const withoutDelete = queueRef.current.filter((op) => !(op.targetId === targetId && op.type === "delete"));
    writeQueue([...withoutDelete, ...undoDelete.previousOps]);
    setItems((current) => [{ ...undoDelete.item, syncState: undoDelete.previousOps.length ? "pending" : "synced" }, ...current.filter((x) => x.id !== targetId)]);
    setUndoDelete(null);
    notify("Đã hoàn tác xóa");
    void flushQueue();
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
    if (mode === "delete" && !window.confirm(`Xóa ${ids.length} mục đã chọn? Thao tác hàng loạt này không có Hoàn tác.`)) return;
    const normalizedCollection = normalizeCollection(collection);
    if (mode === "delete") {
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
        return next;
      }));
    }
    enqueue({ opId: createClientId(), type: "bulk", targetId: `bulk-${Date.now()}`, targetIds: ids, bulkMode: mode, collection: normalizedCollection });
    const labels: Record<BulkMode, string> = { archive: "Đã lưu trữ", restore: "Đã khôi phục", pin: "Đã ghim", unpin: "Đã bỏ ghim", move: `Đã chuyển vào ${normalizedCollection}`, delete: "Đã xóa" };
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

  function resetAdvanced() {
    setDateFrom(""); setDateTo(""); setLinkFilter("all");
    setSearchFields({ name: true, detail: true, url: true, tags: true, collection: true });
  }

  const visibleSelectedCount = filtered.filter((item) => selectedIds.has(item.id)).length;
  const allVisibleSelected = filtered.length > 0 && visibleSelectedCount === filtered.length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">DRIVEVAULT · V1.4</div>
          <h1>Kho dùng nhanh</h1>
          <p>Tìm kiếm sâu, sắp xếp, collection và quản lý nhiều mục cùng lúc.</p>
        </div>
        <div className="top-actions">
          <button className="icon-button" aria-label="Đổi giao diện sáng tối" onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button className="icon-button" aria-label="Tải lại và đồng bộ" onClick={() => retrySync()} disabled={loading}><RefreshCcw size={19} className={loading ? "spin" : ""} /></button>
        </div>
      </header>

      <div className={`network-strip ${online ? "online" : "offline"}`}>
        {online ? <Cloud size={15} /> : <WifiOff size={15} />}
        <span>{online ? (pendingCount ? `${pendingCount} thao tác đang chờ đồng bộ` : "Đã kết nối · dữ liệu được đồng bộ") : `${pendingCount} thao tác lưu offline`}</span>
        {pendingCount > 0 && online && <button onClick={() => retrySync()}>Đồng bộ ngay</button>}
      </div>

      <section className="summary-strip summary-four">
        <div><strong>{items.filter((x) => !x.archived).length}</strong><span>Đang dùng</span></div>
        <div><strong>{items.filter((x) => x.pinned && !x.archived).length}</strong><span>Đã ghim</span></div>
        <div><strong>{collections.length}</strong><span>Collection</span></div>
        <div><strong>{items.filter((x) => x.archived).length}</strong><span>Lưu trữ</span></div>
      </section>

      <section className="toolbar">
        <div className="search-row">
          <label className="searchbox"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Tìm kiếm... dùng "cụm từ" để khớp chính xác' /></label>
          <button className={`filter-toggle ${advancedOpen ? "active" : ""}`} onClick={() => setAdvancedOpen((v) => !v)} aria-label="Tìm kiếm nâng cao"><SlidersHorizontal size={18} /></button>
        </div>

        {advancedOpen && <div className="advanced-panel">
          <div className="advanced-title"><strong>Tìm kiếm nâng cao</strong><button onClick={resetAdvanced}>Đặt lại</button></div>
          <div className="field-grid">
            {([['name','Tên'],['detail','Nội dung'],['url','Link'],['tags','Tag'],['collection','Collection']] as [SearchField,string][]).map(([key,label]) => (
              <label key={key} className="check-pill"><input type="checkbox" checked={searchFields[key]} onChange={(e) => setSearchFields((current) => ({ ...current, [key]: e.target.checked }))} />{label}</label>
            ))}
          </div>
          <div className="advanced-grid">
            <label>Từ ngày<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
            <label>Đến ngày<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
            <label>Liên kết<select value={linkFilter} onChange={(e) => setLinkFilter(e.target.value as LinkFilter)}><option value="all">Tất cả</option><option value="with">Có link</option><option value="without">Không có link</option></select></label>
          </div>
        </div>}

        <div className="mode-tabs mode-five" role="tablist" aria-label="Chế độ thư viện">
          {([['all','Tất cả'],['pinned','Đã ghim'],['recent','Gần đây'],['frequent','Dùng nhiều'],['archive','Lưu trữ']] as [LibraryMode,string][]).map(([key,label]) => <button key={key} className={libraryMode === key ? "active" : ""} onClick={() => { setLibraryMode(key); setSelectedIds(new Set()); }}>{key === "pinned" && <Star size={14} />}{key === "archive" && <Archive size={14} />}{label}</button>)}
        </div>

        <div className="organize-row">
          <label className="sort-select"><ArrowDownAZ size={16} /><select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}><option value="smart">Sắp xếp thông minh</option><option value="newest">Mới nhất</option><option value="oldest">Cũ nhất</option><option value="name-az">Tên A → Z</option><option value="name-za">Tên Z → A</option><option value="recent">Dùng gần đây</option><option value="frequent">Dùng nhiều nhất</option></select></label>
          <button className={`selection-toggle ${selectionMode ? "active" : ""}`} onClick={() => selectionMode ? exitSelection() : setSelectionMode(true)}><CheckSquare2 size={16} />{selectionMode ? "Hủy chọn" : "Chọn nhiều"}</button>
        </div>

        {selectionMode && <div className="selection-head"><span>Đã chọn <strong>{selectedIds.size}</strong></span><button onClick={() => setSelectedIds(allVisibleSelected ? new Set() : new Set(filtered.map((item) => item.id)))}>{allVisibleSelected ? "Bỏ chọn tất cả" : `Chọn tất cả (${filtered.length})`}</button></div>}

        <div className="chips" role="tablist" aria-label="Lọc loại lưu trữ">
          {(["all", "media", "content", "other"] as const).map((key) => <button key={key} className={`chip ${typeFilter === key ? "active" : ""}`} onClick={() => setTypeFilter(key)}>{key === "all" ? "Tất cả loại" : typeMeta[key].label}</button>)}
        </div>

        {collections.length > 0 && <div className="collection-filter"><button className={selectedCollection === "all" ? "active" : ""} onClick={() => setSelectedCollection("all")}><Folder size={13}/> Tất cả collection</button>{collections.map((name) => <button key={name} className={selectedCollection === name ? "active" : ""} onClick={() => setSelectedCollection(name)}><Folder size={13}/>{name}</button>)}</div>}
        {allTags.length > 0 && <div className="tag-filter"><button className={selectedTag === "all" ? "active" : ""} onClick={() => setSelectedTag("all")}># Tất cả tag</button>{allTags.map((tag) => <button key={tag} className={selectedTag === tag ? "active" : ""} onClick={() => setSelectedTag(tag)}>#{tag}</button>)}</div>}
      </section>

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
            onEdit={() => openEdit(item)}
            onDelete={() => deleteItem(item)}
            onCopy={() => copyItem(item)}
            onOpenUrl={() => recordUsage(item)}
            onTogglePin={() => togglePin(item)}
            selectionMode={selectionMode}
            checked={selectedIds.has(item.id)}
            onSelect={() => toggleSelection(item.id)}
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
          <button onClick={() => applyBulkAction("pin")}><Pin size={16}/> Ghim</button>
          <button onClick={() => applyBulkAction("unpin")}><PinOff size={16}/> Bỏ ghim</button>
          {libraryMode === "archive" ? <button onClick={() => applyBulkAction("restore")}><ArchiveRestore size={16}/> Khôi phục</button> : <button onClick={() => applyBulkAction("archive")}><Archive size={16}/> Lưu trữ</button>}
          <label className="bulk-move"><FolderInput size={16}/><input list="bulk-collection-options" value={bulkCollection} onChange={(e) => setBulkCollection(e.target.value)} placeholder="Collection"/><datalist id="bulk-collection-options">{collections.map((name) => <option key={name} value={name}/>)}</datalist><button onClick={() => applyBulkAction("move")}>Chuyển</button></label>
          <button className="danger-action" onClick={() => applyBulkAction("delete")}><Trash2 size={16}/> Xóa</button>
        </div>
      </div>}

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
              <label>Collection<input list="collection-options" maxLength={80} value={form.collection || ""} onChange={(e) => setForm((f) => ({ ...f, collection: e.target.value }))} placeholder="VD: Công việc" /><datalist id="collection-options">{collections.map((name) => <option key={name} value={name}/>)}</datalist></label>
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
              <div className="detail-head-actions"><button className={`pin-button ${selected.pinned ? "active" : ""}`} onClick={() => togglePin(selected)} aria-label={selected.pinned ? "Bỏ ghim" : "Ghim"}>{selected.pinned ? <PinOff size={18}/> : <Pin size={18}/>}</button><button className="icon-button" onClick={() => setSelectedId(null)}><X size={20}/></button></div>
            </div>
            <div className="detail-content">
              <h2 id="detail-title">{selected.name}</h2>
              <div className="collection-label detail-collection"><Folder size={14}/>{selected.collection}{selected.archived && <span><Archive size={13}/> Đã lưu trữ</span>}</div>
              <div className="detail-date">Đã lưu {formatDate(selected.createdAt)} · đã dùng {selected.useCount} lần{selected.lastUsedAt ? ` · ${formatRelative(selected.lastUsedAt)}` : ""}</div>
              <SyncBadge state={selected.syncState} />
              {selected.tags.length > 0 && <div className="tag-row detail-tags">{selected.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</div>}
              {selected.detail ? <div className="full-detail">{selected.detail}</div> : <div className="no-detail">Không có nội dung chi tiết.</div>}
              {selected.url && <div className="url-preview">{selected.url}</div>}
            </div>
            <div className="detail-actions detail-actions-v14">
              {selected.detail && <button className="secondary" onClick={() => copyItem(selected)}><Clipboard size={18}/> Sao chép</button>}
              {selected.url && <a className="primary" href={selected.url} target="_blank" rel="noreferrer" onClick={() => recordUsage(selected)}><ExternalLink size={18}/> Truy cập Drive</a>}
              <button className="secondary" onClick={() => openEdit(selected)}><Pencil size={18}/> Sửa</button>
              <button className="secondary" onClick={() => archiveItem(selected)}>{selected.archived ? <ArchiveRestore size={18}/> : <Archive size={18}/>} {selected.archived ? "Khôi phục" : "Lưu trữ"}</button>
            </div>
          </section>
        </div>
      )}

      {undoDelete && <div className="undo-toast"><span>Đã xóa “{undoDelete.item.name}”</span><button onClick={undoDeleteItem}><Undo2 size={16}/> Hoàn tác</button></div>}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
