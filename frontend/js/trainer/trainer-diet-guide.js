/** Virtex Trainer Hub — trainer-diet-guide.html: the gym's read-only Diet Guide
 *  (bulking / cutting / maintenance, foods, example days, supplements).
 *  Same content as Admin → Diet Guide (js/admin/dietGuide.js). Static: no API calls, no client data.
 */
import { initShell } from './trainer-navigation.js';

const shell = await initShell({ page: 'diet-guide', title: 'Diet Guide', subtitle: 'How to eat for bulking, cutting or maintenance — foods, example days and basics', requireProfile: false });

if (shell) {
  window.VirtexDietGuide?.mount(shell.content, { note: '📘 The same guide your gym admin and members see. Use Diet Plans to build a personal plan for a client.' });
}
