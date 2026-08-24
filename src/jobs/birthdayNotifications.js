import { areUsersBlocked } from '../controllers/userController.js';
import User from '../models/User.js';
import { notifyUser } from '../services/pushService.js';

const LOOKAHEAD_MS = 5 * 60 * 1000; // notify friends 5 minutes before local midnight
const WINDOW_MS = 60 * 1000; // the job runs every minute, so a 1-minute window means each user is checked exactly once

/**
 * For a given IANA timezone, returns milliseconds until the *next* local
 * midnight (i.e. until the user's birthday date changes in their own timezone).
 * Uses Intl to read the current local wall-clock time in that zone without
 * needing a date library.
 */
function msUntilNextLocalMidnight(timezone, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);

  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  const hour = get('hour') % 24; // Intl can return "24" for midnight
  const minute = get('minute');
  const second = get('second');

  const secondsSinceLocalMidnight = hour * 3600 + minute * 60 + second;
  const secondsInDay = 24 * 3600;
  return (secondsInDay - secondsSinceLocalMidnight) * 1000;
}

/**
 * Runs every minute (see server.js). Finds users whose birthday starts in
 * 5-6 minutes in their own local time and notifies their friends.
 */
export async function runBirthdayNotifications() {
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  // dateOfBirth must be set; lastBirthdayNotifiedYear is excluded from default
  // projections (select:false on the schema), so it must be requested explicitly.
  const candidates = await User.find({ dateOfBirth: { $ne: null } })
    .select('username displayName dateOfBirth timezone friends lastBirthdayNotifiedYear blockedUsers')
    .populate('friends', '_id notificationSettings blockedUsers');

  let notifiedCount = 0;

  for (const user of candidates) {
    if (user.lastBirthdayNotifiedYear === currentYear) continue; // already handled this year

    const tz = user.timezone || 'UTC';
    let msToMidnight;
    try {
      msToMidnight = msUntilNextLocalMidnight(tz, now);
      
    } catch {
      continue; // invalid/unsupported timezone on this user's record — skip rather than crash the whole job
    }

    const isBirthdayWindow = msToMidnight <= LOOKAHEAD_MS && msToMidnight > LOOKAHEAD_MS - WINDOW_MS;
    if (!isBirthdayWindow) continue;

    // Confirm the *upcoming* local date actually matches month/day of birth
    // (msUntilNextLocalMidnight alone doesn't know which date is starting).
    const upcomingLocalDate = new Date(now.getTime() + msToMidnight);
    const upcomingParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(upcomingLocalDate);
    const upcomingMonth = Number(upcomingParts.find((p) => p.type === 'month')?.value);
    const upcomingDay = Number(upcomingParts.find((p) => p.type === 'day')?.value);

    const dob = new Date(user.dateOfBirth);
    if (dob.getUTCMonth() + 1 !== upcomingMonth || dob.getUTCDate() !== upcomingDay) continue;

    // Atomically claim this user's notification for the year before sending
        // anything. If two ticks ever overlap (e.g. a slow tick plus the next
        // scheduled one), only one can win this update, so friends never get
        // double-notified.
        const claim = await User.updateOne(
          { _id: user._id, lastBirthdayNotifiedYear: { $ne: currentYear } },
          { $set: { lastBirthdayNotifiedYear: currentYear } }
        );
        if (claim.modifiedCount !== 1) continue; // another run already claimed this user
        
    const name = user.displayName || user.username;
    const friends = (user.friends || []).filter(Boolean);

    await Promise.all(
          friends.map(async (friend) => {
            // Respect each friend's own birthday-reminder preference (defaults
            // to on, so undefined/never-set still notifies).
            if (friend.notificationSettings?.birthdayReminders === false) return;
            // Respect existing block relationships even if the two are still
            // technically in each other's friends list.
            const blocked = await areUsersBlocked(user._id, friend._id, user.blockedUsers);
            if (blocked) return;
            await notifyUser(friend._id, {
             kind: 'birthday',
            title: 'Birthday reminder',
            body: `${name}'s birthday is in 5 minutes — send a wish!`,
            }).catch((error) => {
              console.error(
              `Failed to send birthday notification to ${friend._id}:`,
              error);
            });
          })
        );
    
        notifiedCount += 1;
      }

  return notifiedCount;
}
