---
paths:
  - "apps/mobile/app/**"
  - "apps/mobile/components/**"
  - "apps/mobile/theme/**"
  - "apps/mobile/assets/**"
---

# Mobile: screens and components

## Theme
- `apps/mobile/theme/palette.js` is the single source of every UI color, by role (`ground`, `surface`, `raised`, `line`, `ink`/`inkMuted`/`inkFaint`…, and per hue `violet` (500, for tints and borders with opacity), `violetSoft` (300), `violetPale` (200), `violetStrong` (400), `violetDeep` (600), `violetFaint` (100); plus `avatarNBg`/`avatarNInk`).
- Adding a theme later: add a map next to `dark` with the same keys (the test checks), switch the CSS variables (NativeWind `vars()` or a `.dark:root`/class block) and swap `colors`.

## Routes (expo-router)
- `app/_layout.tsx`: DB init + hydration; `Stack.Protected` sends users to `onboarding` when no child exists. The native splash stays up until the database is open (`SplashScreen.preventAutoHideAsync`, hidden after `appReady()`), so there's no spinner at start.
- `app/(tabs)/index`: Home. `components/home/HomeTiles` shows Sleep, Feed and Diaper as big tiles. The pinned tile sits on top (sleep by default; long-press a tile to pin it; `settings.homeTop` per child) and the other two side by side. Below: what's due, each with a button (medication doses with a next-dose interval: Log, prefilled; pumping when its reminder is on: Start, with Undo; shown until 12 h past due), then links to the sleep schedule and today's log. Everything without a tile is the round + in the header, next to the child. Running pumping/activity timers show above the tiles via `ActiveTimers`.
  - Awake in the night (`isNightWaking`), the sleep tile shows how long they've slept tonight instead of a prediction; no separate label or "up for the day" button.
  - Tapping the sleep tile (start or wake up) offers Undo for 5 s; a running sleep has a Discard button (with a confirmation). Accidental taps on the big tile are easy.
  - Tapping a tile's time or the lines under it opens its entry (running, or the last one). The tile's action is a full-size `Pressable` underneath, with the content on top passing taps through (`pointerEvents`); buttons nested inside a `Pressable` don't reliably get their own taps on Android.
  - The header (`components/TabHeader`, also on History and Trends; not Settings): the avatar opens the child's profile, the name switches child (`ChildSwitcher`), the round + opens "Log something". No screen title there: the tab bar names it.
- `app/(tabs)/history`: one day (`components/history/DayLog`) as a timeline, newest first: times on a rail, sleeps as thick spans, the wake windows between sleeps (`dayTimeline`), a night with wakings as one block (`NightBar`, wakings listed when opened, tap to edit), plus the day's totals; arrows move by day; tapping the date opens `datetime/CalendarSheet` (month grid, Monday first, a dot on days with entries, swipe or arrows between months; `monthGrid` in `datetime/parts.ts`), and "Back to today" returns. No Week view: Trends has the same totals.
- `app/(tabs)/trends`: 7/14/30-day averages and charts. A Nights section (time asleep, wakings, longest stretch, awake at night) appears once wakings are logged in the period.
- `app/schedule.tsx` (next sleep + suggested day; linked from Home's "Sleep schedule" row), `app/reminders.tsx`.
- `app/growth.tsx` (WHO chart, share as PNG via view-shot + expo-sharing), `app/solids.tsx`, `app/export.tsx` (CSV).
- `app/entry/[id].tsx`: edit/backdate any entry. A finished night sleep opens as its whole night (`components/NightForm`): bedtime, wake-up, the wakings (add, edit, remove), notes; saving reuses the pieces in order, adds or deletes the rest (a removed waking joins two pieces; their notes move to the first). Pieces that touch (a zero-length waking) open without that waking, so saving joins them. Mostly used the morning after: log the night as one, split it later.
- `app/child/new.tsx`: add a child (modal). `app/child/[id]/index.tsx`: the child's profile page (no stack header): full-width photo cover with name and age, a growth chart (Weight/Length/Head, WHO band), and the story of firsts (`childStory`). `app/child/[id]/edit.tsx`: edit details; the danger zone deletes a child after the user types its name.
- Settings shows children as an avatar strip linking to their profiles. App-wide settings stay in Settings.

## Components
- `ui.tsx`: `ScreenTitle`, `Hint`, `Notice`, `LoaderBlock` (a centered wait), `Card` (its last `Row` has no line; a `Row` with its own button takes `action`, never a Pressable inside `right`), Chip (optional icon), Segmented, TextField, Button (`dangerQuiet` for a delete that still asks first; solid `danger` only for the child's "Delete forever"), Row, plus the pieces every screen shares: `Toggle` (the switch in violet; never a bare `Switch`), `SectionLabel` (uppercase label above cards), `Lead` (a screen's opening paragraph), `ErrorText`, `WarningText`, `Chevron` (on rows that open something). `SECRET_INPUT` for secrets typed in the clear (recovery words): no suggestions or autofill, and `visible-password` on Android so Gboard doesn't learn them.
- Layout: screen gutter is 16 (sheets 20); History and Trends keep `TabHeader` (plus History's day and totals, Trends' range) and Settings its title fixed above the scroll view; a screen with a stack header has no heading repeating it.
- `charts/`: hand-rolled with `react-native-svg` and Views (no chart library): `BarChart` (stacked), `GrowthChart`.
- `ChildSwitcher` (avatar, switch child, open a profile), `ActiveTimers`. Entries open from History or the Home tiles; delete only from the entry screen.
- `ChildAvatar`: the photo, or the child's initial on a per-child color. `PhotoMenu`: take/choose/remove; it runs the picker only after its modal has dismissed (iOS).
- `logTypes.tsx`: `TYPE_META` (label/icon/colors) + `defaultPayload` per type. `logDisplay.tsx`: row text per entry.
- `icons/`: all icons are Font Awesome 6 Free **solid**, drawn with `react-native-svg` (no icon font, no Lucide). `faPaths.ts` is generated from `@fortawesome/fontawesome-free/svgs/solid` (don't edit by hand); add an icon by adding its name there and a `make('<name>')` export in `index.tsx`. `PoopDroplet` (poop with a masked-out droplet) is the diaper icon. The CC BY 4.0 credit is at the bottom of Settings; keep it.
- `editors/`: **one editor per log type** (`EDITORS` registry), shared by the "log new" sheet and the edit screen. `fields.tsx` has NumberField/UnitNumberField (canonical value, display unit) and PhotoField; `FoodPicker`.
- `sheets/`: `SheetHost` owns the **single** `BottomSheet` for the tabs (rendered by `app/(tabs)/_layout.tsx`, so Home's tiles and the + on Home, History and Trends share it; Growth has its own for "Add a measurement") and swaps content per `useSheetStore` request. Keep one Modal (iOS can't present while another dismisses).
  - `FeedSheet`: live L/R timer, bottle, solids.
  - `LogSheet`: generic, + `CommonFields` notes; no tags (an older app's `tags` pass through as an unknown field). With `at` (History's + on another day) it starts then. Sleep, pumping and activity: the start defaults to now and the end is empty; Save needs an end (a past one), "Start timer" runs from the chosen start.
  - `AddLogSheet`: grid of `LOG_TILE_KEYS`: every type, with Tummy time as its own tile (`logTile` in `logTypes.tsx`); opens every tile as a `LogSheet`, the feed tile too (the live L/R timer is `FeedSheet`, from Home's feed tile).
  - `DiaperSheet`: one tap on Wet/Dirty/Both logs now, then optional color, Undo, auto-closes; Wet is blue, Dirty brown, Both neutral with both icons.
- `useSingleFlight`: wrap a sheet's log/save/start handlers in it, so a double tap doesn't log twice.
- `useConfirmDiscard(dirty)`: "Discard changes?" when an editor screen is left with edits (back, swipe, Android back; `usePreventRemove`). It returns `leave()`: call it right before navigating away after saving or deleting. Used by the entry, night and child forms.
- `confirmDestructive`, `savedFeedback`.
- `DateTimeField`: our own wheel sheet (`components/datetime/`: `WheelColumn`, tested `parts.ts`), the same on iOS and Android, replacing the system pickers (no system date picker).
  - `datetime` mode: day ("Today", "Yesterday", "Sat, Oct 24"…, a year back or to the value), hour and minute, plus AM/PM on a 12-hour clock.
  - `date` mode (birth date): day, month and year.
  - A value past `maximumDate` saves as the maximum.
  - Each wheel is one `adjustable` control for screen readers (label "Hour", value "4", increment/decrement); its rows are hidden from them.

## Accessibility (A12)
- Every `Pressable` gets `accessibilityRole`; an icon-only one also an `accessibilityLabel` (`…A11y` keys). `TextField`s and `Toggle`s get the label of the `FieldLabel`/row they sit in. Decorative SVGs (icons, brand subs, chart drawings) are hidden (`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`); a chart that matters gets a summary label instead.
- Modals: a scrim that is the only way out is a labelled Close button; otherwise it's hidden, and the sheet has `onAccessibilityEscape`. Don't put `accessibilityViewIsModal` beside the only Close control (VoiceOver can't reach it); a RN `Modal` already shuts out the screen behind.
- Reduced motion: `useReducedMotion()` (Reanimated) sets `animationType="none"` on modals, the stack's `animation`, and skips sheet slides and wheel scroll animations.
- Font scaling: no fixed heights around text (`min-h-*`), `adjustsFontSizeToFit` only on single lines whose box isn't a fixed height with a matching `lineHeight` (the scaled line height overflows and the text shrinks to nothing: the wheel's rows did). Home scrolls only when the content doesn't fit; the tiles' minimum height applies above 1.2× text.
- Check on the emulator with `adb shell settings put system font_scale 2.0` and `uiautomator dump --compressed` (what TalkBack reads). adb taps and key presses don't drive TalkBack, so gestures need a person.

## Brand
- The design canvas row "Subby 1 in the app" maps where the brand goes on every screen; on Home the brand lives only in the sleep tile and its Undo bar (canvas row "Subby on Home").
- **Assets:** `assets/brand/*.svg` are the sources; the PNGs in `assets/` are rendered from them at their declared size (we used `@resvg/resvg-js`, outside the repo). Re-render after editing an SVG, then prebuild. `icon` (full bleed, iOS rounds it), `adaptive-icon` + `adaptive-icon-monochrome` (Android, framed inside the safe zone), `splash-icon` (same framing, so Android 12+'s round mask doesn't clip it), `notification-icon` (white, tinted `#FFC93C`), `tile` (rounded, for in-app use).
- `components/brand/`: the moon sub from the app icon (`Sub`, `RestingSub`, `SubTile` (onboarding), `SubMono` (one color, portholes cut out: Settings footer, Growth image), `Wordmark` (Fredoka SemiBold, embedded by the `expo-font` plugin from `@expo-google-fonts/fredoka`; Android names it by file, iOS by PostScript name); colors `sub*` and `seaFloor` in the palette), drawn with react-native-svg and animated with Reanimated. They stand still with reduced motion. Use these, not `ActivityIndicator`:
  - `SubLoader` (bobbing, bubbles): general waits without a known total.
  - `PeriscopeLoader`: waiting on the other phone (creating a code, adding, joining).
  - `SubProgress`: a known 0–1 progress (backup, restore, Baby Buddy import).
  - `SubSpinner`: small inline waits (buttons, rows, loading an entry).
  - `SyncPing`: two sonar rings once, when the Sync screen is up to date (new `key` per sync).
  - `DozingSub`: the sub bobbing with z's (bubbles when there's room): Home's sleep tile during a sleep. Awake, that tile shows a faint `SubMono` (8 %) instead; large tile bottom-right (above Discard), small tile top-right. Sleep's Undo bar carries the sub too.
  - `EmptyState`: the sub asleep on the sea floor (History day, Trends, Export).
- **Licenses:** `assets/licenses.json` (Settings → About → Open source licenses) is generated by `node scripts/licenses.mjs` from the bundle's source maps (what ships, not build tools) plus `EXTRA` (SQLCipher, Font Awesome, Fredoka). Re-run it when dependencies change, before a store build.
