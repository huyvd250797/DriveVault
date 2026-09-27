"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,

  ChevronRight,
  Clipboard,
  Cloud,
  CloudOff,
  ExternalLink,
  FileText,
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
  Star,
  Sun,
  Trash2,
  Undo2,
  WifiOff,
  X,
} from "lucide-react";
import type { CreateVaultItem, StorageType, SyncState, VaultItem } from "@/lib/types";

const CACHE_KEY = "drivevault-v130-items";
const QUEUE_KEY = "drivevault-v130-sync-queue";
const DELETE_UNDO_MS = 5000;

type LibraryMode = "all" | "pinned" | "recent" | "frequent";
type QueueOperation = {
  opId: string;
  type: "create" | "update" | "delete" | "pin" | "use";
  targetId: string;
  item?: VaultItem;
  pinned?: boolean;
  useCount?: number;
  lastUsedAt?: string;
  notBefore?: number;
  error?: string;
};

type UndoDeleteState = {
  item: VaultItem;
  previousOps: QueueOperation[];
};

const typeMeta: Record<StorageType, { label: string; icon: typeof ImageIcon; className: string }> = {
  media: { label: "Ảnh / Video", icon: ImageIcon, className: "badge-media" },
  content: { label: "Nội dung", icon: FileText, className: "badge-content" },
  other: { label: "Khác", icon: Layers3, className: "badge-other" },
};

const emptyForm: CreateVaultItem = { type: "content", name: "", detail: "", url: "", tags: [] };

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
  return Array.from(new Set(source.map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
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
    syncState: item.syncState || "synced",
  };
}

function readLocalItems(): VaultItem[] {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(withDefaults) : [];
  } catch {
    return [];
  }
}

function readQueue(): QueueOperation[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function applyQueueToItems(remoteItems: VaultItem[], queue: QueueOperation[]) {
  const map = new Map(remoteItems.map((item) => [item.id, { ...withDefaults(item), syncState: "synced" as SyncState }]));
  for (const op of queue) {
    const state: SyncState = op.error ? "error" : "pending";
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
}: {
  item: VaultItem;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onOpenUrl: () => void;
  onTogglePin: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef<number | null>(null);
  const startOffset = useRef(0);
  const moved = useRef(false);
  const meta = typeMeta[item.type] || typeMeta.other;
  const Icon = meta.icon;
  const actionsVisible = offset < -2;

  function pointerDown(e: React.PointerEvent) {
    startX.current = e.clientX;
    startOffset.current = offset;
    moved.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function pointerMove(e: React.PointerEvent) {
    if (startX.current === null) return;
    const delta = e.clientX - startX.current;
    if (Math.abs(delta) > 7) moved.current = true;
    setOffset(Math.max(-142, Math.min(0, startOffset.current + delta)));
  }

  function pointerUp() {
    if (startX.current === null) return;
    setOffset(offset < -48 ? -132 : 0);
    startX.current = null;
  }

  return (
    <div className="swipe-row">
      <div className={`swipe-actions ${actionsVisible ? "visible" : ""}`} aria-hidden={!actionsVisible}>
        <button className="swipe-edit" tabIndex={actionsVisible ? 0 : -1} aria-label={`Sửa ${item.name}`} onClick={() => { setOffset(0); onEdit(); }}>
          <Pencil size={19} /><span>Sửa</span>
        </button>
        <button className="swipe-delete" tabIndex={actionsVisible ? 0 : -1} aria-label={`Xóa ${item.name}`} onClick={() => { setOffset(0); onDelete(); }}>
          <Trash2 size={19} /><span>Xóa</span>
        </button>
      </div>

      <article
        className={`card swipe-card ${item.pinned ? "is-pinned" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onClick={() => {
          if (moved.current) return;
          if (offset !== 0) return setOffset(0);
          onOpen();
        }}
      >
        <div className="card-head">
          <div className="card-head-left">
            <span className={`badge ${meta.className}`}><Icon size={14} />{meta.label}</span>
            {item.pinned && <span className="pin-label"><Pin size={12} /> Ghim</span>}
          </div>
          <button className={`pin-button ${item.pinned ? "active" : ""}`} onClick={(e) => { e.stopPropagation(); onTogglePin(); }} aria-label={item.pinned ? "Bỏ ghim" : "Ghim mục này"}>
            {item.pinned ? <PinOff size={17} /> : <Pin size={17} />}
          </button>
        </div>

        <div className="card-title-row">
          <div>
            <h2>{item.name}</h2>
            <div className="card-meta"><time>{formatDate(item.createdAt)}</time>{item.useCount > 0 && <span>· dùng {item.useCount} lần</span>}</div>
          </div>
          <ChevronRight className="card-chevron" size={19} />
        </div>

        {item.detail && <p className="detail">{item.detail}</p>}
        {item.tags.length > 0 && <div className="tag-row">{item.tags.slice(0, 3).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}{item.tags.length > 3 && <span className="tag more">+{item.tags.length - 3}</span>}</div>}

        <div className="card-status-row">
          <SyncBadge state={item.syncState} />
          {item.lastUsedAt && <span className="last-used">{formatRelative(item.lastUsedAt)}</span>}
        </div>

        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {item.detail && <button className="secondary" onClick={onCopy}><Clipboard size={17} /> Sao chép</button>}
          {item.url && <a className="primary" href={item.url} target="_blank" rel="noreferrer" onClick={onOpenUrl}><ExternalLink size={17} /> Truy cập</a>}
        </div>
      </article>
    </div>
  );
}

export default function DriveVaultApp() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | StorageType>("all");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("all");
  const [selectedTag, setSelectedTag] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [form, setForm] = useState<CreateVaultItem>(emptyForm);
  const [tagText, setTagText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<VaultItem | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [floatingActive, setFloatingActive] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [undoDelete, setUndoDelete] = useState<UndoDeleteState | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  const scrollIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<QueueOperation[]>([]);
  const itemsRef = useRef<VaultItem[]>([]);
  const flushingRef = useRef(false);

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
        setItems((current) => current.map((item) => item.id === op.targetId ? { ...item, syncState: "syncing" } : item));
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
          } else {
            response = await fetch("/api/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "use", id: op.targetId, useCount: op.useCount, lastUsedAt: op.lastUsedAt }) });
          }
          const data = await readJsonResponse(response);
          if (!response.ok || !data.ok) throw new Error(data.error || "Đồng bộ thất bại.");

          // Luôn thao tác trên queue hiện tại để không làm rơi thao tác mới được thêm trong lúc request đang chạy.
          const nextQueue = queueRef.current.filter((x) => x.opId !== op.opId);
          writeQueue(nextQueue);
          const stillPending = nextQueue.some((x) => x.targetId === op.targetId);
          if ((op.type === "create" || op.type === "update") && data.item) {
            setItems((current) => current.map((item) => {
              if (item.id !== op.targetId) return item;
              const serverItem = withDefaults(data.item);
              // Nếu còn thao tác local chờ sau create/update, giữ metadata mới nhất trên UI thay vì bị response cũ ghi đè.
              return stillPending
                ? { ...serverItem, pinned: item.pinned, useCount: item.useCount, lastUsedAt: item.lastUsedAt, syncState: "pending" }
                : { ...serverItem, syncState: "synced" };
            }));
          } else {
            setItems((current) => current.map((item) => item.id === op.targetId ? { ...item, syncState: stillPending ? "pending" : "synced" } : item));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Không đồng bộ được dữ liệu.";
          const failedQueue = queueRef.current.map((x) => x.opId === op.opId ? { ...x, error: message } : x);
          writeQueue(failedQueue);
          setItems((current) => current.map((item) => item.id === op.targetId ? { ...item, syncState: "error" } : item));
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, []);

  function enqueue(op: QueueOperation) {
    const next = [...queueRef.current, op];
    writeQueue(next);
    void flushQueue();
  }

  useEffect(() => {
    queueRef.current = readQueue();
    setPendingCount(queueRef.current.length);
    const cached = readLocalItems();
    if (cached.length) setItems(applyQueueToItems(cached, queueRef.current));
    setOnline(navigator.onLine);
    setStorageReady(true);
    void flushQueue().then(() => loadItems(Boolean(cached.length)));
  }, [flushQueue, loadItems]);

  useEffect(() => {
    itemsRef.current = items;
    if (!storageReady) return;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  }, [items, storageReady]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      notify("Đã có mạng · đang đồng bộ");
      void flushQueue().then(() => loadItems(true));
    };
    const onOffline = () => {
      setOnline(false);
      notify("Đang offline · dữ liệu sẽ được xếp hàng");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
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
      scrollIdleTimer.current = setTimeout(() => setFloatingActive(false), 500);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollIdleTimer.current) clearTimeout(scrollIdleTimer.current);
    };
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
    return () => {
      Object.assign(body.style, previous);
      window.scrollTo(0, scrollY);
    };
  }, [showForm, selected]);

  const allTags = useMemo(() => Array.from(new Set<string>(items.flatMap((item) => item.tags))).sort((a, b) => a.localeCompare(b, "vi")), [items]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const result = items.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (libraryMode === "pinned" && !item.pinned) return false;
      if (selectedTag !== "all" && !item.tags.includes(selectedTag)) return false;
      if (!keyword) return true;
      return `${item.name} ${item.detail} ${item.url} ${item.tags.join(" ")}`.toLowerCase().includes(keyword);
    });

    return result.sort((a, b) => {
      if (libraryMode === "recent") return String(b.lastUsedAt || b.createdAt).localeCompare(String(a.lastUsedAt || a.createdAt));
      if (libraryMode === "frequent") return (b.useCount - a.useCount) || String(b.lastUsedAt || b.createdAt).localeCompare(String(a.lastUsedAt || a.createdAt));
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }, [items, typeFilter, libraryMode, selectedTag, search]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setTagText("");
    setError("");
    setShowForm(true);
  }

  function openEdit(item: VaultItem) {
    setEditingId(item.id);
    setForm({ type: item.type, name: item.name, detail: item.detail, url: item.url, tags: item.tags, pinned: item.pinned });
    setTagText(item.tags.join(", "));
    setSelected(null);
    setError("");
    setShowForm(true);
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const detail = form.detail?.trim() || "";
    const url = normalizeUrl(form.url || "");
    const tags = normalizeTags(tagText);
    if (!name) return setError("Vui lòng nhập tên.");
    if (form.type === "media" && !url) return setError("Ảnh / Video cần link Google Drive hợp lệ.");
    if (form.type === "content" && !detail) return setError("Vui lòng nhập nội dung chi tiết.");
    if (form.type === "other" && !detail && !url) return setError("Loại Khác cần ít nhất nội dung hoặc đường link.");

    setError("");
    const now = new Date().toISOString();

    if (!editingId) {
      const optimisticItem: VaultItem = {
        id: createClientId(), type: form.type, name, detail, url, tags,
        pinned: Boolean(form.pinned), useCount: 0, lastUsedAt: "",
        createdAt: now, updatedAt: now, syncState: "pending",
      };
      setItems((current) => [optimisticItem, ...current]);
      setForm(emptyForm);
      setTagText("");
      setShowForm(false);
      enqueue({ opId: createClientId(), type: "create", targetId: optimisticItem.id, item: optimisticItem });
      notify(online ? "Đã thêm · đang đồng bộ" : "Đã lưu offline · chờ đồng bộ");
      return;
    }

    const current = items.find((item) => item.id === editingId);
    if (!current) return setError("Không tìm thấy dữ liệu cần sửa.");
    const updated: VaultItem = { ...current, type: form.type, name, detail, url, tags, updatedAt: now, syncState: "pending" };
    setSaving(true);
    setItems((list) => list.map((item) => item.id === editingId ? updated : item));
    setForm(emptyForm);
    setTagText("");
    setEditingId(null);
    setShowForm(false);
    enqueue({ opId: createClientId(), type: "update", targetId: updated.id, item: updated });
    setSaving(false);
    notify(online ? "Đã cập nhật · đang đồng bộ" : "Đã cập nhật offline");
  }

  function togglePin(item: VaultItem) {
    const latest = itemsRef.current.find((x) => x.id === item.id) || item;
    const pinned = !latest.pinned;
    setItems((current) => current.map((x) => x.id === item.id ? { ...x, pinned, syncState: "pending" } : x));
    if (selected?.id === item.id) setSelected((current) => current ? { ...current, pinned, syncState: "pending" } : current);
    enqueue({ opId: createClientId(), type: "pin", targetId: item.id, pinned });
    notify(pinned ? "Đã ghim lên đầu" : "Đã bỏ ghim");
  }

  function recordUsage(item: VaultItem) {
    const latest = itemsRef.current.find((x) => x.id === item.id) || item;
    const now = new Date().toISOString();
    const useCount = latest.useCount + 1;
    setItems((current) => current.map((x) => x.id === item.id ? { ...x, useCount, lastUsedAt: now, syncState: "pending" } : x));
    if (selected?.id === item.id) setSelected((current) => current ? { ...current, useCount, lastUsedAt: now, syncState: "pending" } : current);
    enqueue({ opId: createClientId(), type: "use", targetId: item.id, useCount, lastUsedAt: now });
  }

  async function copyItem(item: VaultItem) {
    if (!item.detail) return;
    await navigator.clipboard.writeText(item.detail);
    recordUsage(item);
    notify("Đã sao chép nội dung");
  }

  function deleteItem(item: VaultItem) {
    const previousOps = queueRef.current.filter((op) => op.targetId === item.id);
    const keepOther = queueRef.current.filter((op) => op.targetId !== item.id);
    // Delete backend là idempotent: luôn xếp delete để dọn cả trường hợp create đã ghi server nhưng client timeout.
    const deleteOp: QueueOperation = {
      opId: createClientId(), type: "delete", targetId: item.id, notBefore: Date.now() + DELETE_UNDO_MS,
    };
    writeQueue([...keepOther, deleteOp]);
    setItems((current) => current.filter((x) => x.id !== item.id));
    if (selected?.id === item.id) setSelected(null);
    setUndoDelete({ item, previousOps });
    window.setTimeout(() => {
      setUndoDelete((current) => current?.item.id === item.id ? null : current);
      void flushQueue();
    }, DELETE_UNDO_MS + 120);
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

  async function retrySync() {
    const cleared = queueRef.current.map((op) => ({ ...op, error: undefined }));
    writeQueue(cleared);
    setItems((current) => current.map((item) => cleared.some((op) => op.targetId === item.id) ? { ...item, syncState: "pending" } : item));
    await flushQueue();
    await loadItems(true);
    notify(queueRef.current.length ? "Vẫn còn mục chờ đồng bộ" : "Đã đồng bộ xong");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">DRIVEVAULT · V1.3</div>
          <h1>Kho dùng nhanh</h1>
          <p>Ghim, gắn tag, tìm lại nội dung hay dùng và tiếp tục làm việc ngay cả khi mất mạng.</p>
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

      <section className="summary-strip">
        <div><strong>{items.length}</strong><span>Tổng mục</span></div>
        <div><strong>{items.filter((x) => x.pinned).length}</strong><span>Đã ghim</span></div>
        <div><strong>{items.reduce((sum, x) => sum + x.useCount, 0)}</strong><span>Lượt sử dụng</span></div>
      </section>

      <section className="toolbar">
        <label className="searchbox"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên, nội dung hoặc tag..." /></label>

        <div className="mode-tabs" role="tablist" aria-label="Chế độ thư viện">
          {([
            ["all", "Tất cả"], ["pinned", "Đã ghim"], ["recent", "Gần đây"], ["frequent", "Dùng nhiều"],
          ] as const).map(([key, label]) => <button key={key} className={libraryMode === key ? "active" : ""} onClick={() => setLibraryMode(key)}>{key === "pinned" && <Star size={14} />}{label}</button>)}
        </div>

        <div className="chips" role="tablist" aria-label="Lọc loại lưu trữ">
          {(["all", "media", "content", "other"] as const).map((key) => <button key={key} className={`chip ${typeFilter === key ? "active" : ""}`} onClick={() => setTypeFilter(key)}>{key === "all" ? "Tất cả loại" : typeMeta[key].label}</button>)}
        </div>

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
            onOpen={() => setSelected(item)}
            onEdit={() => openEdit(item)}
            onDelete={() => deleteItem(item)}
            onCopy={() => copyItem(item)}
            onOpenUrl={() => recordUsage(item)}
            onTogglePin={() => togglePin(item)}
          />
        ))}
      </section>

      <div className={`floating-controls ${floatingActive ? "active" : "idle"}`}>
        {showScrollTop && <button className="scroll-top-button" aria-label="Lên đầu trang" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><ArrowUp size={20} /></button>}
        <button className="fab" onClick={openCreate} aria-label="Thêm mới"><Plus size={22} /></button>
      </div>

      {showForm && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setShowForm(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title">
            <div className="sheet-handle" />
            <div className="modal-head">
              <div><div className="eyebrow">{editingId ? "CHỈNH SỬA" : "MỤC LƯU TRỮ MỚI"}</div><h2 id="form-title">{editingId ? "Cập nhật dữ liệu" : "Thêm mới"}</h2></div>
              <button className="icon-button" onClick={() => setShowForm(false)} disabled={saving}><X size={20}/></button>
            </div>
            <form onSubmit={saveItem}>
              <label>Loại lưu trữ
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as StorageType }))}>
                  <option value="media">Ảnh / Video</option><option value="content">Nội dung</option><option value="other">Khác</option>
                </select>
              </label>
              <label>Tên
                <input maxLength={120} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="VD: Bộ ảnh sự kiện tháng 9" />
              </label>
              <label>Tag <small>(phân cách bằng dấu phẩy)</small>
                <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="VD: công việc, email, mẫu" />
              </label>
              <label>Nội dung chi tiết {form.type === "media" && <small>(không bắt buộc)</small>}{form.type === "other" && <small>(không bắt buộc nếu có link)</small>}
                <textarea rows={7} value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} placeholder={form.type === "media" ? "Mô tả ảnh/video, ghi chú, nội dung liên quan..." : "Nhập nội dung cần lưu để sao chép nhanh..."} />
              </label>
              {(form.type === "media" || form.type === "other") && <label>Đường link Google Drive {form.type === "other" && <small>(không bắt buộc)</small>}
                <input inputMode="url" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://drive.google.com/..." />
              </label>}
              <button className="save" disabled={saving}>{saving ? <Loader2 size={18} className="spin" /> : editingId ? <Pencil size={18}/> : <Plus size={18}/>} {saving ? "Đang lưu..." : editingId ? "Lưu thay đổi" : "Lưu mục"}</button>
            </form>
          </section>
        </div>
      )}

      {selected && (
        <div className="modal-backdrop detail-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <section className="modal detail-sheet" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <div className="sheet-handle" />
            <div className="modal-head detail-modal-head">
              <span className={`badge ${typeMeta[selected.type].className}`}>{(() => { const I = typeMeta[selected.type].icon; return <I size={14}/>; })()}{typeMeta[selected.type].label}</span>
              <div className="detail-head-actions">
                <button className={`pin-button ${selected.pinned ? "active" : ""}`} onClick={() => togglePin(selected)} aria-label={selected.pinned ? "Bỏ ghim" : "Ghim"}>{selected.pinned ? <PinOff size={18}/> : <Pin size={18}/>}</button>
                <button className="icon-button" onClick={() => setSelected(null)}><X size={20}/></button>
              </div>
            </div>
            <div className="detail-content">
              <h2 id="detail-title">{selected.name}</h2>
              <div className="detail-date">Đã lưu {formatDate(selected.createdAt)} · đã dùng {selected.useCount} lần{selected.lastUsedAt ? ` · ${formatRelative(selected.lastUsedAt)}` : ""}</div>
              <SyncBadge state={selected.syncState} />
              {selected.tags.length > 0 && <div className="tag-row detail-tags">{selected.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</div>}
              {selected.detail ? <div className="full-detail">{selected.detail}</div> : <div className="no-detail">Không có nội dung chi tiết.</div>}
              {selected.url && <div className="url-preview">{selected.url}</div>}
            </div>
            <div className="detail-actions">
              {selected.detail && <button className="secondary" onClick={() => copyItem(selected)}><Clipboard size={18}/> Sao chép</button>}
              {selected.url && <a className="primary" href={selected.url} target="_blank" rel="noreferrer" onClick={() => recordUsage(selected)}><ExternalLink size={18}/> Truy cập Drive</a>}
              <button className="secondary" onClick={() => openEdit(selected)}><Pencil size={18}/> Sửa</button>
            </div>
          </section>
        </div>
      )}

      {undoDelete && <div className="undo-toast"><span>Đã xóa “{undoDelete.item.name}”</span><button onClick={undoDeleteItem}><Undo2 size={16}/> Hoàn tác</button></div>}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
