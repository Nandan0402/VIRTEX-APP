/**
 * birthdayWishes.service.js — automatic birthday wishes for members and personal trainers.
 *
 * Every BIRTHDAY_CHECK_MINUTES (default 15) the server looks for people whose birthday is today and who
 * have not been wished yet. From BIRTHDAY_WISH_HOUR (default 8 = 8:00 AM server time) it posts a personal
 * wish from "Virtex Gym Team" in their Messages (members: gym-team chat; trainers: trainer ↔ gym-team chat)
 * and records birthday_wish_sent_at, so nobody is wished twice — even after a restart or with two servers.
 * Turn it off with AUTO_BIRTHDAY_WISHES=false. WhatsApp wishes stay manual (no WhatsApp Business API here).
 */
import * as repo from '../repositories/birthday.repository.js';
import * as messaging from './messaging.service.js';

const ENABLED = String(process.env.AUTO_BIRTHDAY_WISHES ?? 'true').toLowerCase() !== 'false';
const toInt = (v, d, lo, hi) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n >= lo && n <= hi ? n : d; };
export const WISH_HOUR = toInt(process.env.BIRTHDAY_WISH_HOUR, 8, 0, 23);
const CHECK_MINUTES = toInt(process.env.BIRTHDAY_CHECK_MINUTES, 15, 1, 720);

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
export const memberWishText = (name) =>
  `🎉 Happy Birthday, ${firstName(name)}! 🎂\n\nEveryone at Virtex Fitness wishes you a fantastic year ahead — full of strength, energy and new personal records. Enjoy your special day! 💪\n\n— Virtex Gym Team`;
export const trainerWishText = (name) =>
  `🎉 Happy Birthday, ${firstName(name)}! 🎂\n\nThank you for everything you do for our members. The whole Virtex team wishes you a wonderful year ahead. Enjoy your day! 💪\n\n— Virtex Gym Team`;

let lastRun = null; let running = false; let timer = null;

/**
 * Wish everyone whose birthday is today and who has not been wished yet.
 * @param {{ force?: boolean }} opts force = ignore the WISH_HOUR gate (used by "Send now").
 */
export async function runBirthdayWishes({ force = false, trigger = 'schedule' } = {}) {
  if (running) return { skipped: 'already running' };
  if (!force && new Date().getHours() < WISH_HOUR) return { skipped: `waiting until ${WISH_HOUR}:00` };
  running = true;
  const result = { at: new Date().toISOString(), trigger, members: [], trainers: [], failed: [], channels: null };
  try {
    const channels = await messaging.systemMessageChannels();
    result.channels = channels;
    if (channels.members) {
      for (const m of await repo.membersDueToday()) {
        const prev = await repo.claimMemberWish(m.id);
        if (prev === undefined) continue; // someone else just wished them
        try { await messaging.systemMessageToMember(m.id, memberWishText(m.full_name), { title: '🎂 Happy Birthday from Virtex!' }); result.members.push(m.full_name); }
        catch (e) { await repo.releaseMemberWish(m.id, prev).catch(() => {}); result.failed.push({ who: m.full_name, error: e.message }); }
      }
    }
    if (channels.trainers && (await repo.trainerBirthdaysAvailable())) {
      for (const t of await repo.trainersDueToday()) {
        const prev = await repo.claimTrainerWish(t.id);
        if (prev === undefined) continue;
        try { await messaging.systemMessageToTrainer(t.id, trainerWishText(t.full_name), { title: '🎂 Happy Birthday from Virtex!' }); result.trainers.push(t.full_name); }
        catch (e) { await repo.releaseTrainerWish(t.id, prev).catch(() => {}); result.failed.push({ who: t.full_name, error: e.message }); }
      }
    }
    if (result.members.length || result.trainers.length || result.failed.length) {
      console.log(`[Birthdays] Wished ${result.members.length} member(s) and ${result.trainers.length} trainer(s)${result.failed.length ? `; ${result.failed.length} failed` : ''}.`);
    }
  } catch (e) {
    result.error = e.message;
    console.warn('[Birthdays] Automatic wish run failed:', e.message);
  } finally {
    running = false;
    lastRun = result;
  }
  return result;
}

/** Status for the Birthday Alert page. */
export async function getAutoWishStatus() {
  const [channels, trainerDob, wished] = await Promise.all([
    messaging.systemMessageChannels().catch(() => ({ members: false, trainers: false })),
    repo.trainerBirthdaysAvailable().catch(() => false),
    repo.wishedToday().catch(() => ({ members: [], trainers: [] })),
  ]);
  return {
    enabled: ENABLED && !!timer,
    configuredOn: ENABLED,
    wishHour: WISH_HOUR,
    checkEveryMinutes: CHECK_MINUTES,
    channels: { members: channels.members, trainers: channels.trainers && trainerDob },
    trainerBirthdaysAvailable: trainerDob,
    wishedToday: wished,
    lastRun,
  };
}

/** Start the background schedule (called once from server.js; never from tests). */
export function startBirthdayScheduler() {
  if (!ENABLED || timer) return;
  const tick = () => runBirthdayWishes().catch(() => {});
  setTimeout(tick, 20000).unref();
  timer = setInterval(tick, CHECK_MINUTES * 60000);
  timer.unref();
  console.log(`[Birthdays] Automatic birthday wishes on: checked every ${CHECK_MINUTES} min, sent from ${String(WISH_HOUR).padStart(2, '0')}:00.`);
}
export function stopBirthdayScheduler() { if (timer) { clearInterval(timer); timer = null; } }
