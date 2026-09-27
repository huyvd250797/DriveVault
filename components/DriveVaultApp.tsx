"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clipboard, ExternalLink, FileText, Image as ImageIcon, Layers3, Loader2, Plus, RefreshCcw, Search, X } from "lucide-react";
import type { CreateVaultItem, StorageType, VaultItem } from "@/lib/types";

const typeMeta: Record<StorageType, { label: string; icon: typeof ImageIcon; className: string }> = {
  media: { label: "Ảnh / Video", icon: ImageIcon, className: "badge-media" },
  content: { label: "Nội dung", icon: FileText, className: "badge-content" },
  other: { label: "Khác", icon: Layers3, className: "badge-other" },
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

export default function DriveVaultApp() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [filter, setFilter] = useState<"all" | StorageType>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [form, setForm] = useState<CreateVaultItem>({ type: "content", name: "", detail: "", url: "" });

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

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.type !== filter) return false;
      if (!keyword) return true;
      return `${item.name} ${item.detail}`.toLowerCase().includes(keyword);
    });
  }, [items, filter, search]);

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    setToast("Đã sao chép nội dung");
    window.setTimeout(() => setToast(""), 1800);
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
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: form.type, name, detail, url }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Không lưu được dữ liệu.");
      setForm({ type: "content", name: "", detail: "", url: "" });
      setShowForm(false);
      setToast("Đã lưu vào Google Sheets");
      window.setTimeout(() => setToast(""), 1800);
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được dữ liệu.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">KHO LƯU TRỮ NHANH</div>
          <h1>DriveVault</h1>
          <p>Lưu link Drive và nội dung dùng lại chỉ trong vài chạm.</p>
        </div>
        <button className="icon-button" aria-label="Tải lại" onClick={loadItems} disabled={loading}>
          <RefreshCcw size={20} className={loading ? "spin" : ""} />
        </button>
      </header>

      <section className="toolbar">
        <label className="searchbox">
          <Search size={18} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm theo tên hoặc nội dung..." />
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
          <div className="empty"><Layers3 size={34} /><strong>Chưa có dữ liệu phù hợp</strong><span>Bấm “Thêm mới” để tạo mục lưu trữ đầu tiên.</span></div>
        ) : filtered.map((item) => {
          const meta = typeMeta[item.type] || typeMeta.other;
          const Icon = meta.icon;
          return (
            <article className="card" key={item.id}>
              <div className="card-head">
                <span className={`badge ${meta.className}`}><Icon size={14} />{meta.label}</span>
                <time>{item.createdAt ? new Date(item.createdAt).toLocaleDateString("vi-VN") : ""}</time>
              </div>
              <h2>{item.name}</h2>
              {item.detail && <p className="detail">{item.detail}</p>}
              <div className="actions">
                {(item.type === "content" || item.detail) && (
                  <button className="secondary" onClick={() => copyText(item.detail)} disabled={!item.detail}>
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
          );
        })}
      </section>

      <button className="fab" onClick={() => { setError(""); setShowForm(true); }}><Plus size={22} /> Thêm mới</button>

      {showForm && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
            <div className="modal-head"><div><div className="eyebrow">MỤC LƯU TRỮ MỚI</div><h2 id="add-title">Thêm mới</h2></div><button className="icon-button" onClick={() => setShowForm(false)}><X size={20}/></button></div>
            <form onSubmit={saveItem}>
              <label>Loại lưu trữ
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as StorageType }))}>
                  <option value="media">Ảnh / Video</option>
                  <option value="content">Nội dung</option>
                  <option value="other">Khác</option>
                </select>
              </label>
              <label>Tên
                <input maxLength={120} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="VD: Mẫu phản hồi khách hàng" />
              </label>
              {(form.type === "content" || form.type === "other") && <label>Nội dung chi tiết {form.type === "other" && <small>(không bắt buộc nếu có link)</small>}
                <textarea rows={7} value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} placeholder="Nhập nội dung cần lưu để có thể sao chép nhanh..." />
              </label>}
              {(form.type === "media" || form.type === "other") && <label>Đường link Google Drive {form.type === "other" && <small>(không bắt buộc)</small>}
                <input inputMode="url" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://drive.google.com/..." />
              </label>}
              <button className="save" disabled={saving}>{saving ? <Loader2 size={18} className="spin" /> : <Plus size={18}/>} {saving ? "Đang lưu..." : "Lưu mục"}</button>
            </form>
          </section>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
