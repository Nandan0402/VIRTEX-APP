/**
 * Virtex — anatomy body map (front + back) drawn as inline SVG, styled to look 3D with gradient
 * shading, outline and soft shadow. Each muscle region carries data-m="<Muscle name>" and a tone
 * class (mr-t-low | mr-t-mid | mr-t-ok | mr-t-fresh | mr-t-none) so the page can recolour it live.
 * Left-side shapes are drawn once and mirrored for the right side (viewBox 0 0 200 400, centre x = 100).
 */

// [muscle or null, path, mirrored?, extra class]
const FRONT = [
  [null, 'M100 12 C86 12 78 24 78 40 C78 56 86 68 100 68 C114 68 122 56 122 40 C122 24 114 12 100 12 Z', false, 'mr-head'],
  [null, 'M89 62 L87 80 Q100 87 113 80 L111 62 Q100 70 89 62 Z', false],
  ['Shoulders', 'M60 90 Q42 90 35 110 Q33 126 41 140 Q49 124 63 110 Q66 98 60 90 Z', true],
  [null, 'M87 78 Q72 84 60 90 Q66 98 63 108 L84 96 Z', true],
  ['Chest', 'M100 94 L84 96 Q66 100 62 112 Q58 126 64 134 Q82 144 100 138 Z', true],
  ['Biceps', 'M41 142 Q33 162 37 184 Q45 192 54 182 Q60 160 61 134 Q50 128 41 142 Z', true],
  ['Forearms', 'M37 188 Q27 214 25 240 Q31 247 40 242 Q51 216 55 186 Q46 194 37 188 Z', true],
  [null, 'M25 242 Q20 260 27 270 Q36 266 40 245 Q33 248 25 242 Z', true, 'mr-hand'],
  ['Abs', 'M64 136 Q64 168 70 196 L85 203 L85 145 Q74 142 64 136 Z', true],
  ['Abs', 'M86 144 Q100 139 114 144 L113 202 Q100 216 87 202 Z', false, 'mr-abs'],
  [null, 'M70 198 L86 205 Q100 218 114 205 L130 198 Q126 214 112 226 Q100 232 88 226 Q74 214 70 198 Z', false],
  ['Quads', 'M70 206 Q58 252 63 302 Q74 314 88 306 Q99 262 99 228 Q86 220 70 206 Z', true],
  [null, 'M66 306 Q78 320 90 308 Q92 318 86 324 Q74 328 66 318 Z', true, 'mr-knee'],
  [null, 'M67 322 Q61 354 68 386 L84 386 Q91 352 87 322 Q76 328 67 322 Z', true],
  [null, 'M68 386 Q60 396 68 399 L87 398 L84 386 Z', true, 'mr-foot'],
];
const BACK = [
  [null, 'M100 12 C86 12 78 24 78 40 C78 56 86 68 100 68 C114 68 122 56 122 40 C122 24 114 12 100 12 Z', false, 'mr-head'],
  [null, 'M89 62 L87 80 Q100 87 113 80 L111 62 Q100 70 89 62 Z', false],
  ['Upper back', 'M100 70 L88 74 Q72 84 60 90 Q70 96 82 98 L100 152 Z', true],
  ['Shoulders', 'M60 90 Q42 90 35 110 Q33 126 41 140 Q49 124 63 110 Q66 98 60 90 Z', true],
  ['Upper back', 'M64 104 Q60 142 72 188 Q86 172 97 156 L80 100 Q72 102 64 104 Z', true],
  ['Lower back', 'M80 170 Q100 160 120 170 L118 205 Q100 212 82 205 Z', false],
  ['Triceps', 'M41 142 Q33 162 37 184 Q45 192 54 182 Q60 160 61 134 Q50 128 41 142 Z', true],
  ['Forearms', 'M37 188 Q27 214 25 240 Q31 247 40 242 Q51 216 55 186 Q46 194 37 188 Z', true],
  [null, 'M25 242 Q20 260 27 270 Q36 266 40 245 Q33 248 25 242 Z', true, 'mr-hand'],
  [null, 'M64 140 Q66 170 72 190 Q76 196 80 200 L80 172 Q72 160 64 140 Z', true],
  ['Glutes', 'M72 202 Q64 230 74 250 Q90 258 100 246 L100 210 Q86 200 72 202 Z', true],
  ['Hamstrings', 'M66 252 Q61 290 69 314 Q82 320 93 310 Q99 282 99 252 Q84 260 66 252 Z', true],
  ['Calves', 'M66 322 Q59 344 66 366 Q76 376 87 366 Q93 344 88 322 Q78 316 66 322 Z', true],
  [null, 'M68 366 Q65 378 68 386 L84 386 Q87 376 86 366 Q77 372 68 366 Z', true],
  [null, 'M68 386 Q60 396 68 399 L87 398 L84 386 Z', true, 'mr-foot'],
];
const ABS_LINES = 'M100 146 L100 204 M88 160 Q100 157 112 160 M88 174 Q100 171 112 174 M88 188 Q100 185 112 188';

export const FRONT_MUSCLES = ['Chest', 'Shoulders', 'Biceps', 'Forearms', 'Abs', 'Quads'];
export const viewFor = (muscle) => (FRONT_MUSCLES.includes(muscle) ? 'front' : 'back');

/** Gradients shared by every map on the page (inserted once). */
export function ensureAnatomyDefs() {
  if (document.getElementById('mr-anatomy-defs')) return;
  const tone = (id, a, b, c) => `<radialGradient id="${id}" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>`;
  const svg = `<svg id="mr-anatomy-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    ${tone('mrg-skin', '#f4f5f7', '#d9dce3', '#a9aebb')}
    ${tone('mrg-low', '#fecaca', '#f87171', '#b91c1c')}
    ${tone('mrg-mid', '#fef3c7', '#fbbf24', '#b45309')}
    ${tone('mrg-ok', '#bbf7d0', '#22c55e', '#15803d')}
    ${tone('mrg-fresh', '#d1fae5', '#4ade80', '#16a34a')}
    <filter id="mrf-shadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".45"/></filter>
  </defs></svg>`;
  document.body.insertAdjacentHTML('afterbegin', svg);
}

/**
 * @param {'front'|'back'} view
 * @param {(muscle:string)=>string|null} toneOf  returns 'low'|'mid'|'ok'|'fresh' or null (= not highlighted)
 * @param {{ label?:boolean, cls?:string }} opts
 */
export function anatomySvg(view, toneOf, { label = true, cls = '' } = {}) {
  const parts = view === 'front' ? FRONT : BACK;
  const shape = ([m, d, , extra]) => {
    const t = m ? toneOf(m) : null;
    const tcls = m ? `mr-m mr-t-${t || 'none'}` : 'mr-skin';
    return `<path d="${d}" class="${tcls}${extra ? ` ${extra}` : ''}"${m ? ` data-m="${m}"` : ''}>${m ? `<title>${m}</title>` : ''}</path>`;
  };
  const left = parts.map(shape).join('');
  const right = parts.filter((p) => p[2]).map(shape).join('');
  return `<svg class="mr-anat ${cls}" viewBox="0 0 200 ${label ? 418 : 402}" role="img" aria-label="${view === 'front' ? 'Front' : 'Back'} view of the body">
    <ellipse cx="100" cy="400" rx="54" ry="5" class="mr-floor"/>
    <g filter="url(#mrf-shadow)">${left}<g transform="translate(200 0) scale(-1 1)">${right}</g>
    ${view === 'front' ? `<path d="${ABS_LINES}" class="mr-lines"/>` : '<path d="M100 74 L100 160" class="mr-lines"/>'}</g>
    ${label ? `<text x="100" y="416" text-anchor="middle" class="mr-anat-label">${view === 'front' ? 'FRONT' : 'BACK'}</text>` : ''}</svg>`;
}
