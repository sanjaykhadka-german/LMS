"use client";

/**
 * ImageUpload — drag-and-drop / click-to-select image uploader.
 *
 * Uploads directly to Supabase Storage ("item-images" bucket) via
 * the browser Supabase client, then calls onUploaded() with the
 * storage path so the parent can persist the record.
 *
 * Each image can be tagged with an `image_type` (product / inner / outer
 * / pallet / other) — those tags drive the 4-up packaging strip on the
 * item detail page.
 */

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ImageType = "product" | "inner" | "outer" | "pallet" | "other";

interface UploadedImage {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  is_primary: boolean;
  preview_url: string;
  image_type?: ImageType;
}

interface ImageUploadProps {
  itemId: string;
  tenantId: string;
  existingImages?: UploadedImage[];
  onChanged?: (images: UploadedImage[]) => void;
  maxImages?: number;
}

const BUCKET = "item-images";
const MAX_SIZE_MB = 5;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

const IMAGE_TYPE_OPTIONS: { value: ImageType; label: string }[] = [
  { value: "product", label: "Product" },
  { value: "inner",   label: "Inner pack" },
  { value: "outer",   label: "Outer / carton" },
  { value: "pallet",  label: "Pallet" },
  { value: "other",   label: "Other" },
];

export function ImageUpload({
  itemId,
  tenantId,
  existingImages = [],
  onChanged,
  maxImages = 8,
}: ImageUploadProps) {
  const [images, setImages] = useState<UploadedImage[]>(existingImages);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  async function uploadFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);
    if (images.length + fileArr.length > maxImages) {
      setError(`Maximum ${maxImages} images per item.`);
      return;
    }

    const invalid = fileArr.find(f => !ACCEPTED.includes(f.type));
    if (invalid) { setError("Only JPEG, PNG and WebP images are allowed."); return; }

    const tooBig = fileArr.find(f => f.size > MAX_SIZE_MB * 1024 * 1024);
    if (tooBig) { setError(`Each image must be under ${MAX_SIZE_MB} MB.`); return; }

    setError(null);
    setUploading(true);

    const uploaded: UploadedImage[] = [];

    for (const file of fileArr) {
      const ext = file.name.split(".").pop() ?? "jpg";
      const storagePath = `${tenantId}/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, { contentType: file.type, upsert: false });

      if (uploadErr) {
        setError(`Upload failed: ${uploadErr.message}`);
        setUploading(false);
        return;
      }

      const { data: signedData } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 3600);

      const { data: record, error: dbErr } = await supabase
        .from("item_images")
        .insert({
          tenant_id: tenantId,
          item_id: itemId,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          is_primary: images.length === 0 && uploaded.length === 0,
          image_type: "other",
        })
        .select()
        .single();

      if (dbErr) {
        setError(`Could not save image record: ${dbErr.message}`);
        setUploading(false);
        return;
      }

      uploaded.push({
        id: record.id,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        is_primary: record.is_primary,
        preview_url: signedData?.signedUrl ?? "",
        image_type: "other",
      });
    }

    const next = [...images, ...uploaded];
    setImages(next);
    onChanged?.(next);
    setUploading(false);
  }

  async function setPrimary(id: string) {
    await supabase.from("item_images").update({ is_primary: false }).eq("item_id", itemId);
    await supabase.from("item_images").update({ is_primary: true }).eq("id", id);
    const next = images.map(img => ({ ...img, is_primary: img.id === id }));
    setImages(next);
    onChanged?.(next);
  }

  async function setImageType(id: string, type: ImageType) {
    // If setting a single-slot type (product/inner/outer/pallet),
    // demote any other image of the same type to 'other' first.
    if (type !== "other") {
      await supabase.from("item_images")
        .update({ image_type: "other" })
        .eq("item_id", itemId)
        .eq("image_type", type);
    }
    await supabase.from("item_images").update({ image_type: type }).eq("id", id);
    const next = images.map(img => {
      if (img.id === id) return { ...img, image_type: type };
      if (type !== "other" && img.image_type === type) return { ...img, image_type: "other" as ImageType };
      return img;
    });
    setImages(next);
    onChanged?.(next);
  }

  async function removeImage(img: UploadedImage) {
    await supabase.storage.from(BUCKET).remove([img.storage_path]);
    await supabase.from("item_images").delete().eq("id", img.id);

    const remaining = images.filter(i => i.id !== img.id);
    if (img.is_primary && remaining.length > 0) {
      await setPrimary(remaining[0].id);
    } else {
      setImages(remaining);
      onChanged?.(remaining);
    }
  }

  return (
    <div>
      {/* Image grid */}
      {images.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}>
          {images.map(img => (
            <div key={img.id}>
              <div style={{
                position: "relative",
                borderRadius: "0.5rem",
                overflow: "hidden",
                border: img.is_primary ? "2px solid #b91c1c" : "2px solid #e7e5e4",
                background: "#f5f5f4",
                aspectRatio: "1",
              }}>
                {img.image_type && img.image_type !== "other" && (
                  <span style={{
                    position: "absolute", left: 6, top: 6, padding: "0.125rem 0.4rem",
                    background: "rgba(0,0,0,0.6)", color: "white", borderRadius: "0.25rem",
                    fontSize: "0.625rem", fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: "0.04em", zIndex: 2,
                  }}>
                    {img.image_type}
                  </span>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.preview_url}
                  alt={img.file_name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                {/* Overlay controls */}
                <div style={{
                  position: "absolute", inset: 0, background: "rgba(0,0,0,0)",
                  transition: "background 0.15s",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: "0.25rem",
                  opacity: 0,
                }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.background = "rgba(0,0,0,0.45)";
                    (e.currentTarget as HTMLDivElement).style.opacity = "1";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.background = "rgba(0,0,0,0)";
                    (e.currentTarget as HTMLDivElement).style.opacity = "0";
                  }}
                >
                  {!img.is_primary && (
                    <button
                      onClick={() => setPrimary(img.id)}
                      style={{
                        fontSize: "0.6875rem", fontWeight: "600",
                        background: "#b91c1c", color: "#fff",
                        border: "none", borderRadius: "0.25rem",
                        padding: "0.25rem 0.5rem", cursor: "pointer",
                      }}
                    >
                      Set primary
                    </button>
                  )}
                  {img.is_primary && (
                    <span style={{ fontSize: "0.6875rem", fontWeight: "700", color: "#fff", background: "#b91c1c", borderRadius: "0.25rem", padding: "0.25rem 0.5rem" }}>
                      ★ Primary
                    </span>
                  )}
                  <button
                    onClick={() => removeImage(img)}
                    style={{
                      fontSize: "0.6875rem", fontWeight: "600",
                      background: "rgba(255,255,255,0.15)", color: "#fff",
                      border: "1px solid rgba(255,255,255,0.4)", borderRadius: "0.25rem",
                      padding: "0.25rem 0.5rem", cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <select
                value={img.image_type ?? "other"}
                onChange={e => setImageType(img.id, e.target.value as ImageType)}
                style={{
                  marginTop: "0.375rem", width: "100%",
                  fontSize: "0.7rem", padding: "0.2rem 0.3rem",
                  border: "1px solid #d6d3d1", borderRadius: "0.25rem",
                  background: "white", color: "#1c1917",
                }}
              >
                {IMAGE_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {images.length < maxImages && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
          }}
          style={{
            border: `2px dashed ${dragging ? "#b91c1c" : "#d6d3d1"}`,
            borderRadius: "0.625rem",
            padding: "1.5rem",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? "#fef2f2" : "#fafaf9",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>📷</div>
          <div style={{ fontSize: "0.875rem", color: "#78716c", fontWeight: "500" }}>
            {uploading ? "Uploading…" : "Click or drag images here"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#a8a29e", marginTop: "0.25rem" }}>
            JPEG · PNG · WebP — max {MAX_SIZE_MB} MB each · up to {maxImages} images. Tag each image (Product / Inner / Outer / Pallet) below the thumbnail.
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            multiple
            style={{ display: "none" }}
            onChange={e => { if (e.target.files?.length) uploadFiles(e.target.files); }}
          />
        </div>
      )}

      {error && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "#dc2626", fontWeight: "500" }}>
          {error}
        </div>
      )}
    </div>
  );
}
