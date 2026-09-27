"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clipboard,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Moon,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Sun,
  Trash2,
  X,
  ChevronRight,
} from "lucide-react";
import type { CreateVaultItem, StorageType, VaultItem } from "@/lib/types";

const typeMeta: Record<StorageType, { label: string; icon: typeof ImageIcon; className: string }> = {
  media: { label: "Ảnh / Video", icon: ImageIcon, className: "badge-media" },
  content: { label: "Nội dung", icon: FileText, className: "badge-content" },
  other: { label: "Khác", icon: Layers3, className: "badge-other" },
};

const emptyForm: CreateVaultItem = { type: "content", name: "", detail: "", url: "" };

function normalizeUrl(value: string) {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function formatDate(value: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function SwipeCard({
  item,
  onOpen,
  onEdit,
  onDelete,
  onCopy,
}: {
  item: VaultItem;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef<number | null>(null);
  const startOffset = useRef(0);
  const moved = useRef(false);
  const meta = typeMeta[item.type] || typeMeta.other;
  const Icon = meta.icon;

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
    const next = Math.max(-142, Math.min(0, startOffset.current + delta));
    setOffset(next);
  }

  function pointerUp() {
    if (startX.current === null) return;
    setOffset(offset < -48 ? -132 : 0);
    startX.current = null;
  }

  return (
    <div className="swipe-row">
      <div className="swipe-actions" aria-hidden={offset === 0}>
        <button
          className="swipe-edit"
          aria-label={`Sửa ${item.name}`}
          onClick={() => { setOffset(0); onEdit(); }}
        >
          <Pencil size={19} />
          <span>Sửa</span>
        </button>
        <button
          className="swipe-delete"
          aria-label={`Xóa ${item.name}`}
          onClick={() => { setOffset(0); onDelete(); }}
        >
          <Trash2 size={19} />
          <span>Xóa</span>
        </button>
      </div>

      <article
        className="card swipe-card"
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
          <span className={`badge ${meta.className}`}><Icon size={14} />{meta.label}</span>
          <time>{formatDate(item.createdAt)}</time>
        </div>
        <div className="card-title-row">
          <h2>{item.name}</h2>
          <ChevronRight className="card-chevron" size={19} />
        </div>
        {item.detail && <p className="detail">{item.detail}</p>}
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {item.detail && (
            <button className="secondary" onClick={onCopy}>
              <Clipboard size={17} /> Sao chép
            </button>
          )}
          {item.url && (
            <a className="primary" href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink size={17} /> Truy cập
            </a>
          )}
        </div>
      </article>
    </div>
  );
}

export default function DriveVaultApp() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [filter, setFilter] = useState<"all" | StorageType>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [toast, setToast] = useState("");
  const [form, setForm] = useState<CreateVaultItem>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<VaultItem | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/items", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Không tải được dữ liệu.");
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    const saved = window.localStorage.getItem("drivevault-theme") as "light" | "dark" | null;
    const preferred = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
    setTheme(saved || preferred);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("drivevault-theme", theme);
  }, [theme]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.type !== filter) return false;
      if (!keyword) return true;
      return `${item.name} ${item.detail} ${item.url}`.toLowerCase().includes(keyword);
    });
  }, [items, filter, search]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  }

  async function copyText(text: string) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    notify("Đã sao chép nội dung");
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  }

  function openEdit(item: VaultItem) {
    setEditingId(item.id);
    setForm({ type: item.type, name: item.name, detail: item.detail, url: item.url });
    setSelected(null);
    setError("");
    setShowForm(true);
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const detail = form.detail?.trim() || "";
    const url = normalizeUrl(form.url || "");
    if (!name) return setError("Vui lòng nhập tên.");
    if (form.type === "media" && !url) return setError("Ảnh / Video cần link Google Drive hợp lệ.");
    if (form.type === "content" && !detail) return setError("Vui lòng nhập nội dung chi tiết.");
    if (form.type === "other" && !detail && !url) return setError("Loại Khác cần ít nhất nội dung hoặc đường link.");

    setSaving(true);
    setError("");
    try {
      const payload = { id: editingId || undefined, type: form.type, name, detail, url };
      const response = await fetch("/api/items", {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.item) throw new Error(data.error || "Không lưu được dữ liệu.");

      // V1.1.0: cập nhật danh sách ngay bằng record backend trả về, không GET lại toàn bộ Google Sheet.
      if (editingId) {
        setItems((current) => current.map((item) => item.id === editingId ? data.item : item));
        notify("Đã cập nhật");
      } else {
        setItems((current) => [data.item, ...current]);
        notify("Đã lưu");
      }
      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được dữ liệu.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(item: VaultItem) {
    const accepted = window.confirm(`Xóa “${item.name}”? Thao tác này sẽ xóa dữ liệu khỏi Google Sheet.`);
    if (!accepted) return;
    setDeletingId(item.id);
    setError("");
    try {
      const response = await fetch("/api/items", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Không xóa được dữ liệu.");
      setItems((current) => current.filter((x) => x.id !== item.id));
      if (selected?.id === item.id) setSelected(null);
      notify("Đã xóa");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xóa được dữ liệu.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">DRIVEVAULT · V1.1</div>
          <h1>Kho dùng nhanh</h1>
          <p>Lưu nội dung và link Drive để mở hoặc sao chép chỉ trong vài giây.</p>
        </div>
        <div className="top-actions">
          <button className="icon-button" aria-label="Đổi giao diện sáng tối" onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button className="icon-button" aria-label="Tải lại" onClick={loadItems} disabled={loading}>
            <RefreshCcw size={19} className={loading ? "spin" : ""} />
          </button>
        </div>
      </header>

      <section className="summary-strip">
        <div><strong>{items.length}</strong><span>Tổng mục</span></div>
        <div><strong>{items.filter((x) => x.type === "media").length}</strong><span>Ảnh / Video</span></div>
        <div><strong>{items.filter((x) => x.type === "content").length}</strong><span>Nội dung</span></div>
      </section>

      <section className="toolbar">
        <label className="searchbox">
          <Search size={18} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm nhanh trong kho..." />
        </label>
        <div className="chips" role="tablist" aria-label="Lọc loại lưu trữ">
          {(["all", "media", "content", "other"] as const).map((key) => (
            <button key={key} className={`chip ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>
              {key === "all" ? "Tất cả" : typeMeta[key].label}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="alert">{error}</div>}

      <section className="list" aria-live="polite">
        {loading ? (
          <div className="state"><Loader2 className="spin" /><span>Đang tải dữ liệu...</span></div>
        ) : filtered.length === 0 ? (
          <div className="empty"><Layers3 size={34} /><strong>Chưa có dữ liệu phù hợp</strong><span>Bấm “Thêm mới” để tạo mục lưu trữ.</span></div>
        ) : filtered.map((item) => (
          <SwipeCard
            key={item.id}
            item={item}
            onOpen={() => setSelected(item)}
            onEdit={() => openEdit(item)}
            onDelete={() => deleteItem(item)}
            onCopy={() => copyText(item.detail)}
          />
        ))}
      </section>

      <button className="fab" onClick={openCreate}><Plus size={22} /> Thêm mới</button>

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
                  <option value="media">Ảnh / Video</option>
                  <option value="content">Nội dung</option>
                  <option value="other">Khác</option>
                </select>
              </label>
              <label>Tên
                <input maxLength={120} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="VD: Bộ ảnh sự kiện tháng 9" />
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
              <span className={`badge ${typeMeta[selected.type].className}`}>
                {(() => { const I = typeMeta[selected.type].icon; return <I size={14}/>; })()}
                {typeMeta[selected.type].label}
              </span>
              <button className="icon-button" onClick={() => setSelected(null)}><X size={20}/></button>
            </div>
            <div className="detail-content">
              <h2 id="detail-title">{selected.name}</h2>
              <div className="detail-date">Đã lưu {formatDate(selected.createdAt)}</div>
              {selected.detail ? <div className="full-detail">{selected.detail}</div> : <div className="no-detail">Không có nội dung chi tiết.</div>}
              {selected.url && <div className="url-preview">{selected.url}</div>}
            </div>
            <div className="detail-actions">
              {selected.detail && <button className="secondary" onClick={() => copyText(selected.detail)}><Clipboard size={18}/> Sao chép</button>}
              {selected.url && <a className="primary" href={selected.url} target="_blank" rel="noreferrer"><ExternalLink size={18}/> Truy cập Drive</a>}
              <button className="secondary" onClick={() => openEdit(selected)}><Pencil size={18}/> Sửa</button>
            </div>
          </section>
        </div>
      )}

      {deletingId && <div className="busy-pill"><Loader2 size={15} className="spin" /> Đang xóa...</div>}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
