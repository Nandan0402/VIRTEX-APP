/**
 * Gym logo shown on award certificates, next to the VIRTEX logo (Events → Award Certificates).
 *   GET    /api/v1/admin/competitions/certificate-logo   → { url | null }        (owner, manager, trainer)
 *   PUT    /api/v1/admin/competitions/certificate-logo   { image: dataURL }      (owner, manager)
 *   DELETE /api/v1/admin/competitions/certificate-logo                          (owner, manager)
 * Stored as one file in frontend/uploads/branding (same approach as member photos). PNG / JPEG / WebP only
 * (no SVG — it can carry scripts), max 2 MB, checked by file signature. Changes are written to the audit log.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../config/database.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/uploads/branding');
const BASE = 'certificate-logo';
const TYPES = {
  png: { ext: 'png', sig: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  jpeg: { ext: 'jpg', sig: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpg: { ext: 'jpg', sig: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { ext: 'webp', sig: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
};
const EXTS = ['png', 'jpg', 'webp'];
const MAX_BYTES = 2 * 1024 * 1024;

async function current() {
  for (const ext of EXTS) {
    const file = path.join(DIR, `${BASE}.${ext}`);
    try {
      const st = await fs.promises.stat(file);
      return { file, ext, url: `/uploads/branding/${BASE}.${ext}?v=${Math.round(st.mtimeMs)}` };
    } catch { /* not this one */ }
  }
  return null;
}

async function audit(req, event, details) {
  try {
    await query(`INSERT INTO auth_audit_logs (user_id, username, event_type, role, details) VALUES ($1, $2, $3, $4, $5)`,
      [req.user?.id || null, String(req.user?.username || 'admin').slice(0, 50), event, req.user?.role || null, details]);
  } catch { /* the logo change itself already succeeded */ }
}

export async function getLogo(req, res, next) {
  try {
    const c = await current();
    res.json({ success: true, data: { url: c ? c.url : null } });
  } catch (err) { next(err); }
}

export async function setLogo(req, res, next) {
  try {
    const m = /^data:image\/([a-z]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(req.body?.image || ''));
    if (!m || !TYPES[m[1]]) return res.status(400).json({ success: false, error: 'Upload a PNG, JPEG or WebP image.' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return res.status(400).json({ success: false, error: 'The image is empty.' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ success: false, error: 'The logo must be 2 MB or smaller.' });
    if (!TYPES[m[1]].sig(buf)) return res.status(400).json({ success: false, error: 'The file is not a valid image of that type.' });
    await fs.promises.mkdir(DIR, { recursive: true });
    const ext = TYPES[m[1]].ext;
    // Write the new file first, then remove other formats, so there is never a moment without a logo.
    const tmp = path.join(DIR, `${BASE}.${ext}.tmp`);
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, path.join(DIR, `${BASE}.${ext}`));
    for (const other of EXTS.filter((e) => e !== ext)) await fs.promises.rm(path.join(DIR, `${BASE}.${other}`), { force: true });
    await audit(req, 'CERTIFICATE_LOGO_UPDATED', { bytes: buf.length, type: ext });
    const c = await current();
    res.json({ success: true, message: 'Logo saved. It now appears on every certificate.', data: { url: c?.url || null } });
  } catch (err) { next(err); }
}

export async function removeLogo(req, res, next) {
  try {
    for (const ext of EXTS) await fs.promises.rm(path.join(DIR, `${BASE}.${ext}`), { force: true });
    await audit(req, 'CERTIFICATE_LOGO_REMOVED', {});
    res.json({ success: true, message: 'Logo removed. Certificates show only the VIRTEX logo.', data: { url: null } });
  } catch (err) { next(err); }
}
