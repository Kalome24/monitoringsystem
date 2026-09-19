// src/components/shared/ItemImageThumb.jsx
import React from 'react';

/**
 * Reusable thumbnail for item images.
 *
 * Props:
 *   - src:    string  → data URL (e.g. "data:image/png;base64,...") or null
 *   - alt:    string  → alt text (defaults to "item")
 *   - size:   number  → pixel size of the square (default 44)
 *
 * Renders:
 *   - <img> tag with the image, contained within a square box
 *   - Fallback: a light gradient box with a 📦 emoji
 *
 * Used in: ReceivePoModal, TransferPoModal (per-line thumbnails).
 */
const ItemImageThumb = ({ src, alt = 'item', size = 44 }) => {
  const dimension = typeof size === 'number' ? `${size}px` : size;

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{
          width: dimension,
          height: dimension,
          objectFit: 'contain',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          background: '#fafbfc',
          display: 'block',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <span
      aria-label="No image"
      style={{
        display: 'inline-flex',
        width: dimension,
        height: dimension,
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `calc(${dimension} * 0.42)`,
        color: '#cbd5e1',
        background: 'linear-gradient(135deg, #fafbfc 0%, #f1f5f9 100%)',
        borderRadius: 8,
        border: '1px dashed #e2e8f0',
        flexShrink: 0,
      }}
    >
      📦
    </span>
  );
};

export default ItemImageThumb;