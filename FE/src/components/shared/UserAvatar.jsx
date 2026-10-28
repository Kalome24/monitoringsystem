// src/components/shared/UserAvatar.jsx
//
// Session 11 — Fix #3.
//
// Shows a user's avatar by:
//   1. Rendering initials immediately (no layout shift while loading).
//   2. Fetching the raw image bytes from /api/users/:id/avatar ONLY
//      when the container scrolls into view (IntersectionObserver,
//      200px pre-load margin).
//   3. Caching the resulting blob URL at module scope (5 min TTL) so
//      re-renders, tab switches, and filter changes don't re-download.
//
// Uses userApi.getAvatarBlob() so the request carries the Authorization
// header (an <img src> can't attach a bearer token).
//
// Props:
//   userId        — user id (numeric or string)
//   hasImage      — true / 1 when the backend says the user has a picture
//   firstName     — for the initials fallback
//   lastName      — for the initials fallback
//   username      — for the initials fallback
//   className     — CSS class on wrapper (default 'user-avatar')
//   imgClassName  — CSS class on <img>    (default 'user-avatar-img')
//   style         — optional inline style on wrapper

import React, { useEffect, useRef, useState } from 'react';
import { userApi } from '../../services/api';

const CACHE_TTL_MS = 5 * 60 * 1000;
const avatarCache = new Map();   // userId -> { url, at }

const getInitials = (first, last, username) => {
  const f = String(first || '').trim();
  const l = String(last || '').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (l) return l.slice(0, 2).toUpperCase();
  return String(username || '??').slice(0, 2).toUpperCase();
};

const UserAvatar = ({
  userId,
  hasImage = false,
  firstName = '',
  lastName = '',
  username = '',
  className = 'user-avatar',
  imgClassName = 'user-avatar-img',
  style,
}) => {
  const initials = getInitials(firstName, lastName, username);
  const containerRef = useRef(null);

  const [url, setUrl] = useState(() => {
    if (!userId) return null;
    const cached = avatarCache.get(String(userId));
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.url;
    return null;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!hasImage || !userId || url || failed) return;

    const node = containerRef.current;
    if (!node) return;

    let cancelled = false;

    const doFetch = async () => {
      const key = String(userId);

      const cached = avatarCache.get(key);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        if (!cancelled) setUrl(cached.url);
        return;
      }

      try {
        const res = await userApi.getAvatarBlob(userId);
        if (cancelled) return;

        if (res.ok && res.blob) {
          const objectUrl = URL.createObjectURL(res.blob);
          avatarCache.set(key, { url: objectUrl, at: Date.now() });
          setUrl(objectUrl);
        } else {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      doFetch();
      return () => { cancelled = true; };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.disconnect();
            doFetch();
            return;
          }
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [hasImage, userId, url, failed]);

  return (
    <div ref={containerRef} className={className} style={style} aria-hidden="true">
      {url ? (
        <img
          src={url}
          alt=""
          className={imgClassName}
          onError={() => {
            setFailed(true);
            setUrl(null);
          }}
        />
      ) : (
        initials
      )}
    </div>
  );
};

export default UserAvatar;